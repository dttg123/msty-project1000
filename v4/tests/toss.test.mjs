import assert from 'node:assert/strict';
import {buildTossSync,normalizeTossOrder,mergeTossCandidates,mergeTossDividendCandidates,mergeTossSourceLedger,normalizeTossDividend,tossCandidateToDividend} from '../modules/toss.js';
const row={id:'order-1',symbol:'MSTY',date:'2026-01-01',side:'BUY',shares:2,price:10,currency:'USD'};
assert.equal(normalizeTossOrder(row).shares,2);
for(const bad of [{...row,shares:0},{...row,price:Infinity},{...row,date:'2026-02-30'},{...row,symbol:'<img>'}])assert.equal(normalizeTossOrder(bad),null);
const result=buildTossSync({orders:[row,row,{...row,id:'order-2',currency:'KRW'}],holdings:[{symbol:'MSTY',shares:3,currency:'USD'}]},{appPositions:[{symbol:'MSTY',shares:2}]});
assert.equal(result.candidates.length,1);
assert.equal(result.unsupportedCurrencyCount,1);
assert.equal(result.comparisons[0].difference,1);
assert.equal(mergeTossCandidates(result.candidates,result.candidates).length,1);
assert.equal(buildTossSync({orders:[row]},{existingTrades:[{symbol:'MSTY',date:'2026-01-01',type:'buy',shares:2,price:10}]}).candidates.length,0);
const ledger1=mergeTossSourceLedger({}, {orders:[row],dividends:[{id:'div-1',symbol:'MSTY',date:'2026-01-08',netAmount:12.34,currency:'USD'}]},'2026-01-09T00:00:00Z');
assert.equal(ledger1.orders.length,1);
assert.equal(ledger1.dividends.length,1);
assert.equal(normalizeTossDividend({id:'div-1',symbol:'MSTY',date:'2026-01-08',netAmount:12.34,currency:'USD'}).amountUSD,12.34);
const ledger2=mergeTossSourceLedger(ledger1,{orders:[],dividends:[]},'2026-01-10T00:00:00Z');
assert.equal(ledger2.orders.length,1,'a later empty/disconnected response must not erase source history');
assert.equal(ledger2.dividends.length,1,'stored dividends must survive later gaps');
const dividendSnapshot={dividends:[{id:'div-1',symbol:'MSTY',date:'2026-01-08',netAmount:12.34,currency:'USD'}]};
const dividendSync=buildTossSync(dividendSnapshot,{existingDividends:[]});
assert.equal(dividendSync.dividendCandidates.length,1);
assert.equal(buildTossSync(dividendSnapshot,{existingDividends:[{symbol:'MSTY',date:'2026-01-08',amountUSD:12.34}]}).dividendCandidates.length,0,'matching manual dividend must not be duplicated');
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
assert.equal(sameDay.dividendCandidates.length,1,'one manual record must consume only one same-day Toss payment');
console.log('Toss offline adapter: PASS (no account requests)');
