import { blankRecovery } from './state.js';
import { clamp, isDate, n, todayISO } from './utils.js';
import { incomeEstimate } from './income.js';
import { buildDividendAnalytics } from './dividend-analytics.js';
import { applyRocToBasis, dividendCashBreakdown, economicTotalReturn, isPostedDividend, reportingDividends, tradeCashBreakdown } from './finance.js';

export function createPortfolioEngine(getState: any, getSelectedProjectId: any): any {
  function activeProjects(): any {
    return getState().projects.filter((project: any) => !project.archived);
  }

  function projectById(id = getSelectedProjectId()) {
    const state: any = getState();
    return state.projects.find((project: any) => project.id === id) || activeProjects()[0] || state.projects[0];
  }

  function projectRows(key: any, projectId: any): any {
    const state: any = getState();
    return state[key].filter((row: any) => row.projectId === projectId || (!row.projectId && projectById(projectId)?.symbol === 'MSTY'));
  }

  function sortedEvents(projectId: any): any {
    const trades: any = projectRows('trades',projectId).map((row: any) => ({...row,eventType:'trade'}));
    const splits: any = projectRows('splits',projectId).map((row: any) => ({...row,eventType:'split'}));
    return [...trades,...splits].sort((a,b) => {
      const byDate: any=String(a.date).localeCompare(String(b.date));
      if(byDate)return byDate;
      const byType: any=(a.eventType==='split'?0:1)-(b.eventType==='split'?0:1);
      if(byType)return byType;
      return String(a.createdAt||a.id).localeCompare(String(b.createdAt||b.id));
    });
  }

  function sharesAtDate(projectId: any,date: any): any {
    if(!isDate(date))return 0;
    let shares: any=0;
    for(const event of sortedEvents(projectId).filter((row: any)=>isDate(row.date)&&String(row.date)<=date)){
      if(event.eventType==='split'){
        const ratio: any=n(event.to)/n(event.from);
        if(ratio>0&&Number.isFinite(ratio))shares*=ratio;
      }else if(event.type==='buy')shares+=Math.max(0,n(event.shares));
      else if(event.type==='sell')shares-=Math.max(0,n(event.shares));
    }
    return Math.max(0,Math.abs(shares)<1e-9?0:shares);
  }

  function computeProject(projectOrId: any): any {
    const project: any = typeof projectOrId === 'string' ? projectById(projectOrId) : projectOrId;
    if (!project) return null;
    const asOf: any=todayISO(),trades=projectRows('trades',project.id),dividends=projectRows('dividends',project.id),adjustments=projectRows('cashAdjustments',project.id);
    const postedTrades: any=trades.filter((row: any)=>isDate(row.date)&&String(row.date)<=asOf&&(row.type==='buy'||row.type==='sell')&&n(row.shares)>0&&n(row.price)>=0);
    const chronological: any=(a: any,b: any)=>String(a.date).localeCompare(String(b.date))||String(a.createdAt||a.id).localeCompare(String(b.createdAt||b.id));
    const postedDividends: any=dividends.filter((row: any)=>isDate(row.date)&&isPostedDividend(row,asOf)).sort(chronological);
    const reportingRows=reportingDividends(postedDividends,n(getState().settings.exchangeRate));
    const hasKRWDividends=postedDividends.some((row: any)=>row.currency==='KRW');
    const postedAdjustments: any=adjustments.filter((row: any)=>isDate(row.date)&&String(row.date)<=asOf&&Math.abs(n(row.amountUSD))>0).sort(chronological);
    const targetUnits: any = Math.max(.000001,n(project.targetUnits));
    let factor: any=1, shares=0, normalizedShares=0, costBasis=0, realized=0, directBuyCost=0, sellProceeds=0,totalBuyCashOut=0,totalSellCashIn=0,tradeFees=0,tradeTaxes=0,rocBasisReduction=0,excessRoc=0;
    let directShares: any=0, reinvestShares=0, reinvestAmount=0, reinvestCount=0, targetReachedDate='', targetBasisSuggestion=0;
    const milestoneDates: any={25:'',50:'',75:'',100:''}, oversells=[], effectiveSells=[];
    const postedTradeIds: any=new Set(postedTrades.map((row: any)=>row.id));
    const eventOrder: any={split:0,trade:1,roc:2};
    const financialEvents: any=[...sortedEvents(project.id).filter((row: any)=>row.eventType==='trade'?postedTradeIds.has(row.id):isDate(row.date)&&String(row.date)<=asOf&&n(row.from)>0&&n(row.to)>0),...postedDividends.map((row: any)=>({...row,eventType:'roc'}))].sort((a: any,b: any)=>String(a.date).localeCompare(String(b.date))||((eventOrder[a.eventType]??3)-(eventOrder[b.eventType]??3))||String(a.createdAt||a.id).localeCompare(String(b.createdAt||b.id)));
    for (const event of financialEvents) {
      if (event.eventType === 'split') {
        const ratio: any=n(event.to)/n(event.from);
        if (ratio>0 && Number.isFinite(ratio)) { shares*=ratio; directShares*=ratio; reinvestShares*=ratio; factor*=ratio; }
      } else if (event.type === 'buy') {
        const quantity: any=Math.max(0,n(event.shares)),cash=tradeCashBreakdown(event),amount=cash.grossBuyCostUSD;
        shares+=quantity; normalizedShares+=quantity/factor; costBasis+=amount;totalBuyCashOut+=amount;tradeFees+=cash.feeUSD;tradeTaxes+=cash.taxUSD;
        if (event.buyType==='direct' || event.buyType==='opening') { directBuyCost+=amount; directShares+=quantity; }
        if (event.buyType==='reinvest') { reinvestShares+=quantity; reinvestAmount+=amount; reinvestCount++; }
        if (event.buyType==='mixed') {
          const dividendPart: any=clamp(n(event.reinvestAmountUSD),0,amount);
          const reinvestQuantity: any=amount>0?quantity*dividendPart/amount:0;
          reinvestShares+=reinvestQuantity; directShares+=quantity-reinvestQuantity;
          reinvestAmount+=dividendPart; directBuyCost+=Math.max(0,amount-dividendPart);
          if (dividendPart>0) reinvestCount++;
        }
      } else if (event.type === 'sell') {
        const quantity: any=Math.max(0,n(event.shares)),cash=tradeCashBreakdown(event);
        if (quantity>shares+1e-8) oversells.push(event);
        const safeQuantity: any=Math.min(quantity,Math.max(0,shares));
        const avg: any=shares>0?costBasis/shares:0;
        const directRatio: any=shares>0?directShares/shares:0;
        const safeRatio: any=quantity>0?safeQuantity/quantity:0,safeNet=cash.netSellProceedsUSD*safeRatio,allocatedBasis=safeQuantity*avg;
        realized+=safeNet-allocatedBasis; costBasis-=allocatedBasis; shares-=safeQuantity;totalSellCashIn+=safeNet;tradeFees+=cash.feeUSD*safeRatio;tradeTaxes+=cash.taxUSD*safeRatio;
        directShares=Math.max(0,directShares-safeQuantity*directRatio);
        reinvestShares=Math.max(0,reinvestShares-safeQuantity*(1-directRatio));
        normalizedShares-=safeQuantity/factor; sellProceeds+=safeNet;
        effectiveSells.push({...event,effectiveShares:safeQuantity,effectiveProceeds:safeNet});
      } else if(event.eventType==='roc') {
        const applied: any=applyRocToBasis(costBasis,dividendCashBreakdown(event).rocUSD);costBasis=applied.costBasisUSD;rocBasisReduction+=applied.basisReductionUSD;excessRoc+=applied.excessRocUSD;
      }
      const progress: any=normalizedShares/targetUnits;
      for (const pct of [25,50,75,100]) if (!milestoneDates[pct] && progress+1e-10>=pct/100) milestoneDates[pct]=event.date;
      if (!targetReachedDate && progress+1e-10>=1) { targetReachedDate=event.date; targetBasisSuggestion=Math.max(0,directBuyCost-sellProceeds); }
    }
    shares=Math.abs(shares)<1e-9?0:shares;
    costBasis=Math.max(0,Math.abs(costBasis)<1e-7?0:costBasis);
    const currentPrice: any=Math.max(0,n(project.currentPrice)), marketValue=shares*currentPrice;
    const priceAvailable: any=currentPrice>0, unrealized=priceAvailable?marketValue-costBasis:0, avgCost=shares>0?costBasis/shares:0, currentTarget=targetUnits*factor;
    const dividendCash: any=postedDividends.map(dividendCashBreakdown),usdDividendsTotal=dividendCash.reduce((sum: any,row: any)=>sum+row.netUSD,0),dividendsTotal=reportingRows.reduce((sum: any,row: any)=>sum+dividendCashBreakdown(row).netUSD,0),grossDividendsTotal=dividendCash.reduce((sum: any,row: any)=>sum+row.grossUSD,0),dividendTaxes=dividendCash.reduce((sum: any,row: any)=>sum+row.withholdingTaxUSD,0),dividendFees=dividendCash.reduce((sum: any,row: any)=>sum+row.feeUSD,0),rocDistributions=dividendCash.reduce((sum: any,row: any)=>sum+row.rocUSD,0),incomeDividends=dividendCash.reduce((sum: any,row: any)=>sum+row.incomeUSD,0);
    const currentYear: any=String(new Date().getFullYear());
    const yearDividends: any=reportingRows.filter((row: any)=>String(row.date).startsWith(currentYear)).reduce((sum: any,row: any)=>sum+n(row.amountUSD),0);
    const recentDividend: any=[...postedDividends].sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0] || null;
    const sortedDividends: any=[...postedDividends].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const income: any=incomeEstimate(project,reportingRows,projectRows('splits',project.id),shares);
    const stableCount: any=income.spec.stable, shortCount=income.spec.short;
    const stableRecent: any=sortedDividends.slice(0,stableCount),shortRecent=sortedDividends.slice(0,shortCount);
    const monthlyFactor: any=income.spec.year/12;
    const rawMonthlyEstimate: any=stableRecent.length ? stableRecent.reduce((sum: any,row: any)=>sum+n(row.amountUSD),0)/stableRecent.length*monthlyFactor : 0;
    const rawShortMonthlyEstimate: any=shortRecent.length ? shortRecent.reduce((sum: any,row: any)=>sum+n(row.amountUSD),0)/shortRecent.length*monthlyFactor : 0;
    const perShareRows: any=income.payments.filter((row: any)=>row.known);
    const stablePerShareRows: any=perShareRows.slice(0,stableCount),shortPerShareRows=perShareRows.slice(0,shortCount);
    const stablePerShare: any=stablePerShareRows.length?stablePerShareRows.reduce((sum: any,row: any)=>sum+row.perShare,0)/stablePerShareRows.length:0;
    const shortPerShare: any=shortPerShareRows.length?shortPerShareRows.reduce((sum: any,row: any)=>sum+row.perShare,0)/shortPerShareRows.length:0;
    const perShareTrendPct: any=stablePerShare>0?(shortPerShare/stablePerShare-1)*100:0;
    const annualizedDistributionPerShare: any=income.perShare*income.spec.year;
    const annualizedCurrentYield: any=currentPrice>0?annualizedDistributionPerShare/currentPrice*100:0;
    const currentMonth: any=todayISO().slice(0,7);
    const currentMonthDividends: any=reportingRows.filter((row: any)=>String(row.date).startsWith(currentMonth)).reduce((sum: any,row: any)=>sum+n(row.amountUSD),0);
    const cutoff: any=new Date();cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);const cutoffISO: any=cutoff.toISOString().slice(0,10);
    const trailing12Dividends: any=reportingRows.filter((row: any)=>String(row.date)>=cutoffISO).reduce((sum: any,row: any)=>sum+n(row.amountUSD),0);
    const latestDividendDate: any=sortedDividends[0]?.date||'';
    const latestDividendAgeDays: any=latestDividendDate?Math.max(0,Math.floor((Date.now()-new Date(`${latestDividendDate}T12:00:00Z`).getTime())/86400000)):Infinity;
    const recentGaps: any=stableRecent.slice(0,-1).map((row: any,index: any)=>Math.abs(new Date(`${row.date}T12:00:00Z`).getTime()-new Date(`${stableRecent[index+1].date}T12:00:00Z`).getTime())/86400000).filter(Number.isFinite).sort((a: any,b: any)=>a-b);
    const medianGap: any=recentGaps.length?recentGaps[Math.floor(recentGaps.length/2)]:Infinity;
    const estimateReliable: any=income.reliable;
    const estimateStale: any=!!postedDividends.length&&!estimateReliable;
    const monthlyEstimate: any=income.monthly,shortMonthlyEstimate=income.shortMonthly;
    const adjustmentTotal: any=postedAdjustments.reduce((sum: any,row: any)=>sum+n(row.amountUSD),0);
    const dividendAvailable: any=Math.max(0,n(project.initialDividendBalance))+usdDividendsTotal+adjustmentTotal-reinvestAmount;
    const analytics: any=buildDividendAnalytics(project,reportingRows,projectRows('splits',project.id),avgCost,asOf);
    const lifetimeDividendRecoveryPct: any=directBuyCost>0?dividendsTotal/directBuyCost*100:0;
    const cashLedger: any=[
      ...(n(project.initialDividendBalance)?[{id:'opening-balance',date:project.initialDividendBalanceDate||'0000-01-01',createdAt:'',kind:'opening',amountUSD:Math.max(0,n(project.initialDividendBalance))}]:[]),
      ...postedDividends.map((row: any)=>({...row,kind:'dividend',amountUSD:n(row.amountUSD)})),
      ...postedAdjustments.map((row: any)=>({...row,kind:'adjustment',amountUSD:n(row.amountUSD)})),
      ...postedTrades.filter((row: any)=>row.type==='buy'&&(row.buyType==='reinvest'||row.buyType==='mixed')).map((row: any)=>({...row,kind:'reinvest',amountUSD:-(row.buyType==='mixed'?clamp(n(row.reinvestAmountUSD),0,n(row.shares)*n(row.price)):n(row.shares)*n(row.price))}))
    ].sort((a: any,b: any)=>{const order: any={opening:0,dividend:1,adjustment:2,reinvest:3};return String(a.date).localeCompare(String(b.date))||(order[a.kind]-order[b.kind])||String(a.createdAt||a.id).localeCompare(String(b.createdAt||b.id));});
    let cashBalance: any=0,minDividendBalance=0;const cashDeficitEvents: any=[];
    for(const row of cashLedger){cashBalance+=n(row.amountUSD);minDividendBalance=Math.min(minDividendBalance,cashBalance);if(n(row.amountUSD)<0&&cashBalance<-.0001)cashDeficitEvents.push({...row,balance:cashBalance});}
    return {
      project,trades,dividends,adjustments,postedTrades,postedDividends,reportingRows,hasKRWDividends,usdDividendsTotal,postedAdjustments,factor,shares,normalizedShares,costBasis,realized,directBuyCost,sellProceeds,
      directShares,reinvestAmount,reinvestCount,reinvestShares,currentPrice,priceAvailable,marketValue,unrealized,avgCost,
      currentTarget,progress:currentTarget>0?shares/currentTarget:0,dividendsTotal,yearDividends,currentMonthDividends,trailing12Dividends,
      recentDividend,monthlyEstimate,shortMonthlyEstimate,rawMonthlyEstimate,rawShortMonthlyEstimate,estimateReliable,medianDividendGapDays:medianGap,
      stablePerShare,shortPerShare,perShareTrendPct,annualizedDistributionPerShare,annualizedCurrentYield,
      latestDividendAgeDays,estimateStale,dividendAvailable,cashLedger,income,analytics,lifetimeDividendRecoveryPct,
      minDividendBalance,cashDeficitEvents,totalReturn:priceAvailable&&!hasKRWDividends?economicTotalReturn({marketValueUSD:marketValue,buyCashOutUSD:totalBuyCashOut,sellCashInUSD:totalSellCashIn,dividendCashInUSD:dividendsTotal}):null,
      grossDividendsTotal,dividendTaxes,dividendFees,rocDistributions,incomeDividends,rocBasisReduction,excessRoc,totalBuyCashOut,totalSellCashIn,tradeFees,tradeTaxes,
      targetReachedDate,targetBasisSuggestion,milestoneDates,oversells,effectiveSells
    };
  }

  function recoveryStats(calc: any): any {
    const recovery: any=calc.project.recovery || blankRecovery();
    const reachedDate: any=recovery.targetReachedDate||calc.targetReachedDate||'';
    const empty: any={withdrawalRecovery:0,total:0,remaining:0,pct:0,profit:0,milestoneDates:{25:'',50:'',75:'',100:''},stage:reachedDate?'setup':'accumulating',reachedDate};
    if (!recovery.locked) return empty;
    const withdrawals: any=calc.postedAdjustments.filter((row: any)=>row.date>=recovery.startDate&&row.purpose==='recoveryWithdrawal'&&n(row.amountUSD)<0);
    const withdrawalRecovery: any=withdrawals.reduce((sum: any,row: any)=>sum+Math.abs(n(row.amountUSD)),0);
    const total: any=withdrawalRecovery, basis=Math.max(0,n(recovery.basis));
    const events: any=withdrawals.map((row: any)=>({date:row.date,amount:Math.abs(n(row.amountUSD))})).sort((a: any,b: any)=>String(a.date).localeCompare(String(b.date)));
    const milestoneDates: any={25:'',50:'',75:'',100:''};let running: any=0;
    for(const event of events){running+=event.amount;for(const level of [25,50,75,100])if(!milestoneDates[level]&&basis>0&&running+1e-8>=basis*level/100)milestoneDates[level]=event.date;}
    const pct: any=basis>0?total/basis*100:0,profit=Math.max(0,total-basis);
    return {withdrawalRecovery,total,remaining:Math.max(0,basis-total),pct,profit,milestoneDates,stage:pct>=100?'profit':'recovery',reachedDate};
  }

  function totals(): any {
    const rows: any=activeProjects().map(computeProject).filter(Boolean);
    const received: any=reportingDividends(getState().dividends.filter((row: any)=>isDate(row.date)&&isPostedDividend(row,todayISO())),n(getState().settings.exchangeRate));
    return {
      rows, marketValue:rows.reduce((sum: any,row: any)=>sum+row.marketValue,0), costBasis:rows.reduce((sum: any,row: any)=>sum+row.costBasis,0),
      unrealized:rows.reduce((sum: any,row: any)=>sum+row.unrealized,0), totalReturn:rows.every((row: any)=>row.totalReturn!==null)?rows.reduce((sum: any,row: any)=>sum+n(row.totalReturn),0):null,
      dividendsTotal:received.reduce((sum: any,row: any)=>sum+n(row.amountUSD),0), yearDividends:received.filter((row: any)=>row.date.startsWith(todayISO().slice(0,4))).reduce((sum: any,row: any)=>sum+n(row.amountUSD),0),
      currentMonthDividends:rows.reduce((sum: any,row: any)=>sum+row.currentMonthDividends,0),trailing12Dividends:rows.reduce((sum: any,row: any)=>sum+row.trailing12Dividends,0),
      monthlyEstimate:rows.reduce((sum: any,row: any)=>sum+row.monthlyEstimate,0), dividendAvailable:rows.reduce((sum: any,row: any)=>sum+row.dividendAvailable,0),
      missingPriceCount:rows.filter((row: any)=>!row.priceAvailable).length,staleEstimateCount:rows.filter((row: any)=>row.estimateStale&&row.dividends.length).length
    };
  }

  return { activeProjects, projectById, projectRows, sortedEvents, sharesAtDate, computeProject, recoveryStats, totals };
}
