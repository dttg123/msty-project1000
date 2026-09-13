import { blankRecovery } from './state.js';
import { clamp, n } from './utils.js';

export function createPortfolioEngine(getState, getSelectedProjectId) {
  function activeProjects() {
    return getState().projects.filter(project => !project.archived);
  }

  function projectById(id = getSelectedProjectId()) {
    const state = getState();
    return state.projects.find(project => project.id === id) || activeProjects()[0] || state.projects[0];
  }

  function projectRows(key, projectId) {
    const state = getState();
    return state[key].filter(row => row.projectId === projectId || (!row.projectId && projectById(projectId)?.symbol === 'MSTY'));
  }

  function sortedEvents(projectId) {
    const trades = projectRows('trades',projectId).map(row => ({...row,eventType:'trade'}));
    const splits = projectRows('splits',projectId).map(row => ({...row,eventType:'split'}));
    return [...trades,...splits].sort((a,b) => {
      const byDate=String(a.date).localeCompare(String(b.date));
      if(byDate)return byDate;
      const byType=(a.eventType==='split'?0:1)-(b.eventType==='split'?0:1);
      if(byType)return byType;
      return String(a.createdAt||a.id).localeCompare(String(b.createdAt||b.id));
    });
  }

  function computeProject(projectOrId) {
    const project = typeof projectOrId === 'string' ? projectById(projectOrId) : projectOrId;
    if (!project) return null;
    const trades = projectRows('trades',project.id);
    const dividends = projectRows('dividends',project.id);
    const adjustments = projectRows('cashAdjustments',project.id);
    const targetUnits = Math.max(.000001,n(project.targetUnits));
    let factor=1, shares=0, normalizedShares=0, costBasis=0, realized=0, directBuyCost=0, sellProceeds=0;
    let reinvestNormalized=0, reinvestAmount=0, reinvestCount=0, targetReachedDate='', targetBasisSuggestion=0;
    const milestoneDates={25:'',50:'',75:'',100:''}, oversells=[];
    for (const event of sortedEvents(project.id)) {
      if (event.eventType === 'split') {
        const ratio=n(event.to)/n(event.from);
        if (ratio>0 && Number.isFinite(ratio)) { shares*=ratio; factor*=ratio; }
      } else if (event.type === 'buy') {
        const quantity=Math.max(0,n(event.shares)), price=Math.max(0,n(event.price)), amount=quantity*price;
        shares+=quantity; normalizedShares+=quantity/factor; costBasis+=amount;
        if (event.buyType==='direct' || event.buyType==='opening') directBuyCost+=amount;
        if (event.buyType==='reinvest') { reinvestNormalized+=quantity/factor; reinvestAmount+=amount; reinvestCount++; }
        if (event.buyType==='mixed') {
          const dividendPart=clamp(n(event.reinvestAmountUSD),0,amount);
          reinvestNormalized+=amount>0?(quantity*dividendPart/amount)/factor:0;
          reinvestAmount+=dividendPart; directBuyCost+=Math.max(0,amount-dividendPart);
          if (dividendPart>0) reinvestCount++;
        }
      } else if (event.type === 'sell') {
        const quantity=Math.max(0,n(event.shares)), price=Math.max(0,n(event.price));
        if (quantity>shares+1e-8) oversells.push(event);
        const safeQuantity=Math.min(quantity,Math.max(0,shares));
        const avg=shares>0?costBasis/shares:0;
        realized+=safeQuantity*(price-avg); costBasis-=safeQuantity*avg; shares-=safeQuantity;
        normalizedShares-=safeQuantity/factor; sellProceeds+=safeQuantity*price;
      }
      const progress=normalizedShares/targetUnits;
      for (const pct of [25,50,75,100]) if (!milestoneDates[pct] && progress+1e-10>=pct/100) milestoneDates[pct]=event.date;
      if (!targetReachedDate && progress+1e-10>=1) { targetReachedDate=event.date; targetBasisSuggestion=Math.max(0,directBuyCost-sellProceeds); }
    }
    shares=Math.abs(shares)<1e-9?0:shares;
    costBasis=Math.max(0,Math.abs(costBasis)<1e-7?0:costBasis);
    const currentPrice=Math.max(0,n(project.currentPrice)), marketValue=shares*currentPrice;
    const unrealized=marketValue-costBasis, avgCost=shares>0?costBasis/shares:0, currentTarget=targetUnits*factor;
    const dividendsTotal=dividends.reduce((sum,row)=>sum+n(row.amountUSD),0);
    const currentYear=String(new Date().getFullYear());
    const yearDividends=dividends.filter(row=>String(row.date).startsWith(currentYear)).reduce((sum,row)=>sum+n(row.amountUSD),0);
    const recentDividend=[...dividends].sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0] || null;
    const recentCount=project.distributionFrequency==='weekly'?4:3;
    const recent=[...dividends].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,recentCount);
    const monthlyEstimate=recent.length ? recent.reduce((sum,row)=>sum+n(row.amountUSD),0)/recent.length*(project.distributionFrequency==='weekly'?4.33:1) : 0;
    const adjustmentTotal=adjustments.reduce((sum,row)=>sum+n(row.amountUSD),0);
    const dividendAvailable=Math.max(0,n(project.initialDividendBalance))+dividendsTotal+adjustmentTotal-reinvestAmount;
    return {
      project,trades,dividends,adjustments,factor,shares,normalizedShares,costBasis,realized,directBuyCost,sellProceeds,
      reinvestAmount,reinvestCount,reinvestShares:reinvestNormalized*factor,currentPrice,marketValue,unrealized,avgCost,
      currentTarget,progress:currentTarget>0?shares/currentTarget:0,dividendsTotal,yearDividends,recentDividend,monthlyEstimate,
      dividendAvailable,totalReturn:unrealized+realized+dividendsTotal,targetReachedDate,targetBasisSuggestion,milestoneDates,oversells
    };
  }

  function recoveryStats(calc) {
    const recovery=calc.project.recovery || blankRecovery();
    if (!recovery.locked) return {dividendRecovery:0,sellRecovery:0,total:0,remaining:0,pct:0};
    const dividendRecovery=calc.dividends.filter(row=>row.date>=recovery.startDate).reduce((sum,row)=>sum+n(row.amountUSD),0);
    const sellRecovery=calc.trades.filter(row=>row.type==='sell'&&row.date>=recovery.startDate).reduce((sum,row)=>sum+n(row.shares)*n(row.price),0);
    const total=dividendRecovery+sellRecovery, basis=Math.max(0,n(recovery.basis));
    return {dividendRecovery,sellRecovery,total,remaining:Math.max(0,basis-total),pct:basis>0?total/basis*100:0};
  }

  function totals() {
    const rows=activeProjects().map(computeProject).filter(Boolean);
    return {
      rows, marketValue:rows.reduce((sum,row)=>sum+row.marketValue,0), costBasis:rows.reduce((sum,row)=>sum+row.costBasis,0),
      unrealized:rows.reduce((sum,row)=>sum+row.unrealized,0), totalReturn:rows.reduce((sum,row)=>sum+row.totalReturn,0),
      dividendsTotal:rows.reduce((sum,row)=>sum+row.dividendsTotal,0), yearDividends:rows.reduce((sum,row)=>sum+row.yearDividends,0),
      monthlyEstimate:rows.reduce((sum,row)=>sum+row.monthlyEstimate,0), dividendAvailable:rows.reduce((sum,row)=>sum+row.dividendAvailable,0)
    };
  }

  return { activeProjects, projectById, projectRows, sortedEvents, computeProject, recoveryStats, totals };
}
