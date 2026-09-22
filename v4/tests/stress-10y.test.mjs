import assert from 'node:assert/strict';
import { blankProject, blankState, migrate } from '../modules/state.js';
import { createPortfolioEngine } from '../modules/portfolio.js';
import { createFormatters } from '../modules/format.js';
import { buildHomeMetrics } from '../modules/home-metrics.js';
import { createViews } from '../modules/views.js';

const state=blankState();
const msty=state.projects[0];
Object.assign(msty,{id:'p-msty',currentPrice:14.57,targetUnits:1000,distributionFrequency:'weekly',projectStart:'2017-01-01'});
const jepi=blankProject('JEPI','JPMorgan Equity Premium Income');
Object.assign(jepi,{id:'p-jepi',currentPrice:61,targetUnits:500,distributionFrequency:'monthly',category:'dividend',projectStart:'2017-01-01'});
const schd=blankProject('SCHD','Schwab US Dividend Equity');
Object.assign(schd,{id:'p-schd',currentPrice:29,targetUnits:500,distributionFrequency:'monthly',category:'dividend',projectStart:'2017-01-01'});
state.projects.push(jepi,schd);

let sequence=0;
const createdAt=()=>`2026-09-18T00:${String(sequence++%60).padStart(2,'0')}:00.000Z`;
for(let year=2017;year<=2026;year++){
  const lastMonth=year===2026?8:11;
  for(let month=0;month<=lastMonth;month++){
    const ym=`${year}-${String(month+1).padStart(2,'0')}`;
    const elapsed=(year-2017)*12+month+1;
    for(const [project,shares,price] of [[msty,10,18+(elapsed%9)],[jepi,4,48+(elapsed%7)],[schd,3,22+(elapsed%5)]]){
      state.trades.push({id:`t-${sequence}`,projectId:project.id,symbol:project.symbol,date:`${ym}-02`,type:'buy',buyType:elapsed%5===0?'reinvest':'direct',shares,price,createdAt:createdAt()});
    }
    for(const day of ['07','14','21','28']) state.dividends.push({id:`d-${sequence}`,projectId:msty.id,symbol:'MSTY',date:`${ym}-${day}`,amountUSD:18+(elapsed%11),sharesAtPayment:elapsed*10,createdAt:createdAt()});
    state.dividends.push({id:`d-${sequence}`,projectId:jepi.id,symbol:'JEPI',date:`${ym}-15`,amountUSD:9+(elapsed%6),sharesAtPayment:elapsed*4,createdAt:createdAt()});
    if(month%3===2)state.dividends.push({id:`d-${sequence}`,projectId:schd.id,symbol:'SCHD',date:`${ym}-20`,amountUSD:7+(elapsed%4),sharesAtPayment:elapsed*3,createdAt:createdAt()});
  }
  if(year>=2018&&year<2026){
    state.trades.push({id:`sell-${year}`,projectId:jepi.id,symbol:'JEPI',date:`${year}-12-29`,type:'sell',buyType:'',shares:2,price:55,createdAt:createdAt()});
  }
}
state.splits.push(
  {id:'split-forward',projectId:msty.id,symbol:'MSTY',date:'2021-06-01',from:1,to:2,type:'forward',createdAt:createdAt()},
  {id:'split-reverse',projectId:msty.id,symbol:'MSTY',date:'2024-06-01',from:2,to:1,type:'reverse',createdAt:createdAt()}
);
state.cashAdjustments.push(
  {id:'cash-plus',projectId:msty.id,date:'2022-07-01',amountUSD:25,label:'입금 보정'},
  {id:'cash-minus',projectId:msty.id,date:'2023-07-01',amountUSD:-10,label:'출금 보정'}
);
state.trades.push({id:'target-finish',projectId:msty.id,symbol:'MSTY',date:'2026-09-01',type:'buy',buyType:'direct',shares:1000,price:15,createdAt:createdAt()});
msty.recovery={locked:true,basis:25000,startDate:'2025-01-01',targetReachedDate:'2026-09-01',calculatedBasisAtLock:25000,confirmedAt:'2026-09-01T00:00:00.000Z'};

const restored=migrate(JSON.parse(JSON.stringify(state)));
assert.equal(restored.projects.length,3);
assert.ok(restored.trades.length>350);
assert.ok(restored.dividends.length>600);

let selectedProjectId=msty.id;
const engine=createPortfolioEngine(()=>restored,()=>selectedProjectId);
const rows=engine.totals().rows;
assert.equal(rows.length,3);
for(const calc of rows){
  assert.equal(calc.oversells.length,0,`${calc.project.symbol} oversell`);
  for(const value of [calc.shares,calc.costBasis,calc.avgCost,calc.dividendsTotal,calc.dividendAvailable,calc.monthlyEstimate]) assert.ok(Number.isFinite(value),`${calc.project.symbol} non-finite value`);
  assert.ok(calc.shares>=0);
  assert.ok(calc.costBasis>=0);
}
const mstyCalc=engine.computeProject(msty.id);
assert.ok(mstyCalc.targetReachedDate);
assert.equal(mstyCalc.factor,1);
assert.ok(mstyCalc.shares>=1000);
const recovery=engine.recoveryStats(mstyCalc);
assert.ok(recovery.total>0);
assert.ok(recovery.remaining>=0);

const metrics=buildHomeMetrics(rows,restored.dividends,new Date('2026-09-18T12:00:00Z'));
assert.equal(metrics.months.length,12);
assert.ok(metrics.nextGoal.calc.shares>0);
assert.ok(metrics.year.actual>0);

const elements=new Map(['page-home','page-projects','page-goal','page-settings'].map(id=>[id,{id,innerHTML:''}]));
globalThis.document={getElementById:id=>elements.get(id)||null};
const formatters=createFormatters(()=>restored);
const views=createViews({
  getState:()=>restored,getSelectedProjectId:()=>selectedProjectId,setSelectedProjectId:value=>{selectedProjectId=value;},
  getChartMode:()=> 'month',getChartSelection:()=> '',getHomeCashflowMode:()=> 'month',getCashflowMonthKey:()=> '',getPortfolioCategory:()=> 'highYield',setPortfolioCategory:()=>{},
  getCurrentUser:()=> null,isTossBridgeConfigured:()=> false,...engine,...formatters
});
views.renderHome(); views.renderProjects(); views.renderGoals(); views.renderSettings();
assert.match(elements.get('page-home').innerHTML,/날짜별 입금 상세/);
assert.match(elements.get('page-projects').innerHTML,/class="card transaction-history"/);
assert.doesNotMatch(elements.get('page-projects').innerHTML,/class="card transaction-history" open/);
assert.doesNotMatch(elements.get('page-goal').innerHTML,/<details class="card goal-step-card"[^>]* open/);
assert.match(elements.get('page-goal').innerHTML,/원금회수/);
assert.ok(elements.get('page-projects').innerHTML.length<250000,'portfolio HTML grew unexpectedly large');
console.log(`DividendOS v0.11.3 10-year stress QA: PASS (${restored.trades.length} trades, ${restored.dividends.length} dividends)`);
