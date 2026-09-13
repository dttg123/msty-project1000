import assert from 'node:assert/strict';
import { buildTossSync, mergeTossCandidates, normalizeTossOrder, tossCandidateToTrade } from '../modules/toss.js';

const snapshot={
  accountLabel:'토스증권 •1234',fetchedAt:'2026-09-13T10:00:00Z',
  holdings:[
    {symbol:'msty',name:'MSTY',currency:'USD',quantity:'12.5',averagePurchasePrice:'18',lastPrice:'14'},
    {symbol:'005930',name:'삼성전자',currency:'KRW',quantity:'3',averagePurchasePrice:'70000',lastPrice:'72000'}
  ],
  orders:[
    {orderId:'old',symbol:'MSTY',side:'BUY',currency:'USD',orderedAt:'2026-09-01T10:00:00+09:00',execution:{filledQuantity:'2',averageFilledPrice:'15',filledAt:'2026-09-01T10:01:00+09:00'}},
    {orderId:'new',symbol:'MSTY',side:'SELL',currency:'USD',orderedAt:'2026-09-02T10:00:00+09:00',execution:{filledQuantity:'0.5',averageFilledPrice:'16',filledAt:'2026-09-02T10:01:00+09:00'}},
    {orderId:'new',symbol:'MSTY',side:'SELL',currency:'USD',orderedAt:'2026-09-02T10:00:00+09:00',execution:{filledQuantity:'0.5',averageFilledPrice:'16',filledAt:'2026-09-02T10:01:00+09:00'}},
    {orderId:'kr',symbol:'005930',side:'BUY',currency:'KRW',orderedAt:'2026-09-03T10:00:00+09:00',execution:{filledQuantity:'1',averageFilledPrice:'71000',filledAt:'2026-09-03T10:01:00+09:00'}},
    {orderId:'bad',symbol:'MSTY',side:'BUY',currency:'USD',orderedAt:'2026-09-04T10:00:00+09:00',execution:{filledQuantity:'0',averageFilledPrice:null,filledAt:null}}
  ]
};
const existing=[{source:{provider:'toss',externalId:'old'}}];
const result=buildTossSync(snapshot,{existingTrades:existing,appPositions:[{symbol:'MSTY',shares:10}]});
assert.equal(result.candidates.length,1);
assert.equal(result.candidates[0].externalId,'new');
assert.equal(result.candidates[0].type,'sell');
assert.equal(result.candidates[0].shares,.5);
const imported=tossCandidateToTrade(result.candidates[0],{projectId:'p-msty',id:'t-import',createdAt:'2026-09-13T10:00:00Z'});
assert.deepEqual({id:imported.id,projectId:imported.projectId,type:imported.type,shares:imported.shares,price:imported.price,source:imported.source},{id:'t-import',projectId:'p-msty',type:'sell',shares:.5,price:16,source:{provider:'toss',externalId:'new'}});
assert.equal(tossCandidateToTrade({...result.candidates[0],currency:'KRW'},{projectId:'p',id:'t'}),null);
assert.equal(result.unsupportedCurrencyCount,1);
assert.equal(result.comparisons[0].difference,2.5);
assert.equal(result.comparisons[1].supported,false);
assert.equal(normalizeTossOrder({}),null);
assert.deepEqual(mergeTossCandidates(result.candidates,result.candidates).map(row=>row.externalId),['new']);

const longOrders=[];
for(let month=0;month<120;month++){
  const year=2017+Math.floor(month/12),mm=String(month%12+1).padStart(2,'0');
  for(let index=0;index<10;index++)longOrders.push({orderId:`${year}-${mm}-${index}`,symbol:index%2?'MSTY':'CONY',side:index%3?'BUY':'SELL',currency:'USD',orderedAt:`${year}-${mm}-05T10:00:00+09:00`,execution:{filledQuantity:String(index+1),averageFilledPrice:String(10+index),filledAt:`${year}-${mm}-05T10:01:00+09:00`}});
}
const longResult=buildTossSync({orders:longOrders,holdings:[]});
assert.equal(longResult.candidates.length,1200);
assert.equal(new Set(longResult.candidates.map(row=>row.externalId)).size,1200);
assert.ok(longResult.candidates.every(row=>Number.isFinite(row.shares)&&Number.isFinite(row.price)));
assert.equal(buildTossSync({orders:[],historyTruncated:true}).historyTruncated,true);
console.log('DividendOS v0.9 Toss QA: PASS');
