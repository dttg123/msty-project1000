import assert from 'node:assert/strict';
import { blankProject, blankState, migrate, migrateLegacy, normalizeV4 } from '../modules/state.js';
import { createPortfolioEngine } from '../modules/portfolio.js';

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
  assert.equal(calc.oversells.length,0);
  project.recovery={locked:true,basis:500,startDate:'2026-05-01'};
  const recovery=engineFor(state).recoveryStats(calc);
  nearly(recovery.total,380);
  nearly(recovery.remaining,120);
  nearly(recovery.pct,76);
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
    const year=2026+Math.floor(month/12), mm=String(month%12+1).padStart(2,'0');
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
}

testLegacyRepairAndMigration();
testSplitSellAndRecovery();
testProjectIsolationAndThirtyYears();
testOversellGuard();
console.log('DividendOS v0.9 domain QA: PASS');
