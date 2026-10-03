import assert from 'node:assert/strict';
import {clearNativeTossCredentials,fetchNativeTossSnapshot,isNativeTossAvailable,markNativeTossPublicIp,nativePublicIp,nativeTossCredentialStatus,saveNativeTossCredentials} from '../toss-native.js';

let configured=false,saved=null,cleared=false,lastPublicIp='';
const requests=[];
globalThis.window={Capacitor:{Plugins:{TossReadOnly:{
  async credentialStatus(){return {configured,lastPublicIp};},
  async saveCredentials(value){saved=value;configured=true;},
  async clearCredentials(){cleared=true;configured=false;lastPublicIp='';},
  async publicIp(){return {ip:'118.235.25.74'};},
  async markPublicIp({ip}){lastPublicIp=ip;},
  async request({path,accountSeq}){
    requests.push({path,accountSeq});
    if(path==='/api/v1/accounts')return {data:{result:[{accountSeq:7,accountNo:'12345678',accountType:'BROKERAGE'}]}};
    if(path==='/api/v1/holdings')return {data:{result:{items:[{symbol:'MSTY',name:'YieldMax MSTR Option Income Strategy ETF',marketCountry:'US',currency:'USD',quantity:'2',averagePurchasePrice:'10',lastPrice:'11',marketValue:{amount:'22'}}]}}};
    if(path.startsWith('/api/v1/orders?'))return {data:{result:{orders:[{orderId:'order-1',symbol:'MSTY',side:'BUY',status:'FILLED',currency:'USD',orderedAt:'2026-01-02T10:00:00+09:00',execution:{filledQuantity:'2',averageFilledPrice:'10',filledAmount:'20',commission:'0.1',tax:'0',filledAt:'2026-01-02T10:00:01+09:00',settlementDate:'2026-01-05'}}],hasNext:false}}};
    if(path.startsWith('/api/v1/prices?'))return {data:{result:[{symbol:'MSTY',currency:'USD',lastPrice:'11',timestamp:'2026-09-29T00:00:00Z'}]}};
    throw new Error('unexpected request');
  }
}}}};

assert.equal(isNativeTossAvailable(),true);
assert.deepEqual(await nativeTossCredentialStatus(),{available:true,configured:false,lastPublicIp:''});
await saveNativeTossCredentials(' client-id ',' secret-value ');
assert.deepEqual(saved,{clientId:'client-id',clientSecret:'secret-value'});
assert.equal(await nativePublicIp(),'118.235.25.74');
await markNativeTossPublicIp('118.235.25.74');
assert.equal((await nativeTossCredentialStatus()).lastPublicIp,'118.235.25.74');

const snapshot=await fetchNativeTossSnapshot({from:'2026-01-01',symbols:['MSTY','','bad symbol',null]});
assert.equal(snapshot.syncStatus,'complete');
assert.equal(snapshot.accountResults.length,1);
assert.equal(snapshot.holdings[0].symbol,'MSTY');
assert.equal(snapshot.orders[0].orderId,'order-1');
assert.equal(snapshot.prices[0].lastPrice,'11');
assert.equal(snapshot.capabilities.dividends,false);
assert.ok(requests.every(row=>row.path==='/api/v1/accounts'||row.path==='/api/v1/holdings'||row.path.startsWith('/api/v1/orders?')||row.path.startsWith('/api/v1/prices?')));
assert.equal(requests.find(row=>row.path==='/api/v1/holdings').accountSeq,'7');
assert.equal(requests.find(row=>row.path.startsWith('/api/v1/prices?')).path,'/api/v1/prices?symbols=MSTY','invalid and empty symbols must not reach the native API');

await clearNativeTossCredentials();
assert.equal(cleared,true);
assert.equal((await nativeTossCredentialStatus()).configured,false);
console.log('Toss Android adapter PASS: encrypted-plugin boundary, read-only snapshot, IP and credential lifecycle');
