import assert from 'node:assert/strict';
import { blankProject, blankState, normalizeV4 } from '../modules/state.js';
import { createPortfolioEngine } from '../modules/portfolio.js';
import { buildDividendAnalytics } from '../modules/dividend-analytics.js';
import { buildTossSync, mergeTossSourceLedger } from '../modules/toss.js';

const state=blankState();
state.projects=[];state.trades=[];state.dividends=[];state.splits=[];state.cashAdjustments=[];
let entryCount=0,tradeId=0,dividendId=0;
const enterTrade=row=>{
  assert.match(row.date,/^\d{4}-\d{2}-\d{2}$/);assert.ok(row.shares>0&&row.price>=0);
  state.trades.push(structuredClone({...row,id:`life-t-${tradeId++}`,createdAt:`entry-${entryCount++}`}));
};
const enterDividend=row=>{
  assert.match(row.date,/^\d{4}-\d{2}-\d{2}$/);assert.ok(row.amountUSD>0&&row.sharesAtPayment>0);
  state.dividends.push(structuredClone({...row,id:`life-d-${dividendId++}`,createdAt:`entry-${entryCount++}`}));
};
const specs=[
  ['MSTY','highYield','weekly'],['CONY','highYield','weekly'],['NVDY','highYield','weekly'],['YMAX','highYield','weekly'],
  ['SCHD','growth','quarterly'],['KO','growth','quarterly']
];
for(const [symbol,category,frequency] of specs){
  const project=blankProject(symbol,symbol);Object.assign(project,{id:`life-${symbol.toLowerCase()}`,category,distributionFrequency:frequency,currentPrice:25,targetUnits:1000});state.projects.push(project);
  enterTrade({projectId:project.id,symbol,date:'1996-01-02',type:'buy',buyType:'direct',shares:100,price:10});
}
for(let year=1996;year<=2025;year++){
  for(let month=1;month<=12;month++){
    const elapsed=(year-1996)*12+month;
    for(const project of state.projects){
      const sharesAtPayment=100+elapsed*2;
      enterTrade({projectId:project.id,symbol:project.symbol,date:`${year}-${String(month).padStart(2,'0')}-02`,type:'buy',buyType:'direct',shares:2,price:Number((10+(elapsed%19)*.17).toFixed(4))});
      if(project.category==='highYield'){
        for(const day of [4,11,18,25]){
          const perShare=.18+((elapsed+day)%9)*.006;
          enterDividend({projectId:project.id,symbol:project.symbol,date:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,amountUSD:Number((perShare*sharesAtPayment).toFixed(4)),sharesAtPayment});
        }
      }else if(month%3===0){
        const perShare=.12*Math.pow(1.055,year-1996);
        enterDividend({projectId:project.id,symbol:project.symbol,date:`${year}-${String(month).padStart(2,'0')}-15`,amountUSD:Number((perShare*sharesAtPayment).toFixed(4)),sharesAtPayment});
      }
    }
  }
}
state.splits.push({id:'life-split',projectId:'life-msty',date:'2016-01-01',from:2,to:1,type:'reverse'});
const engine=createPortfolioEngine(()=>state,()=>state.projects[0].id),total=engine.totals();
assert.equal(total.rows.length,6);
assert.equal(state.trades.length,6+6*30*12,'every monthly purchase must be an individual ledger row');
assert.equal(state.dividends.length,4*30*12*4+2*30*4,'every weekly or quarterly payment must be an individual ledger row');
assert.equal(entryCount,state.trades.length+state.dividends.length,'no 30-year cash amount may be inserted as a lump sum');
assert.ok(total.rows.every(calc=>Number.isFinite(calc.analytics.trailingNet)&&Number.isFinite(calc.lifetimeDividendRecoveryPct)));
assert.ok(total.rows.filter(calc=>calc.project.category==='highYield').every(calc=>calc.income.spec.key==='weekly'),'weekly cadence must be detected from individual payments');
assert.ok(total.rows.filter(calc=>calc.project.category==='growth').every(calc=>calc.income.spec.key==='quarterly'),'quarterly cadence must be detected from individual payments');
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
console.log(`DividendOS lifetime 30-year individual-entry QA: PASS (${state.trades.length} trades + ${state.dividends.length} dividends = ${entryCount} separately entered rows, 6 symbols)`);
