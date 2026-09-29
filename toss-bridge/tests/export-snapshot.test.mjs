import assert from 'node:assert/strict';
import test from 'node:test';
import {createTossSnapshot,validateExportEnvironment} from '../export-snapshot.mjs';

const env={TOSS_CLIENT_ID:'client',TOSS_CLIENT_SECRET:'secret',TOSS_DEFAULT_FROM:'2026-01-01'};
function response(result,status=200){return {ok:status>=200&&status<300,status,json:async()=>result};}

test('on-demand export validates credentials without persisting them',()=>{
  assert.doesNotThrow(()=>validateExportEnvironment(env));
  assert.throws(()=>validateExportEnvironment({...env,TOSS_CLIENT_SECRET:''}));
});

test('on-demand export emits the bounded app snapshot envelope',async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/oauth2/token'))return response({access_token:'access-only-in-memory',expires_in:3600});
    if(String(url).endsWith('/api/v1/accounts'))return response({result:[{accountSeq:7,accountNo:'12345678',accountType:'BROKERAGE'}]});
    if(String(url).endsWith('/api/v1/holdings'))return response({result:{items:[{symbol:'MSTY',name:'YieldMax MSTR Option Income Strategy ETF',marketCountry:'US',currency:'USD',quantity:'2',averagePurchasePrice:'10',lastPrice:'11',marketValue:{amount:'22'}}]}});
    if(String(url).includes('/api/v1/orders?'))return response({result:{orders:[{orderId:'order-1',symbol:'MSTY',side:'BUY',status:'FILLED',currency:'USD',orderedAt:'2026-01-02T10:00:00+09:00',execution:{filledQuantity:'2',averageFilledPrice:'10',filledAmount:'20',commission:'0.1',tax:'0',filledAt:'2026-01-02T10:00:01+09:00',settlementDate:'2026-01-05'}}],hasNext:false}});
    if(String(url).includes('/api/v1/prices?'))return response({result:[{symbol:'MSTY',currency:'USD',lastPrice:'11',timestamp:'2026-09-29T00:00:00Z'}]});
    throw new Error(`Unexpected URL: ${url}`);
  };
  const payload=await createTossSnapshot({env,fetchImpl,now:new Date('2026-09-29T00:00:00Z'),waitImpl:async()=>{}});
  assert.equal(payload.format,'dividend-os-toss-snapshot');
  assert.equal(payload.version,1);
  assert.equal(payload.snapshot.accountLabel,'토스증권 •5678');
  assert.equal(payload.snapshot.holdings.length,1);
  assert.equal(payload.snapshot.orders.length,1);
  assert.equal(payload.snapshot.prices.length,1);
  assert.equal(payload.snapshot.capabilities.dividends,false);
  assert.equal(JSON.stringify(payload).includes('access-only-in-memory'),false);
  assert.equal(JSON.stringify(payload).includes('12345678'),false,'full account number must not enter the export');
  assert.ok(calls.every(call=>!String(call.url).includes('secret')));
});
