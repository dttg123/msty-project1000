import assert from 'node:assert/strict';
import test from 'node:test';
import {parseAccounts,parseHoldings,parseOrders,parsePrices,summarizeAccountReads} from '../toss-contract.mjs';

const account={accountSeq:1,accountLabel:'토스증권 •1234'};

test('official account and holding shapes are minimized',()=>{
  assert.deepEqual(parseAccounts([{accountNo:'12345678901',accountSeq:1,accountType:'BROKERAGE'}]),[{accountNo:'12345678901',accountSeq:1,accountType:'BROKERAGE'}]);
  const rows=parseHoldings({items:[{symbol:'MSTY',name:'YieldMax',marketCountry:'US',currency:'USD',quantity:'10',averagePurchasePrice:'12.3',lastPrice:'11.8',marketValue:{amount:'118'}}]},account);
  assert.equal(rows[0].accountId,'1');
  assert.equal(rows[0].quantity,'10');
  assert.equal(rows[0].marketValue.amount,'118');
  assert.throws(()=>parseHoldings({items:'invalid'},account));
});

test('official closed order fields keep costs and lifecycle status',()=>{
  const rows=parseOrders({orders:[{orderId:'opaque-1',symbol:'MSTY',side:'BUY',status:'FILLED',currency:'USD',orderedAt:'2026-03-28T09:30:00+09:00',execution:{filledQuantity:'10',averageFilledPrice:'11.5',filledAmount:'115',commission:'0.2',tax:'0',filledAt:'2026-03-28T09:31:15+09:00',settlementDate:'2026-03-30'}}]},account);
  assert.equal(rows[0].status,'FILLED');
  assert.equal(rows[0].execution.commission,'0.2');
  assert.equal(rows[0].accountLabel,'토스증권 •1234');
  assert.equal(parseOrders({orders:[{orderId:'bad',symbol:'<img>',side:'BUY',currency:'USD',orderedAt:'2026-03-28T09:30:00+09:00'}]},account).length,0);
});

test('price responses are bounded and validated',()=>{
  assert.equal(parsePrices([{symbol:'MSTY',currency:'USD',lastPrice:'12.5',timestamp:'2026-03-28T09:31:15+09:00'}])[0].lastPrice,'12.5');
  assert.equal(parsePrices([{symbol:'MSTY',currency:'USD',lastPrice:'NaN',timestamp:'2026-03-28T09:31:15+09:00'}]).length,0);
});

test('partial account reads are never reported as complete',()=>{
  const result=summarizeAccountReads([{status:'fulfilled',value:{orders:[]}},{status:'rejected',reason:new Error('hidden')}],{status:'fulfilled',value:[]});
  assert.equal(result.successes.length,1);
  assert.equal(result.failedAccountCount,1);
  assert.equal(result.syncStatus,'partial');
  assert.equal(summarizeAccountReads([{status:'fulfilled',value:{}}],{status:'rejected',reason:new Error('price')}).syncStatus,'partial');
});
