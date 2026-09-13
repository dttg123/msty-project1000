import assert from 'node:assert/strict';
import { blankProject, blankState, migrate, migrateLegacy, normalizeV4 } from '../modules/state.js';
import { createPortfolioEngine } from '../modules/portfolio.js';
import { buildMigrationAudit, summarizeLegacyState } from '../modules/migration.js';

function engineFor(state, selected = state.projects[0]?.id || '') {
  return createPortfolioEngine(() => state, () => selected);
}

function nearly(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function testLegacyRepairAndMigration() {
  const legacy = {
    version:3.1,
    settings:{targetUnits:1000,currentPrice:12.5,exchangeRate:1413,warningKRW:18000000,thresholdKRW:20000000},
    recovery:{locked:false},
    trades:[
      {id:'t1',type:'buy',buyType:'mixed',date:'2026-07-25',shares:4,price:12.33,reinvestAmountUSD:40.77},
      {id:'t2',type:'buy',buyType:'reinvest',date:'2026-08-05',shares:3,price:12.83},
      {id:'t3',type:'buy',buyType:'reinvest',date:'2026-08-13',shares:3,price:12.17}
    ],
    dividends:[
      {id:'d1',date:'2026-07-24',amountUSD:40.77},
      {id:'d2',date:'2026-07-31',amountUSD:41.36},
      {id:'d3',date:'2026-08-07',amountUSD:39.30}
    ],
    splits:[], meta:{}
  };
  const migrated = migrateLegacy(legacy);
  assert.equal(migrated.version, 4);
  assert.equal(migrated.meta.migratedFrom, 'MSTY PROJECT1000 V3.2.1');
  assert.equal(migrated.projects[0].initialDividendBalance, 10.78);
  assert.deepEqual(migrated.trades.map(row => row.date), ['2026-07-28','2026-08-07','2026-08-17']);
  assert.ok(migrated.trades.every(row => row.projectId === 'p-msty' && row.symbol === 'MSTY'));
  assert.ok(migrated.dividends.every(row => row.projectId === 'p-msty' && row.symbol === 'MSTY'));
  const viaGeneric = migrate(legacy);
  assert.equal(viaGeneric.meta.migratedFrom, 'MSTY PROJECT1000 V3.2.1');
  assert.equal(migrated.settings.displayCurrency, 'KRW');
  const calc=engineFor(migrated).computeProject(migrated.projects[0]);
  const audit=buildMigrationAudit(legacy,migrated,calc);
  assert.equal(audit.passed,true);
  assert.equal(audit.source.tradeCount,3);
  assert.equal(audit.source.dividendCount,3);
  const summary=summarizeLegacyState(legacy);
  nearly(summary.shares,10);
  const changed=structuredClone(migrated);changed.dividends[0].amountUSD+=1;
  const changedAudit=buildMigrationAudit(legacy,changed,engineFor(changed).computeProject(changed.projects[0]));
  assert.equal(changedAudit.passed,false);
  assert.equal(changedAudit.checks.find(check=>check.key==='dividendsTotal').passed,false);
}

function testSplitSellAndRecovery() {
  const state=blankState();
  const project=state.projects[0];
  project.id='p-msty'; project.targetUnits=1000; project.currentPrice=25; project.initialDividendBalance=10;
  state.trades=[
    {id:'b1',projectId:project.id,date:'2026-01-01',type:'buy',buyType:'direct',shares:100,price:10,createdAt:'1'},
    {id:'b2',projectId:project.id,date:'2026-03-01',type:'buy',buyType:'reinvest',shares:20,price:12,createdAt:'2'},
    {id:'s1',projectId:project.id,date:'2026-05-01',type:'sell',shares:10,price:30,createdAt:'3'}
  ];
  state.splits=[{id:'sp1',projectId:project.id,date:'2026-04-01',type:'split',from:1,to:2,createdAt:'1'}];
  state.dividends=[{id:'d1',projectId:project.id,date:'2026-02-01',amountUSD:100},{id:'d2',projectId:project.id,date:'2026-06-01',amountUSD:80}];
  const calc=engineFor(state).computeProject(project);
  nearly(calc.shares,230);
  nearly(calc.costBasis,1188.3333333333333);
  nearly(calc.realized,248.33333333333334);
  nearly(calc.dividendAvailable,-50);
  nearly(calc.currentTarget,2000);
  nearly(calc.progress,.115);
  assert.equal(calc.cashDeficitEvents.length,1);
  nearly(calc.minDividendBalance,-130);
  nearly(calc.reinvestShares,38.333333333333336);
  assert.equal(calc.oversells.length,0);
  project.recovery={locked:true,basis:500,startDate:'2026-05-01'};
  const recovery=engineFor(state).recoveryStats(calc);
  nearly(recovery.total,380);
  nearly(recovery.remaining,120);
  nearly(recovery.pct,76);
  assert.equal(recovery.milestoneDates[25],'2026-05-01');
  assert.equal(recovery.milestoneDates[50],'2026-05-01');
  assert.equal(recovery.milestoneDates[75],'2026-06-01');
  assert.equal(recovery.milestoneDates[100],'');
}

function testProjectIsolationAndThirtyYears() {
  const state=blankState();
  state.projects=[]; state.trades=[]; state.dividends=[]; state.splits=[]; state.cashAdjustments=[];
  const symbols=['MSTY','CONY','JEPQ'];
  for (let index=0; index<symbols.length; index++) {
    const project=blankProject(symbols[index],`${symbols[index]} Fund`);
    project.id=`p-${symbols[index].toLowerCase()}`;
    project.targetUnits=[1000,500,300][index];
    project.currentPrice=10+index*5;
    project.distributionFrequency=index===2?'monthly':'weekly';
    project.colorIndex=index;
    state.projects.push(project);
  }
  let tradeCount=0, dividendCount=0;
  for (let month=0; month<360; month++) {
    const year=1990+Math.floor(month/12), mm=String(month%12+1).padStart(2,'0');
    for (let index=0; index<state.projects.length; index++) {
      const project=state.projects[index];
      state.trades.push({id:`t-${month}-${index}`,projectId:project.id,symbol:project.symbol,date:`${year}-${mm}-05`,type:'buy',buyType:month%3===0?'reinvest':'direct',shares:index+1,price:8+index+month/100,createdAt:`${month}-${index}`});
      state.dividends.push({id:`d-${month}-${index}`,projectId:project.id,symbol:project.symbol,date:`${year}-${mm}-20`,amountUSD:5+index+month/50});
      tradeCount++; dividendCount++;
    }
  }
  assert.equal(tradeCount,1080);
  assert.equal(dividendCount,1080);
  const engine=engineFor(state);
  const total=engine.totals();
  assert.equal(total.rows.length,3);
  assert.ok(total.rows.every(row => row.trades.length===360 && row.dividends.length===360));
  nearly(total.marketValue,total.rows.reduce((sum,row)=>sum+row.marketValue,0));
  nearly(total.costBasis,total.rows.reduce((sum,row)=>sum+row.costBasis,0));
  nearly(total.dividendsTotal,total.rows.reduce((sum,row)=>sum+row.dividendsTotal,0));
  for (const row of total.rows) {
    assert.ok(Object.values(row).filter(value=>typeof value==='number').every(Number.isFinite));
  }
  const normalized=normalizeV4(JSON.parse(JSON.stringify(state)));
  assert.equal(normalized.trades.length,1080);
  assert.equal(normalized.dividends.length,1080);
  assert.equal(normalized.projects.length,3);
}

function testTenYearCorporateActionLedgerAgainstReference() {
  const state=blankState(),project=state.projects[0];project.id='p-msty';project.currentPrice=17;project.targetUnits=1000;
  let shares=0,costBasis=0,realized=0,sellProceeds=0,factor=1,normalizedShares=0,dividendsTotal=0,reinvestAmount=0;
  for(let month=0;month<120;month++){
    const year=2016+Math.floor(month/12),mm=String(month%12+1).padStart(2,'0');
    if(month>0&&month%36===0){const ratio=month%72===0?.5:2;state.splits.push({id:`sp-${month}`,projectId:project.id,date:`${year}-${mm}-01`,from:ratio===2?1:2,to:ratio===2?2:1});shares*=ratio;costBasis=costBasis;factor*=ratio;}
    const quantity=1+(month%7),price=8+(month%13)*.37,buyType=month%4===0?'reinvest':'direct';
    state.trades.push({id:`b-${month}`,projectId:project.id,date:`${year}-${mm}-05`,type:'buy',buyType,shares:quantity,price,createdAt:`a-${month}`});
    shares+=quantity;normalizedShares+=quantity/factor;costBasis+=quantity*price;if(buyType==='reinvest')reinvestAmount+=quantity*price;
    const dividend=12+(month%9);state.dividends.push({id:`d-${month}`,projectId:project.id,date:`${year}-${mm}-15`,amountUSD:dividend,sharesAtPayment:shares});dividendsTotal+=dividend;
    if(month%10===9&&shares>=5){const sellPrice=price+2,average=costBasis/shares;state.trades.push({id:`s-${month}`,projectId:project.id,date:`${year}-${mm}-20`,type:'sell',shares:5,price:sellPrice,createdAt:`z-${month}`});realized+=5*(sellPrice-average);costBasis-=5*average;shares-=5;normalizedShares-=5/factor;sellProceeds+=5*sellPrice;}
  }
  const calc=engineFor(state).computeProject(project);
  nearly(calc.shares,shares);nearly(calc.costBasis,costBasis);nearly(calc.realized,realized);nearly(calc.sellProceeds,sellProceeds);
  nearly(calc.normalizedShares,normalizedShares);nearly(calc.currentTarget,1000*factor);nearly(calc.dividendsTotal,dividendsTotal);
  nearly(calc.dividendAvailable,dividendsTotal-reinvestAmount);assert.equal(calc.oversells.length,0);
}

function testOversellGuard() {
  const state=blankState();
  const project=state.projects[0]; project.id='p-msty'; project.currentPrice=10;
  state.trades=[
    {id:'b',projectId:project.id,date:'2026-01-01',type:'buy',buyType:'direct',shares:5,price:10},
    {id:'s',projectId:project.id,date:'2026-01-02',type:'sell',shares:9,price:11}
  ];
  const calc=engineFor(state).computeProject(project);
  assert.equal(calc.shares,0);
  assert.equal(calc.costBasis,0);
  assert.equal(calc.oversells.length,1);
  project.recovery={locked:true,basis:100,startDate:'2026-01-01'};
  const recovery=engineFor(state).recoveryStats(calc);
  nearly(recovery.sellRecovery,55);
}

function testReverseSplitPreservesEconomicGoal() {
  const state=blankState(),project=state.projects[0];
  project.id='p-msty';project.targetUnits=1000;project.currentPrice=20;
  state.trades=[{id:'b',projectId:project.id,date:'2025-01-01',type:'buy',buyType:'direct',shares:1000,price:10}];
  state.splits=[{id:'rs',projectId:project.id,date:'2026-01-01',type:'reverse',from:4,to:1}];
  const calc=engineFor(state).computeProject(project);
  nearly(calc.shares,250);nearly(calc.currentTarget,250);nearly(calc.progress,1);
  assert.equal(calc.targetReachedDate,'2025-01-01');
  assert.equal(calc.milestoneDates[100],'2025-01-01');
}

function testPriceMissingDoesNotInventLoss() {
  const state=blankState(),project=state.projects[0];
  project.id='p-msty';project.currentPrice=0;
  state.trades=[{id:'b',projectId:project.id,date:'2026-01-01',type:'buy',buyType:'direct',shares:10,price:20}];
  const calc=engineFor(state).computeProject(project),total=engineFor(state).totals();
  assert.equal(calc.priceAvailable,false);assert.equal(calc.totalReturn,null);
  assert.equal(total.totalReturn,null);assert.equal(total.missingPriceCount,1);
}

function testPerShareFourAndEightPaymentTrend() {
  const state=blankState(),project=state.projects[0];project.id='p-msty';project.currentPrice=20;project.distributionFrequency='weekly';
  for(let index=1;index<=8;index++)state.dividends.push({id:`d${index}`,projectId:project.id,date:`2026-01-${String(index).padStart(2,'0')}`,amountUSD:index*10,sharesAtPayment:10});
  const calc=engineFor(state).computeProject(project);
  nearly(calc.stablePerShare,4.5);nearly(calc.shortPerShare,6.5);
  nearly(calc.perShareTrendPct,44.44444444444444);
  nearly(calc.annualizedDistributionPerShare,234);
  nearly(calc.annualizedCurrentYield,1170);
  assert.equal(calc.estimateReliable,false);
  nearly(calc.monthlyEstimate,0);
}

function testFreshWeeklyIncomeEstimate() {
  const state=blankState(),project=state.projects[0];project.id='p-msty';project.distributionFrequency='weekly';
  for(let index=0;index<8;index++){const date=new Date();date.setUTCDate(date.getUTCDate()-index*7);state.dividends.push({id:`fresh-${index}`,projectId:project.id,date:date.toISOString().slice(0,10),amountUSD:10,sharesAtPayment:100});}
  const calc=engineFor(state).computeProject(project);
  assert.equal(calc.estimateReliable,true);nearly(calc.medianDividendGapDays,7);nearly(calc.monthlyEstimate,43.3);
}

function testFutureActualRecordsAreExcluded() {
  const state=blankState(),project=state.projects[0];project.id='p-msty';project.currentPrice=10;
  const tomorrow=new Date();tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const future=tomorrow.toISOString().slice(0,10);
  state.trades=[{id:'past',projectId:project.id,date:'2026-01-01',type:'buy',buyType:'direct',shares:10,price:10},{id:'future-buy',projectId:project.id,date:future,type:'buy',buyType:'direct',shares:100,price:10}];
  state.trades.push({id:'invalid-buy',projectId:project.id,date:'',type:'buy',buyType:'direct',shares:999,price:10});
  state.dividends=[{id:'future-dividend',projectId:project.id,date:future,amountUSD:500}];
  state.dividends.push({id:'invalid-dividend',projectId:project.id,date:'bad-date',amountUSD:999});
  state.splits=[{id:'future-split',projectId:project.id,date:future,from:1,to:10}];
  const calc=engineFor(state).computeProject(project);
  nearly(calc.shares,10);nearly(calc.factor,1);nearly(calc.dividendsTotal,0);assert.equal(calc.trades.length,3);assert.equal(calc.postedTrades.length,1);assert.equal(calc.postedDividends.length,0);
}

function testFullSellRebuyAndCashReconciliation() {
  const state=blankState();
  const project=state.projects[0]; project.id='p-cony'; project.currentPrice=11;
  state.trades=[
    {id:'b1',projectId:project.id,date:'2024-01-02',type:'buy',buyType:'direct',shares:100,price:10},
    {id:'s1',projectId:project.id,date:'2024-03-01',type:'sell',shares:40,price:12},
    {id:'s2',projectId:project.id,date:'2024-04-01',type:'sell',shares:60,price:8},
    {id:'b2',projectId:project.id,date:'2024-05-01',type:'buy',buyType:'direct',shares:25,price:9}
  ];
  state.dividends=[{id:'d1',projectId:project.id,date:'2024-02-01',amountUSD:50}];
  state.cashAdjustments=[{id:'c1',projectId:project.id,date:'2024-05-02',amountUSD:5}];
  const calc=engineFor(state).computeProject(project);
  nearly(calc.shares,25);
  nearly(calc.costBasis,225);
  nearly(calc.avgCost,9);
  nearly(calc.realized,-40);
  nearly(calc.dividendAvailable,55);
  nearly(calc.totalReturn,60);
}

function testMixedBuyUsesDividendOnce() {
  const state=blankState();
  const project=state.projects[0]; project.id='p-jepq'; project.currentPrice=54.25;
  state.dividends=[{id:'d1',projectId:project.id,date:'2025-01-15',amountUSD:100}];
  state.trades=[{id:'b1',projectId:project.id,date:'2025-02-02',type:'buy',buyType:'mixed',shares:1,price:50,reinvestAmountUSD:40}];
  const calc=engineFor(state).computeProject(project);
  nearly(calc.shares,1);
  nearly(calc.costBasis,50);
  nearly(calc.directBuyCost,10);
  nearly(calc.reinvestAmount,40);
  nearly(calc.reinvestShares,.8);
  nearly(calc.directShares,.2);
  nearly(calc.dividendAvailable,60);
}

function testTenYearGoalAndCashflowRecovery() {
  const state=blankState(),project=state.projects[0];
  project.id='p-msty';project.targetUnits=1000;project.currentPrice=20;project.afterGoalMode='cashflow';
  for(let month=0;month<120;month++){
    const year=2016+Math.floor(month/12),mm=String(month%12+1).padStart(2,'0');
    state.trades.push({id:`goal-t-${month}`,projectId:project.id,date:`${year}-${mm}-05`,type:'buy',buyType:'direct',shares:10,price:10+month/20,createdAt:String(month)});
    state.dividends.push({id:`goal-d-${month}`,projectId:project.id,date:`${year}-${mm}-20`,amountUSD:25,createdAt:String(month)});
  }
  const calc=engineFor(state).computeProject(project);
  nearly(calc.shares,1200);nearly(calc.progress,1.2);
  assert.equal(calc.targetReachedDate,'2024-04-05');
  nearly(calc.targetBasisSuggestion,12475);
  project.recovery={locked:true,basis:calc.targetBasisSuggestion,startDate:calc.targetReachedDate};
  state.trades.push({id:'goal-sell',projectId:project.id,date:'2026-08-01',type:'sell',shares:100,price:21,createdAt:'sell'});
  const afterSell=engineFor(state).computeProject(project),recovery=engineFor(state).recoveryStats(afterSell);
  nearly(afterSell.shares,1100);nearly(recovery.sellRecovery,2100);nearly(recovery.dividendRecovery,525);
  nearly(recovery.total,2625);assert.ok(recovery.remaining>0&&recovery.pct>0&&recovery.pct<100);
}

testLegacyRepairAndMigration();
testSplitSellAndRecovery();
testProjectIsolationAndThirtyYears();
testTenYearCorporateActionLedgerAgainstReference();
testOversellGuard();
testReverseSplitPreservesEconomicGoal();
testPriceMissingDoesNotInventLoss();
testPerShareFourAndEightPaymentTrend();
testFreshWeeklyIncomeEstimate();
testFutureActualRecordsAreExcluded();
testFullSellRebuyAndCashReconciliation();
testMixedBuyUsesDividendOnce();
testTenYearGoalAndCashflowRecovery();
console.log('DividendOS v0.9.2 domain QA: PASS');
