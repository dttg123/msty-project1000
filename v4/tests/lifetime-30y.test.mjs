import assert from 'node:assert/strict';
import { blankProject, blankState, normalizeV4 } from '../modules/state.js';
import { createPortfolioEngine } from '../modules/portfolio.js';
import { buildDividendAnalytics } from '../modules/dividend-analytics.js';
import { buildTossSync, mergeTossSourceLedger } from '../modules/toss.js';

const state=blankState();
state.projects=[];state.trades=[];state.dividends=[];state.splits=[];state.cashAdjustments=[];
const specs=[
  ['MSTY','highYield','weekly'],['CONY','highYield','weekly'],['NVDY','highYield','weekly'],['YMAX','highYield','weekly'],
  ['SCHD','growth','quarterly'],['KO','growth','quarterly']
];
for(const [symbol,category,frequency] of specs){
  const project=blankProject(symbol,symbol);Object.assign(project,{id:`life-${symbol.toLowerCase()}`,category,distributionFrequency:frequency,currentPrice:25,targetUnits:1000});state.projects.push(project);
  state.trades.push({id:`open-${symbol}`,projectId:project.id,symbol,date:'1996-01-02',type:'buy',buyType:'direct',shares:100,price:10,createdAt:'open'});
}
let dividendId=0;
for(let year=1996;year<=2025;year++){
  for(const project of state.projects){
    const high=project.category==='highYield',payments=high?12:4;
    for(let index=0;index<payments;index++){
      const month=high?index+1:(index+1)*3,amount=high?50+(year%5)*3:20*Math.pow(1.055,year-1996);
      state.dividends.push({id:`life-d-${dividendId++}`,projectId:project.id,symbol:project.symbol,date:`${year}-${String(month).padStart(2,'0')}-15`,amountUSD:Number(amount.toFixed(4)),sharesAtPayment:100});
    }
  }
}
state.splits.push({id:'life-split',projectId:'life-msty',date:'2016-01-01',from:2,to:1,type:'reverse'});
const engine=createPortfolioEngine(()=>state,()=>state.projects[0].id),total=engine.totals();
assert.equal(total.rows.length,6);
assert.equal(state.dividends.length,4*30*12+2*30*4);
assert.ok(total.rows.every(calc=>Number.isFinite(calc.analytics.trailingNet)&&Number.isFinite(calc.lifetimeDividendRecoveryPct)));
const schd=total.rows.find(calc=>calc.project.symbol==='SCHD');
assert.ok(schd.analytics.cagr10>5&&schd.analytics.cagr10<6,'growth CAGR must come from completed actual DPS years');
assert.ok(schd.analytics.increaseStreak>=20);
const normalized=normalizeV4(structuredClone(state));
assert.equal(normalized.projects.filter(project=>project.category==='growth').length,2);
const source1=mergeTossSourceLedger({}, {orders:[{id:'old-order',symbol:'MSTY',date:'2025-01-02',side:'BUY',shares:1,price:20,currency:'USD'}],dividends:[{id:'old-div',symbol:'MSTY',date:'2025-01-10',amountUSD:2,currency:'USD'}]},'2025-01-11T00:00:00Z');
const source2=mergeTossSourceLedger(source1,{orders:[],dividends:[]},'2026-01-11T00:00:00Z');
assert.deepEqual(source2,source1,'disconnect or empty sync must preserve source history');
const sync=buildTossSync({orders:[],dividends:[{id:'new-div',symbol:'SCHD',date:'2025-12-15',amountUSD:3,currency:'USD'}]},{existingTrades:state.trades,existingDividends:state.dividends});
assert.equal(sync.dividendCandidates.length,1);
const analytics=buildDividendAnalytics(schd.project,schd.postedDividends,[],schd.avgCost,'2026-09-23');
assert.ok(analytics.trailingYoc>0);
const missingYear=schd.postedDividends.filter(row=>!row.date.startsWith('2020-'));
const gapAnalytics=buildDividendAnalytics(schd.project,missingYear,[],schd.avgCost,'2026-09-23');
assert.equal(gapAnalytics.cagr5,null,'CAGR must not bridge a missing calendar year');
console.log(`DividendOS lifetime 30-year QA: PASS (${state.dividends.length} dividends, 6 symbols)`);
