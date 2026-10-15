import assert from 'node:assert/strict';
import {blankState} from '../modules/state.js';
import {createPortfolioEngine} from '../modules/portfolio.js';
import {dividendPlanStatus,projectRecovery,hasNewDividendDeficit} from '../modules/dividend-plan.js';
import {decodeAppState} from '../modules/state-decoder.js';
import {rebuildProjectFromTossSource,tossCandidateToTrade} from '../modules/toss.js';
import {buildCsvExports,createStoreZip,readStateFromBackupFile} from '../backup.js';
const state=blankState(),p=state.projects[0];p.currentPrice=9;p.priceUpdatedAt=new Date().toISOString();p.targetUnits=1000;
state.trades=[{id:'first',projectId:p.id,date:'2025-01-01',type:'buy',buyType:'direct',shares:100,price:10}];
state.dividends=[{id:'income',projectId:p.id,date:'2025-01-02',amountUSD:100}];
state.trades.push({id:'reinvest',projectId:p.id,date:'2025-01-03',type:'buy',buyType:'reinvest',shares:5,price:10,feeUSD:1});
const engine=createPortfolioEngine(()=>state,()=>p.id),calc=()=>engine.computeProject(p);
assert.equal(calc().dividendAvailable,49);assert.equal(calc().cashLedger.at(-1).balance,undefined);
assert.equal(calc().cashLedger.reduce((sum,row)=>sum+row.amountUSD,0),49,'reinvestment cash ledger includes fees');
assert.equal(projectRecovery(calc()).basis,1000);assert.equal(projectRecovery(calc()).total,0);
assert.equal(dividendPlanStatus(calc()).suggested,null);p.currentPrice=11;assert.equal(dividendPlanStatus(calc()).suggested,'outside');
p.dividendPlan={mode:'outside',history:[{mode:'outside',confirmedAt:new Date().toISOString()}]};
const original=structuredClone(state.trades);state.cashAdjustments.push({id:'use',projectId:p.id,date:'2025-01-04',amountUSD:-30,purpose:'dividendUse',destination:'isa'});
assert.equal(calc().dividendAvailable,19);assert.deepEqual(state.trades,original);
assert.equal(projectRecovery(calc()).total,30);assert.equal(projectRecovery(calc()).remaining,970);
p.currentPrice=9;assert.equal(dividendPlanStatus(calc()).suggested,'reinvest');
p.currentPrice=calc().purchaseBasis/calc().shares;assert.equal(dividendPlanStatus(calc()).suggested,null,'zero keeps mode');
p.priceUpdatedAt='2020-01-01';p.currentPrice=9;assert.equal(dividendPlanStatus(calc()).suggested,null,'stale prices cannot suggest');
p.priceUpdatedAt=new Date().toISOString();p.currentPrice=0;assert.equal(dividendPlanStatus(calc()).suggested,null,'missing prices cannot suggest');
p.currentPrice=10;
state.dividends.push({id:'roc',projectId:p.id,date:'2025-01-05',amountUSD:1,rocAmountUSD:1});
assert.equal(calc().priceUnrealized,-1,'ROC cannot flip price-only loss into profit');assert.equal(calc().unrealized,0);
const before=calc();state.cashAdjustments.push({id:'too-old',projectId:p.id,date:'2024-12-01',amountUSD:-10,purpose:'dividendUse',destination:'living'});
assert.equal(hasNewDividendDeficit(before,calc()),true,'backdated spending before receipt rejected');state.cashAdjustments.pop();
state.trades.push({id:'extra',projectId:p.id,date:'2025-01-06',type:'buy',buyType:'direct',shares:10,price:10});
assert.equal(projectRecovery(calc()).basis,1100,'fresh contribution increases target');
state.trades.push({id:'goal',projectId:p.id,date:'2025-01-07',type:'buy',buyType:'direct',shares:885,price:10});
assert.ok(calc().targetReachedDate);assert.equal(projectRecovery(calc()).total,30,'goal does not reset recovered dividends');
p.recovery={locked:true,basis:300,startDate:'2025-01-04',targetReachedDate:'2025-01-07',calculatedBasisAtLock:300,confirmedAt:'2025-01-07T00:00:00Z',method:'withdrawnOnly'};
assert.equal(projectRecovery(calc()).basis,300,'legacy locked basis retained');assert.equal(engine.recoveryStats(calc()).total,30);
assert.deepEqual(decodeAppState(state).projects[0].dividendPlan,p.dividendPlan);
assert.equal(decodeAppState(state).cashAdjustments[0].destination,'isa');
const order={id:'broker-one',symbol:p.symbol,date:'2025-02-01',currency:'USD',type:'buy',shares:1,price:10,accountId:'account'};
const imported=tossCandidateToTrade(order,{projectId:p.id,id:'imported'});imported.dividendFunding={amountUSD:10,sourceFingerprint:imported.source.sourceFingerprint};
const rebuild=()=>rebuildProjectFromTossSource({project:p,sourceLedger:{orders:[order]},currentTrades:[imported],currentDividends:state.dividends,capabilities:{dividends:false},syncStatus:'complete'});
assert.deepEqual(rebuild().trades[0].dividendFunding,imported.dividendFunding);
order.price=11;assert.equal(rebuild().trades[0].dividendFunding,undefined,'changed broker originals require funding reconfirmation');
const zip=createStoreZip([{name:'data/state.json',data:JSON.stringify(state)}]);const file=Object.assign(zip,{name:'plan.zip'});
const restored=await readStateFromBackupFile(file);assert.equal(restored.projects[0].dividendPlan.mode,'outside');assert.equal(restored.cashAdjustments[0].destination,'isa');
const invalid=structuredClone(state);invalid.projects[0].dividendPlan.history[0].confirmedAt='bad';assert.throws(()=>decodeAppState(invalid));
const exportState=structuredClone(state);exportState.trades.push(imported);
const exports=buildCsvExports(exportState),usesCSV=exports.find(row=>row.name==='cash-adjustments.csv').data;
assert.match(usesCSV,/dividendUse,isa/);assert.match(usesCSV,/-30/);
const buysCSV=exports.find(row=>row.name==='trades.csv').data;assert.match(buysCSV,/dividendFundingUSD,fundingStatus/);assert.match(buysCSV,/,10,confirmed,/);
assert.match(exports.find(row=>row.name==='goals.csv').data,/dividendUseMode/);assert.match(exports.find(row=>row.name==='goals.csv').data,/,outside/);
console.log('Dividend plan QA PASS: cash conservation, ROC, stale/zero prices, early/locked recovery, goal continuity, Toss funding preservation, ZIP restore');

// Synthetic regression: a broker import is provisional, not spendable cash.
{
 const s=blankState(),p=s.projects[0];
 s.trades=[tossCandidateToTrade({id:'pending',symbol:p.symbol,date:'2025-01-02',currency:'USD',type:'buy',shares:1,price:12},{projectId:p.id,id:'pending'})];
 s.dividends=[{id:'cash',projectId:p.id,date:'2025-01-03',amountUSD:20}];
 const compute=()=>createPortfolioEngine(()=>s,()=>p.id).computeProject(p);
 assert.equal(compute().spendableDividendBalance,null);
 const source=structuredClone(s.trades[0].source);
 s.trades[0].dividendFunding={amountUSD:12,sourceFingerprint:source.sourceFingerprint,cashDate:'2025-01-04'};
 assert.equal(compute().spendableDividendBalance,8);
 assert.equal(compute().cashDeficitEvents.length,0,'settlement after receipt can use that receipt');
 assert.equal(compute().cashLedger.find(r=>r.kind==='reinvest').date,'2025-01-04');
 assert.deepEqual(s.trades[0].source,source);assert.equal(s.trades[0].date,'2025-01-02');
 assert.equal(decodeAppState(s).trades[0].dividendFunding.cashDate,'2025-01-04');
 const bad=structuredClone(s);bad.trades[0].dividendFunding.cashDate='2025-01-01';assert.throws(()=>decodeAppState(bad));
 s.projects[0].initialDividendBalance=5;s.projects[0].initialDividendBalanceDate='2025-01-03';
 assert.equal(compute().openingBalanceOverlap,true);assert.equal(compute().spendableDividendBalance,null);
 s.projects[0].initialDividendBalanceTreatment='excludedSnapshot';
 assert.equal(compute().spendableDividendBalance,8,'snapshot exclusion is not an invented correction');
 assert.equal(s.projects[0].initialDividendBalance,5,'original snapshot preserved');
 const restored=await readStateFromBackupFile(Object.assign(createStoreZip([{name:'data/state.json',data:JSON.stringify(s)}]),{name:'funding.zip'}));
 assert.equal(restored.projects[0].initialDividendBalanceTreatment,'excludedSnapshot');
 assert.equal(restored.trades[0].dividendFunding.cashDate,'2025-01-04');
}
// Source-bound old reinvest/mixed allocations survive rebuilds; a default direct buy stays pending.
for(const mode of ['reinvest','mixed','direct']){
 const s=blankState(),p=s.projects[0],order={id:'legacy',symbol:p.symbol,date:'2025-01-02',currency:'USD',type:'buy',shares:2,price:10,feeUSD:1};
 const trade=tossCandidateToTrade(order,{projectId:p.id,id:'legacy'});trade.buyType=mode;trade.reinvestAmountUSD=7;
 const result=rebuildProjectFromTossSource({project:p,sourceLedger:{orders:[order]},currentTrades:[trade],syncStatus:'complete'});
 assert.equal(result.trades[0].dividendFunding?.amountUSD,mode==='reinvest'?21:mode==='mixed'?7:undefined);
 const changed=rebuildProjectFromTossSource({project:p,sourceLedger:{orders:[{...order,price:11}]},currentTrades:[trade],syncStatus:'complete'});
 assert.equal(changed.trades[0].dividendFunding,undefined);
}
console.log('Funding safety PASS: pending spending, cash dates, preserved snapshot, ZIP restore and legacy allocation rebuild');
{
 const s=blankState(),p=s.projects[0],t=tossCandidateToTrade({id:'fractional',symbol:p.symbol,date:'2025-01-02',type:'buy',shares:3,price:10.123,currency:'USD'},{projectId:p.id,id:'fractional'});
 s.trades=[t];s.dividends=[{id:'funds',projectId:p.id,date:'2025-01-01',amountUSD:40}];
 const compute=()=>createPortfolioEngine(()=>s,()=>p.id).computeProject(p),raw=compute();
 t.dividendFunding={amountUSD:30.37,cashDebitUSD:30.37,cashDate:'2025-01-03',sourceFingerprint:t.source.sourceFingerprint};
 assert.ok(Math.abs(compute().dividendAvailable-9.63)<1e-8);assert.equal(compute().directBuyCost,0);assert.equal(compute().purchaseBasis,raw.purchaseBasis);
 assert.equal(decodeAppState(s).trades[0].dividendFunding.cashDebitUSD,30.37);
 const invalid=structuredClone(s);invalid.trades[0].dividendFunding.cashDebitUSD=31;assert.throws(()=>decodeAppState(invalid));
 const stale=structuredClone(s);stale.trades[0].price=11;stale.trades[0].date='2025-01-04';stale.trades[0].source.sourceFingerprint='changed';assert.equal(decodeAppState(stale).trades[0].dividendFunding.cashDebitUSD,30.37);assert.equal(createPortfolioEngine(()=>stale,()=>p.id).computeProject(p).spendableDividendBalance,null);
}
console.log('Settled cash precision PASS: source valuation unchanged, rounded debit validated, stale metadata retained');
{
 const s=blankState(),p=s.projects[0],t=tossCandidateToTrade({id:'sources',symbol:p.symbol,date:'2025-01-02',type:'buy',shares:2,price:10,currency:'USD'},{projectId:p.id,id:'sources'});s.trades=[t];s.dividends=[{id:'div',projectId:p.id,date:'2025-01-01',amountUSD:12}];
 t.dividendFunding={amountUSD:12,cashDebitUSD:20,sourceFingerprint:t.source.sourceFingerprint};const calc=()=>createPortfolioEngine(()=>s,()=>p.id).computeProject(p);
 assert.equal(projectRecovery(calc()).basisConfirmed,false);assert.equal(calc().spendableDividendBalance,0);
 t.dividendFunding.contributionUSD=6;assert.equal(projectRecovery(calc()).basisConfirmed,true);assert.equal(projectRecovery(calc()).basis,6,'reused non-dividend funds are not new principal');assert.equal(calc().reinvestAmount,12);assert.equal(calc().purchaseBasis,20);
 const bad=structuredClone(s);bad.trades[0].dividendFunding.contributionUSD=9;assert.throws(()=>decodeAppState(bad));
}
console.log('Principal-source PASS: recycled cash excluded, missing contribution marked provisional, excess rejected');

// Intraday ordering, not import/creation order, determines whether income existed.
{
 const s=blankState(),p=s.projects[0],compute=()=>createPortfolioEngine(()=>s,()=>p.id).computeProject(p);
 s.dividends=[{id:'income',projectId:p.id,date:'2025-02-03',amountUSD:20,cashTime:'16:09'}];
 s.trades=[{id:'buy',projectId:p.id,date:'2025-02-03',type:'buy',buyType:'reinvest',shares:1,price:10,cashTime:'06:57'}];
 assert.equal(compute().dividendAvailable,10);
 assert.equal(compute().cashDeficitEvents.length,1,'a later receipt cannot fund an earlier debit');
 assert.equal(compute().spendableDividendBalance,null,'positive closing balance cannot conceal historic deficit');
 s.trades[0].cashTime='17:00';assert.equal(compute().spendableDividendBalance,10);
 const timed=compute();delete s.trades[0].cashTime;
 assert.deepEqual(compute().cashTimingUnconfirmedDates,['2025-02-03']);
 assert.equal(compute().spendableDividendBalance,null);
 assert.equal(hasNewDividendDeficit(timed,compute()),true);
 // Enough prior-day cash makes the unknown order financially irrelevant.
 s.dividends.unshift({id:'prior',projectId:p.id,date:'2025-02-02',amountUSD:15});
 assert.deepEqual(compute().cashTimingUnconfirmedDates,[]);assert.equal(compute().spendableDividendBalance,25);
 s.trades[0].cashTime='17:00';
 assert.equal(decodeAppState(s).trades[0].cashTime,'17:00');
 const bad=structuredClone(s);bad.dividends[0].cashTime='25:00';assert.throws(()=>decodeAppState(bad));
 const restored=await readStateFromBackupFile(Object.assign(createStoreZip([{name:'data/state.json',data:JSON.stringify(s)}]),{name:'timed.zip'}));
 assert.deepEqual(compute().cashLedger,createPortfolioEngine(()=>restored,()=>p.id).computeProject(p).cashLedger);
}
{
 const s=blankState(),p=s.projects[0],t=tossCandidateToTrade({id:'future-settlement',symbol:p.symbol,date:'2025-01-02',type:'buy',shares:1,price:12,currency:'USD'},{projectId:p.id,id:'future-settlement'});
 t.dividendFunding={amountUSD:12,contributionUSD:0,sourceFingerprint:t.source.sourceFingerprint,cashDate:'2099-01-03'};
 s.trades=[t];s.dividends=[{id:'income',projectId:p.id,date:'2025-01-01',amountUSD:20}];
 const c=createPortfolioEngine(()=>s,()=>p.id).computeProject(p);
 assert.equal(c.reinvestAmount,12);assert.equal(c.dividendAvailable,20,'future settlement is not a posted debit');
 assert.equal(c.reservedDividendAmount,12);assert.equal(c.spendableDividendBalance,8,'committed dividends cannot be spent twice');
 assert.equal(c.cashLedger.some(row=>row.date.startsWith('2099')),false);
}
console.log('Operational cash PASS: intraday deficit, unknown clocks, prior-day funding, ZIP timing, future settlement reservation');

// A cropped statement date can be bounded without claiming a guessed exact day.
{
 const s=blankState(),p=s.projects[0],t=tossCandidateToTrade({id:'bounded',symbol:p.symbol,date:'2025-01-02',type:'buy',shares:1,price:12,currency:'USD'},{projectId:p.id,id:'bounded'});
 t.dividendFunding={amountUSD:12,contributionUSD:0,sourceFingerprint:t.source.sourceFingerprint,cashDateWindow:{from:'2025-01-05',to:'2025-01-06'}};
 s.trades=[t];s.dividends=[{id:'income',projectId:p.id,date:'2025-01-03',amountUSD:20}];
 const compute=x=>createPortfolioEngine(()=>x,()=>p.id).computeProject(p);
 assert.equal(compute(s).spendableDividendBalance,8);assert.equal(compute(s).cashLedger.at(-1).date,'2025-01-05');
 assert.equal(s.trades[0].date,'2025-01-02');assert.equal(s.trades[0].dividendFunding.cashDate,undefined);
 const restored=decodeAppState(s);assert.deepEqual(restored.trades[0].dividendFunding.cashDateWindow,t.dividendFunding.cashDateWindow);assert.equal(compute(restored).spendableDividendBalance,8);
 const bad=structuredClone(s);bad.trades[0].dividendFunding.cashDate='2025-01-05';assert.throws(()=>decodeAppState(bad),'a window cannot silently become an exact date');
 const badRange=structuredClone(s);badRange.trades[0].dividendFunding.cashDateWindow.to='2025-01-04';assert.throws(()=>decodeAppState(badRange));
}
console.log('Statement date-window PASS: conservative debit ordering, original dates retained, no invented exact date, restore validation');
{
 const {todayISO}=await import('../modules/utils.js');
 const s=blankState(),p=s.projects[0],t=tossCandidateToTrade({id:'window-in-progress',symbol:p.symbol,date:'2025-01-02',type:'buy',shares:1,price:12,currency:'USD'},{projectId:p.id,id:'window-in-progress'});
 t.dividendFunding={amountUSD:12,contributionUSD:0,sourceFingerprint:t.source.sourceFingerprint,cashDateWindow:{from:todayISO(),to:'2099-01-01'}};
 s.trades=[t];s.dividends=[{id:'income',projectId:p.id,date:'2025-01-01',amountUSD:20}];
 const c=createPortfolioEngine(()=>s,()=>p.id).computeProject(p);
 assert.equal(c.dividendAvailable,20,'a debit inside a date window is not falsely marked settled');
 assert.equal(c.reservedDividendAmount,12);assert.equal(c.spendableDividendBalance,8,'an uncertain settlement cannot free reserved funds');
}
