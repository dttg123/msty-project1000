import { blankRecovery } from './state.js';
import { clamp, isDate, n, todayISO } from './utils.js';
import { incomeEstimate } from './income.js?v=0.11.3-r53';

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

  function sharesAtDate(projectId,date) {
    if(!isDate(date))return 0;
    let shares=0;
    for(const event of sortedEvents(projectId).filter(row=>isDate(row.date)&&String(row.date)<=date)){
      if(event.eventType==='split'){
        const ratio=n(event.to)/n(event.from);
        if(ratio>0&&Number.isFinite(ratio))shares*=ratio;
      }else if(event.type==='buy')shares+=Math.max(0,n(event.shares));
      else if(event.type==='sell')shares-=Math.max(0,n(event.shares));
    }
    return Math.max(0,Math.abs(shares)<1e-9?0:shares);
  }

  function computeProject(projectOrId) {
    const project = typeof projectOrId === 'string' ? projectById(projectOrId) : projectOrId;
    if (!project) return null;
    const asOf=todayISO(),trades=projectRows('trades',project.id),dividends=projectRows('dividends',project.id),adjustments=projectRows('cashAdjustments',project.id);
    const postedTrades=trades.filter(row=>isDate(row.date)&&String(row.date)<=asOf&&(row.type==='buy'||row.type==='sell')&&n(row.shares)>0&&n(row.price)>=0);
    const postedDividends=dividends.filter(row=>isDate(row.date)&&String(row.date)<=asOf&&n(row.amountUSD)>0);
    const postedAdjustments=adjustments.filter(row=>isDate(row.date)&&String(row.date)<=asOf&&Math.abs(n(row.amountUSD))>0);
    const targetUnits = Math.max(.000001,n(project.targetUnits));
    let factor=1, shares=0, normalizedShares=0, costBasis=0, realized=0, directBuyCost=0, sellProceeds=0;
    let directShares=0, reinvestShares=0, reinvestAmount=0, reinvestCount=0, targetReachedDate='', targetBasisSuggestion=0;
    const milestoneDates={25:'',50:'',75:'',100:''}, oversells=[], effectiveSells=[];
    const postedTradeIds=new Set(postedTrades.map(row=>row.id));
    for (const event of sortedEvents(project.id).filter(row=>row.eventType==='trade'?postedTradeIds.has(row.id):isDate(row.date)&&String(row.date)<=asOf&&n(row.from)>0&&n(row.to)>0)) {
      if (event.eventType === 'split') {
        const ratio=n(event.to)/n(event.from);
        if (ratio>0 && Number.isFinite(ratio)) { shares*=ratio; directShares*=ratio; reinvestShares*=ratio; factor*=ratio; }
      } else if (event.type === 'buy') {
        const quantity=Math.max(0,n(event.shares)), price=Math.max(0,n(event.price)), amount=quantity*price;
        shares+=quantity; normalizedShares+=quantity/factor; costBasis+=amount;
        if (event.buyType==='direct' || event.buyType==='opening') { directBuyCost+=amount; directShares+=quantity; }
        if (event.buyType==='reinvest') { reinvestShares+=quantity; reinvestAmount+=amount; reinvestCount++; }
        if (event.buyType==='mixed') {
          const dividendPart=clamp(n(event.reinvestAmountUSD),0,amount);
          const reinvestQuantity=amount>0?quantity*dividendPart/amount:0;
          reinvestShares+=reinvestQuantity; directShares+=quantity-reinvestQuantity;
          reinvestAmount+=dividendPart; directBuyCost+=Math.max(0,amount-dividendPart);
          if (dividendPart>0) reinvestCount++;
        }
      } else if (event.type === 'sell') {
        const quantity=Math.max(0,n(event.shares)), price=Math.max(0,n(event.price));
        if (quantity>shares+1e-8) oversells.push(event);
        const safeQuantity=Math.min(quantity,Math.max(0,shares));
        const avg=shares>0?costBasis/shares:0;
        const directRatio=shares>0?directShares/shares:0;
        realized+=safeQuantity*(price-avg); costBasis-=safeQuantity*avg; shares-=safeQuantity;
        directShares=Math.max(0,directShares-safeQuantity*directRatio);
        reinvestShares=Math.max(0,reinvestShares-safeQuantity*(1-directRatio));
        normalizedShares-=safeQuantity/factor; sellProceeds+=safeQuantity*price;
        effectiveSells.push({...event,effectiveShares:safeQuantity,effectiveProceeds:safeQuantity*price});
      }
      const progress=normalizedShares/targetUnits;
      for (const pct of [25,50,75,100]) if (!milestoneDates[pct] && progress+1e-10>=pct/100) milestoneDates[pct]=event.date;
      if (!targetReachedDate && progress+1e-10>=1) { targetReachedDate=event.date; targetBasisSuggestion=Math.max(0,directBuyCost-sellProceeds); }
    }
    shares=Math.abs(shares)<1e-9?0:shares;
    costBasis=Math.max(0,Math.abs(costBasis)<1e-7?0:costBasis);
    const currentPrice=Math.max(0,n(project.currentPrice)), marketValue=shares*currentPrice;
    const priceAvailable=currentPrice>0, unrealized=priceAvailable?marketValue-costBasis:0, avgCost=shares>0?costBasis/shares:0, currentTarget=targetUnits*factor;
    const dividendsTotal=postedDividends.reduce((sum,row)=>sum+n(row.amountUSD),0);
    const currentYear=String(new Date().getFullYear());
    const yearDividends=postedDividends.filter(row=>String(row.date).startsWith(currentYear)).reduce((sum,row)=>sum+n(row.amountUSD),0);
    const recentDividend=[...postedDividends].sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0] || null;
    const sortedDividends=[...postedDividends].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const stableCount=project.distributionFrequency==='weekly'?8:3, shortCount=project.distributionFrequency==='weekly'?4:1;
    const stableRecent=sortedDividends.slice(0,stableCount),shortRecent=sortedDividends.slice(0,shortCount);
    const monthlyFactor=project.distributionFrequency==='weekly'?4.33:1;
    const rawMonthlyEstimate=stableRecent.length ? stableRecent.reduce((sum,row)=>sum+n(row.amountUSD),0)/stableRecent.length*monthlyFactor : 0;
    const rawShortMonthlyEstimate=shortRecent.length ? shortRecent.reduce((sum,row)=>sum+n(row.amountUSD),0)/shortRecent.length*monthlyFactor : 0;
    const income=incomeEstimate(project,postedDividends,projectRows('splits',project.id),shares);
    const perShareRows=income.payments.filter(row=>row.known);
    const stablePerShareRows=perShareRows.slice(0,stableCount),shortPerShareRows=perShareRows.slice(0,shortCount);
    const stablePerShare=stablePerShareRows.length?stablePerShareRows.reduce((sum,row)=>sum+row.perShare,0)/stablePerShareRows.length:0;
    const shortPerShare=shortPerShareRows.length?shortPerShareRows.reduce((sum,row)=>sum+row.perShare,0)/shortPerShareRows.length:0;
    const perShareTrendPct=stablePerShare>0?(shortPerShare/stablePerShare-1)*100:0;
    const annualizedDistributionPerShare=income.perShare*income.spec.year;
    const annualizedCurrentYield=currentPrice>0?annualizedDistributionPerShare/currentPrice*100:0;
    const currentMonth=todayISO().slice(0,7);
    const currentMonthDividends=postedDividends.filter(row=>String(row.date).startsWith(currentMonth)).reduce((sum,row)=>sum+n(row.amountUSD),0);
    const cutoff=new Date();cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);const cutoffISO=cutoff.toISOString().slice(0,10);
    const trailing12Dividends=postedDividends.filter(row=>String(row.date)>=cutoffISO).reduce((sum,row)=>sum+n(row.amountUSD),0);
    const latestDividendDate=sortedDividends[0]?.date||'';
    const latestDividendAgeDays=latestDividendDate?Math.max(0,Math.floor((Date.now()-new Date(`${latestDividendDate}T12:00:00Z`).getTime())/86400000)):Infinity;
    const recentGaps=stableRecent.slice(0,-1).map((row,index)=>Math.abs(new Date(`${row.date}T12:00:00Z`)-new Date(`${stableRecent[index+1].date}T12:00:00Z`))/86400000).filter(Number.isFinite).sort((a,b)=>a-b);
    const medianGap=recentGaps.length?recentGaps[Math.floor(recentGaps.length/2)]:Infinity;
    const estimateReliable=income.reliable;
    const estimateStale=!!postedDividends.length&&!estimateReliable;
    const monthlyEstimate=income.monthly,shortMonthlyEstimate=income.shortMonthly;
    const adjustmentTotal=postedAdjustments.reduce((sum,row)=>sum+n(row.amountUSD),0);
    const dividendAvailable=Math.max(0,n(project.initialDividendBalance))+dividendsTotal+adjustmentTotal-reinvestAmount;
    const cashLedger=[
      ...(n(project.initialDividendBalance)?[{id:'opening-balance',date:project.initialDividendBalanceDate||'0000-01-01',createdAt:'',kind:'opening',amountUSD:Math.max(0,n(project.initialDividendBalance))}]:[]),
      ...postedDividends.map(row=>({...row,kind:'dividend',amountUSD:n(row.amountUSD)})),
      ...postedAdjustments.map(row=>({...row,kind:'adjustment',amountUSD:n(row.amountUSD)})),
      ...postedTrades.filter(row=>row.type==='buy'&&(row.buyType==='reinvest'||row.buyType==='mixed')).map(row=>({...row,kind:'reinvest',amountUSD:-(row.buyType==='mixed'?clamp(n(row.reinvestAmountUSD),0,n(row.shares)*n(row.price)):n(row.shares)*n(row.price))}))
    ].sort((a,b)=>String(a.date).localeCompare(String(b.date))||({opening:0,dividend:1,adjustment:2,reinvest:3}[a.kind]-{opening:0,dividend:1,adjustment:2,reinvest:3}[b.kind])||String(a.createdAt||a.id).localeCompare(String(b.createdAt||b.id)));
    let cashBalance=0,minDividendBalance=0;const cashDeficitEvents=[];
    for(const row of cashLedger){cashBalance+=n(row.amountUSD);minDividendBalance=Math.min(minDividendBalance,cashBalance);if(n(row.amountUSD)<0&&cashBalance<-.0001)cashDeficitEvents.push({...row,balance:cashBalance});}
    return {
      project,trades,dividends,adjustments,postedTrades,postedDividends,postedAdjustments,factor,shares,normalizedShares,costBasis,realized,directBuyCost,sellProceeds,
      directShares,reinvestAmount,reinvestCount,reinvestShares,currentPrice,priceAvailable,marketValue,unrealized,avgCost,
      currentTarget,progress:currentTarget>0?shares/currentTarget:0,dividendsTotal,yearDividends,currentMonthDividends,trailing12Dividends,
      recentDividend,monthlyEstimate,shortMonthlyEstimate,rawMonthlyEstimate,rawShortMonthlyEstimate,estimateReliable,medianDividendGapDays:medianGap,
      stablePerShare,shortPerShare,perShareTrendPct,annualizedDistributionPerShare,annualizedCurrentYield,
      latestDividendAgeDays,estimateStale,dividendAvailable,cashLedger,income,
      minDividendBalance,cashDeficitEvents,totalReturn:priceAvailable?unrealized+realized+dividendsTotal:null,
      targetReachedDate,targetBasisSuggestion,milestoneDates,oversells,effectiveSells
    };
  }

  function recoveryStats(calc) {
    const recovery=calc.project.recovery || blankRecovery();
    if (!recovery.locked) return {dividendRecovery:0,sellRecovery:0,total:0,remaining:0,pct:0,milestoneDates:{25:'',50:'',75:'',100:''}};
    const dividendRecovery=calc.postedDividends.filter(row=>row.date>=recovery.startDate).reduce((sum,row)=>sum+n(row.amountUSD),0);
    const sellRecovery=calc.effectiveSells.filter(row=>row.date>=recovery.startDate).reduce((sum,row)=>sum+n(row.effectiveProceeds),0);
    const total=dividendRecovery+sellRecovery, basis=Math.max(0,n(recovery.basis));
    const events=[
      ...calc.postedDividends.filter(row=>row.date>=recovery.startDate).map(row=>({date:row.date,amount:n(row.amountUSD),order:0})),
      ...calc.effectiveSells.filter(row=>row.date>=recovery.startDate).map(row=>({date:row.date,amount:n(row.effectiveProceeds),order:1}))
    ].sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.order-b.order);
    const milestoneDates={25:'',50:'',75:'',100:''};let running=0;
    for(const event of events){running+=event.amount;for(const level of [25,50,75,100])if(!milestoneDates[level]&&basis>0&&running+1e-8>=basis*level/100)milestoneDates[level]=event.date;}
    return {dividendRecovery,sellRecovery,total,remaining:Math.max(0,basis-total),pct:basis>0?total/basis*100:0,milestoneDates};
  }

  function totals() {
    const rows=activeProjects().map(computeProject).filter(Boolean);
    const received=getState().dividends.filter(row=>isDate(row.date)&&row.date<=todayISO()&&n(row.amountUSD)>0);
    return {
      rows, marketValue:rows.reduce((sum,row)=>sum+row.marketValue,0), costBasis:rows.reduce((sum,row)=>sum+row.costBasis,0),
      unrealized:rows.reduce((sum,row)=>sum+row.unrealized,0), totalReturn:rows.every(row=>row.priceAvailable)?rows.reduce((sum,row)=>sum+n(row.totalReturn),0):null,
      dividendsTotal:received.reduce((sum,row)=>sum+n(row.amountUSD),0), yearDividends:received.filter(row=>row.date.startsWith(todayISO().slice(0,4))).reduce((sum,row)=>sum+n(row.amountUSD),0),
      currentMonthDividends:rows.reduce((sum,row)=>sum+row.currentMonthDividends,0),trailing12Dividends:rows.reduce((sum,row)=>sum+row.trailing12Dividends,0),
      monthlyEstimate:rows.reduce((sum,row)=>sum+row.monthlyEstimate,0), dividendAvailable:rows.reduce((sum,row)=>sum+row.dividendAvailable,0),
      missingPriceCount:rows.filter(row=>!row.priceAvailable).length,staleEstimateCount:rows.filter(row=>row.estimateStale&&row.dividends.length).length
    };
  }

  return { activeProjects, projectById, projectRows, sortedEvents, sharesAtDate, computeProject, recoveryStats, totals };
}
