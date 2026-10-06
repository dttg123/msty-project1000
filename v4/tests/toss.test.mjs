import assert from 'node:assert/strict';
import {tossExceptionKey,dismissTossExceptions,filterDismissedTossExceptions,accountScopeChanged,automaticTossDividendAdoptions,automaticTossImportPlan,buildTossSync,disconnectedTossState,normalizeTossOrder,mergeTossCandidates,mergeTossCorrectionCandidates,mergeTossDividendCandidates,mergeTossSourceLedger,nextTossSyncFrom,normalizeTossDividend,rebuildProjectFromTossSource,refreshTossCandidateConflicts,restoreTossExecutionTimes,tossCandidateToDividend,tossCandidateToTrade,tossSyncProgress} from '../modules/toss.js';
const row={id:'order-1',symbol:'MSTY',date:'2026-01-01',side:'BUY',shares:2,price:10,currency:'USD'};
assert.equal(normalizeTossOrder(row).shares,2);
for(const bad of [{...row,shares:0},{...row,price:Infinity},{...row,date:'2026-02-30'},{...row,symbol:'<img>'}])assert.equal(normalizeTossOrder(bad),null);
const result=buildTossSync({orders:[row,row,{...row,id:'order-2',currency:'KRW'}],holdings:[{symbol:'MSTY',shares:3,currency:'USD'}]},{appPositions:[{symbol:'MSTY',shares:2}]});
assert.equal(result.candidates.length,1);
assert.equal(result.unsupportedCurrencyCount,1);
assert.equal(result.comparisons[0].difference,1);
assert.equal(automaticTossImportPlan({...result,syncStatus:'complete'}).eligible,true);
assert.equal(automaticTossImportPlan({...result,syncStatus:'partial'}).reason,'partial');
assert.equal(mergeTossCandidates(result.candidates,result.candidates).length,1);
const manualConflict=buildTossSync({orders:[row]},{existingTrades:[{id:'manual-1',symbol:'MSTY',date:'2026-01-01',type:'buy',shares:2,price:10}]});
assert.equal(manualConflict.candidates.length,1,'similar manual rows require user review instead of silent suppression');
assert.equal(manualConflict.candidates[0].possibleManualDuplicate,true);
assert.equal(automaticTossImportPlan(manualConflict).reason,'duplicate');
assert.deepEqual(manualConflict.candidates[0].manualMatchIds,['manual-1']);
const incrementalPlan=automaticTossImportPlan({...manualConflict,candidates:[...manualConflict.candidates,{...normalizeTossOrder({...row,id:'new-four',date:'2026-02-01',shares:4}),possibleManualDuplicate:false}]});
assert.equal(incrementalPlan.eligible,true,'old manual duplicates must not block a new verified buy');
assert.deepEqual(incrementalPlan.candidates.map(item=>item.externalId),['new-four']);
assert.equal(manualConflict.candidates.length,1,'planning must preserve the pending manual match');

const restoredStaleConflict={...manualConflict,candidates:manualConflict.candidates.map(item=>({...item}))};
refreshTossCandidateConflicts(restoredStaleConflict,[],[]);
assert.equal(automaticTossImportPlan(restoredStaleConflict).eligible,true,'restored candidates must not keep deleted manual-duplicate flags');
const restoredRealConflict={...manualConflict,candidates:manualConflict.candidates.map(item=>({...item}))};
refreshTossCandidateConflicts(restoredRealConflict,[{id:'manual-1'}],[]);
assert.equal(automaticTossImportPlan(restoredRealConflict).reason,'duplicate','a live manual match must remain review-only');
const ledger1=mergeTossSourceLedger({}, {orders:[row],dividends:[{id:'div-1',symbol:'MSTY',date:'2026-01-08',netAmount:12.34,currency:'USD'}]},'2026-01-09T00:00:00Z');
assert.equal(ledger1.orders.length,1);
assert.equal(ledger1.dividends.length,1);
assert.equal(normalizeTossDividend({id:'div-1',symbol:'MSTY',date:'2026-01-08',netAmount:12.34,currency:'USD'}).amountUSD,12.34);
const ledger2=mergeTossSourceLedger(ledger1,{orders:[],dividends:[]},'2026-01-10T00:00:00Z');
assert.equal(ledger2.orders.length,1,'a later empty/disconnected response must not erase source history');
assert.equal(ledger2.dividends.length,1,'stored dividends must survive later gaps');
const ledgerSame=mergeTossSourceLedger(ledger1,{orders:[row],dividends:[]},'2026-01-10T12:00:00Z');
assert.equal(ledgerSame.orders[0].revisionCount,1,'replayed identical responses must not create revisions');
const ledgerChanged=mergeTossSourceLedger(ledger1,{orders:[{...row,price:11}],dividends:[]},'2026-01-11T00:00:00Z');
assert.equal(ledgerChanged.orders[0].revisionCount,2);
assert.equal(ledgerChanged.orders[0].lastChangedAt,'2026-01-11T00:00:00Z');
assert.equal(ledgerChanged.orders[0].revisions.length,1);
assert.equal(ledgerChanged.orders[0].revisions[0].price,10);
const dividendSnapshot={dividends:[{id:'div-1',symbol:'MSTY',date:'2026-01-08',netAmount:12.34,currency:'USD'}]};
const dividendSync=buildTossSync(dividendSnapshot,{existingDividends:[]});
assert.equal(dividendSync.dividendCandidates.length,1);
const manualDividendConflict=buildTossSync(dividendSnapshot,{existingDividends:[{id:'manual-div',symbol:'MSTY',date:'2026-01-08',amountUSD:12.34}]});
assert.equal(manualDividendConflict.dividendCandidates.length,1,'matching manual dividend must remain an unchecked review candidate');
assert.equal(manualDividendConflict.dividendCandidates[0].possibleManualDuplicate,true);
assert.deepEqual(automaticTossDividendAdoptions(manualDividendConflict.dividendCandidates).map(row=>row.manualId),['manual-div']);
assert.equal(automaticTossDividendAdoptions([{possibleManualDuplicate:true,manualMatchIds:['a','b']}]).length,0,'ambiguous manual dividends must still require review');
assert.equal(mergeTossDividendCandidates(dividendSync.dividendCandidates,dividendSync.dividendCandidates).length,1);
const approved=tossCandidateToDividend(dividendSync.dividendCandidates[0],{projectId:'p-msty',id:'d-approved',sharesAtPayment:100});
assert.equal(approved.source.externalId,'div-1');
assert.equal(approved.sharesAtPayment,100);
assert.equal(buildTossSync(dividendSnapshot,{existingDividends:[approved]}).dividendCandidates.length,0,'an approved Toss dividend must not return on the next sync');
const sameDaySnapshot={dividends:[
  {id:'same-1',symbol:'MSTY',date:'2026-01-15',netAmount:10,currency:'USD'},
  {id:'same-2',symbol:'MSTY',date:'2026-01-15',netAmount:10,currency:'USD'}
]};
const sameDay=buildTossSync(sameDaySnapshot,{existingDividends:[{symbol:'MSTY',date:'2026-01-15',amountUSD:10}]});
assert.equal(sameDay.matchedExistingDividendCount,1);
assert.equal(sameDay.dividendCandidates.length,2,'no Toss payment may be silently removed by a manual match');
assert.equal(sameDay.dividendCandidates.filter(row=>row.possibleManualDuplicate).length,1,'one manual record flags only one same-day Toss payment');
const multiAccount=buildTossSync({
  orders:[{...row,id:'shared-order',accountId:'acct-1',securityId:'US-MSTY',market:'NASDAQ'},{...row,id:'shared-order',accountId:'acct-2',securityId:'US-MSTY',market:'NASDAQ'}],
  holdings:[{symbol:'MSTY',shares:2,currency:'USD',accountId:'acct-1',securityId:'US-MSTY',market:'NASDAQ'},{symbol:'MSTY',shares:3,currency:'USD',accountId:'acct-2',securityId:'US-MSTY',market:'NASDAQ'}]
},{appPositions:[{symbol:'MSTY',assetKey:'toss:NASDAQ:US-MSTY',shares:5}]});
assert.equal(multiAccount.candidates.length,2,'same order id from two accounts must remain distinct');
assert.notEqual(multiAccount.candidates[0].externalId,multiAccount.candidates[1].externalId);
assert.equal(mergeTossCandidates(multiAccount.candidates,multiAccount.candidates).length,2,'normalizing linked candidates again must not duplicate the account prefix');
assert.equal(multiAccount.holdings.length,1,'same security across accounts is aggregated for portfolio comparison');
assert.equal(multiAccount.holdings[0].shares,5);
assert.deepEqual(multiAccount.holdings[0].accounts,['acct-1','acct-2']);
assert.equal(multiAccount.comparisons[0].difference,0);
assert.equal(buildTossSync({orders:[{...row,id:'legacy-id',accountId:'acct-1'}]},{existingTrades:[{source:{provider:'toss',externalId:'legacy-id'}}]}).candidates.length,0,'pre-account Toss ids remain duplicate-safe');
const linked=tossCandidateToDividend({id:'div-account',accountId:'acct-1',securityId:'US-MSTY',market:'NASDAQ',symbol:'MSTY',date:'2026-01-22',netAmount:9,currency:'USD'},{projectId:'p-msty',id:'d-account'});
assert.equal(linked.source.accountId,'acct-1');
assert.equal(linked.source.assetKey,'toss:NASDAQ:US-MSTY');
const officialOrder={orderId:'official-1',accountId:'acct-1',symbol:'MSTY',side:'BUY',status:'FILLED',currency:'USD',orderedAt:'2026-02-01T10:00:00+09:00',execution:{filledQuantity:'2.5',averageFilledPrice:'11.25',filledAmount:'28.125',commission:'0.12',tax:'0.03',filledAt:'2026-02-01T10:00:02+09:00',settlementDate:'2026-02-03'}};
const normalizedOfficial=normalizeTossOrder(officialOrder);
assert.equal(normalizedOfficial.shares,2.5);
assert.equal(normalizedOfficial.feeUSD,.12);
assert.equal(normalizedOfficial.taxUSD,.03);
const importedOfficial=tossCandidateToTrade(normalizedOfficial,{projectId:'p-msty',id:'t-official'});
assert.equal(importedOfficial.source.status,'FILLED');
assert.ok(importedOfficial.source.sourceFingerprint);
const correction=buildTossSync({orders:[{...officialOrder,execution:{...officialOrder.execution,averageFilledPrice:'11.5'}}]},{existingTrades:[importedOfficial]});
assert.equal(correction.candidates.length,0);
assert.equal(correction.correctionCandidates.length,1,'changed upstream execution must be reported without silently rewriting the ledger');
const voided=buildTossSync({orders:[{...officialOrder,status:'CANCELED',execution:{filledQuantity:'0',averageFilledPrice:null,filledAmount:null,commission:null,tax:null,filledAt:null,settlementDate:null}}]},{existingTrades:[importedOfficial]});
assert.equal(voided.correctionCandidates.length,1,'a later cancellation with zero filled quantity must still alert the user');
assert.equal(voided.correctionCandidates[0].changeType,'voided');
assert.equal(mergeTossCorrectionCandidates(voided.correctionCandidates,voided.correctionCandidates).length,1);
assert.equal(automaticTossImportPlan({...voided,syncStatus:'complete'}).reason,'correction');
const noSourceId=normalizeTossOrder({symbol:'MSTY',accountId:'acct-1',date:'2026-02-02',side:'BUY',shares:1,price:12,currency:'USD'});
assert.equal(noSourceId.sourceIdKind,'fingerprint');
assert.equal(normalizeTossOrder(noSourceId).externalId,noSourceId.externalId,'fallback fingerprints must be stable across normalization');
assert.equal(nextTossSyncFrom({syncCursor:{ordersThrough:'2026-02-20'}},'2020-01-01'),'2026-02-06');
assert.equal(accountScopeChanged('abc','def'),true);
const partialProgress=tossSyncProgress({syncCursor:{ordersThrough:'2026-01-01'},lastSuccessfulAt:'old'},{syncStatus:'partial',failedAccountCount:1,fetchedAt:'new',syncCursor:{ordersThrough:'2026-02-01'}});
assert.equal(partialProgress.syncCursor.ordersThrough,'2026-01-01','failed accounts must not advance the incremental cursor');
assert.equal(partialProgress.lastSuccessfulAt,'old');
const priceOnlyPartial=tossSyncProgress({syncCursor:{ordersThrough:'2026-01-01'}},{syncStatus:'partial',failedAccountCount:0,fetchedAt:'new',syncCursor:{ordersThrough:'2026-02-01'}});
assert.equal(priceOnlyPartial.syncCursor.ordersThrough,'2026-02-01','a price-only failure must not force full order history next time');
const disconnected=disconnectedTossState({accountScopeId:'scope',sourceLedger:{orders:[{externalId:'x'}],dividends:[]},candidates:[row],holdings:[{}]});
assert.equal(disconnected.accountScopeId,'scope','disconnect keeps the account guard');
assert.equal(disconnected.sourceLedger.orders.length,1,'disconnect preserves source history');
assert.equal(disconnected.candidates.length,0);
const authoritative=rebuildProjectFromTossSource({project:{id:'p-msty',symbol:'MSTY'},sourceLedger:{orders:[row,{...row,id:'order-2',date:'2026-01-02',shares:3}],dividends:[]},currentTrades:[{id:'manual-old',projectId:'p-msty',symbol:'MSTY'},{id:'other',projectId:'p-other',symbol:'SCHD'}],currentDividends:[{id:'manual-div',projectId:'p-msty',symbol:'MSTY'}],capabilities:{dividends:false},syncStatus:'complete',makeId:(prefix)=>`${prefix}-rebuilt`});
assert.equal(authoritative.ok,true);
assert.equal(authoritative.replacedTrades,1);
assert.equal(authoritative.importedTrades,2);
assert.equal(authoritative.trades.some(item=>item.id==='manual-old'),false,'old MSTY trades are replaced');
assert.equal(authoritative.trades.some(item=>item.id==='other'),true,'other projects are preserved');
assert.equal(authoritative.preservedDividends,1,'manual dividends survive when Toss does not expose dividends');
assert.equal(rebuildProjectFromTossSource({...authoritative,project:{id:'p-msty',symbol:'MSTY'},sourceLedger:{orders:[row]},currentTrades:[],currentDividends:[],syncStatus:'partial'}).reason,'partial');
console.log('Toss offline adapter: PASS (no account requests)');

const exceptions={accountScopeId:'scope-a',sourceLedger:{orders:[row]},candidates:[{externalId:'old',sourceFingerprint:'original'}],dividendCandidates:[{externalId:'div',sourceFingerprint:'v1'}]};
const dismissed=dismissTossExceptions(exceptions,[tossExceptionKey('candidates',exceptions.candidates[0],'scope-a')]);
assert.equal(dismissed.candidates.length,0);
assert.deepEqual(dismissed.dividendCandidates,exceptions.dividendCandidates);
assert.deepEqual(dismissed.sourceLedger,exceptions.sourceLedger);
assert.equal(filterDismissedTossExceptions(exceptions,dismissed.dismissedExceptionKeys).candidates.length,0);
assert.equal(filterDismissedTossExceptions({...exceptions,accountScopeId:'scope-b'},dismissed.dismissedExceptionKeys).candidates.length,1);
assert.equal(filterDismissedTossExceptions({...exceptions,candidates:[{...exceptions.candidates[0],sourceFingerprint:'changed'}]},dismissed.dismissedExceptionKeys).candidates.length,1);

// Untrusted snapshots must reject malformed rows without hiding their ignored counts.
for(const value of [null,undefined,1,'bad',[],true]){
  assert.equal(normalizeTossOrder(value),null);
  assert.equal(normalizeTossDividend(value),null);
}
const malformedSync=buildTossSync({orders:[null,7,'bad'],dividends:[null,false],holdings:[null],prices:[42],capabilities:{orders:true,prices:'yes'},syncCursor:7});
assert.equal(malformedSync.ignoredCount,5);
assert.deepEqual(malformedSync.candidates,[]);
assert.deepEqual(malformedSync.holdings,[]);
assert.deepEqual(malformedSync.capabilities,{orders:true});
assert.deepEqual(malformedSync.syncCursor,{});
const numericStringOrder=normalizeTossOrder({...row,shares:'2',price:'12.5',feeUSD:'0',taxUSD:'0'});
assert.equal(numericStringOrder.shares,2);
assert.equal(numericStringOrder.price,12.5);
assert.equal(numericStringOrder.feeUSD,0);

// Broker identifiers and import time must not reorder a complete execution day.
const {blankState}=await import('../modules/state.js');
const {createPortfolioEngine}=await import('../modules/portfolio.js');
const executionState=blankState(),executionProject=executionState.projects[0];
const executionOrders=[
 {id:'a-sell',symbol:'MSTY',currency:'USD',date:'2026-01-01',type:'sell',shares:10,price:12,filledAt:'2026-01-01T11:00:00+09:00'},
 {id:'z-buy',symbol:'MSTY',currency:'USD',date:'2026-01-01',type:'buy',shares:10,price:10,filledAt:'2026-01-01T10:00:00+09:00'}
];
executionState.trades=executionOrders.map(order=>tossCandidateToTrade(order,{projectId:executionProject.id,id:order.id,createdAt:'2026-10-05T00:00:00Z'}));
const engine=createPortfolioEngine(()=>executionState,()=>executionProject.id);
assert.equal(executionState.trades[0].source.filledAt,executionOrders[0].filledAt);
assert.equal(engine.computeProject(executionProject).oversells.length,0);
assert.equal(engine.computeProject(executionProject).shares,0);assert.equal(engine.computeProject(executionProject).realized,20);
executionState.trades[0].source.filledAt='2026-01-01T09:00:00+09:00';
assert.equal(engine.computeProject(executionProject).oversells.length,1,'real oversell remains blocked');
delete executionState.trades[0].source.filledAt;
assert.equal(engine.computeProject(executionProject).oversells.length,1,'incomplete historical times retain original order');

// Pre-0.12.27 ledgers retain originals but can lack execution metadata.
const legacyTrades=executionOrders.map(order=>{
  const trade=tossCandidateToTrade(order,{projectId:executionProject.id,id:order.id,createdAt:'2026-10-05T00:00:00Z'});
  delete trade.source.filledAt;return trade;
});
const legacyOriginal=structuredClone(legacyTrades);
executionState.trades=legacyTrades;
assert.equal(engine.computeProject(executionProject).oversells.length,1);
const recovered=restoreTossExecutionTimes(legacyTrades,executionOrders);
assert.deepEqual(legacyTrades,legacyOriginal,'recovery does not mutate original records');
executionState.trades=recovered;
assert.equal(engine.computeProject(executionProject).oversells.length,0);
assert.equal(engine.computeProject(executionProject).realized,20);
assert.deepEqual(recovered.map(({source,...financial})=>financial),legacyTrades.map(({source,...financial})=>financial),'financial records remain unchanged');
assert.deepEqual(restoreTossExecutionTimes(recovered,executionOrders),recovered);
for(const changes of [{shares:11},{price:13},{feeUSD:1},{taxUSD:1},{status:'CANCELED'},{accountId:'other-account'},{symbol:'SCHD'},{filledAt:'2026-01-02T11:00:00+09:00'},{filledAt:'2026-01-01T11:00:00'},{filledAt:'invalid'}]){
  assert.strictEqual(restoreTossExecutionTimes([legacyTrades[0]],[{...executionOrders[0],...changes}])[0],legacyTrades[0],`unsafe original rejected: ${JSON.stringify(changes)}`);
}
assert.strictEqual(restoreTossExecutionTimes([legacyTrades[0]],[executionOrders[0],executionOrders[0]])[0],legacyTrades[0],'ambiguous originals rejected');
assert.strictEqual(restoreTossExecutionTimes([legacyTrades[0],legacyTrades[0]],executionOrders)[0],legacyTrades[0],'duplicate ledger identity rejected');
const manual={...legacyTrades[0],source:{provider:'manual'}};
assert.strictEqual(restoreTossExecutionTimes([manual],executionOrders)[0],manual);
const unsignedLegacy={...legacyTrades[0],source:{...legacyTrades[0].source,sourceFingerprint:undefined}};
assert.strictEqual(restoreTossExecutionTimes([unsignedLegacy],executionOrders)[0],unsignedLegacy);
const genuineOversell=executionOrders.map(order=>({...order,filledAt:order.type==='sell'?'2026-01-01T09:00:00+09:00':order.filledAt}));
executionState.trades=restoreTossExecutionTimes(legacyTrades,genuineOversell);
assert.equal(engine.computeProject(executionProject).oversells.length,1,'genuine oversells remain blocked');
console.log('Legacy Toss execution metadata recovery safety checks passed');
