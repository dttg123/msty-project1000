import assert from 'node:assert/strict';
import {removeLegacyTossBrowserCredentials,isTossBridgeConfigured,validateTossSnapshotPayload} from '../toss-client.js';

const values=new Map([['dividend-os-toss-direct-v1','do-not-read-this-value'],['safe-setting','keep']]);
let reads=0;
globalThis.localStorage={
  getItem:()=>{reads++;throw new Error('legacy credential values must never be read');},
  removeItem:key=>values.delete(key)
};

assert.equal(removeLegacyTossBrowserCredentials(),true);
assert.equal(reads,0);
assert.equal(values.has('dividend-os-toss-direct-v1'),false);
assert.equal(values.get('safe-setting'),'keep');
assert.equal(removeLegacyTossBrowserCredentials(),true);
assert.equal(isTossBridgeConfigured(),false);
const validSnapshot={accountScopeId:'0123456789abcdef01234567',syncStatus:'partial',syncCursor:{ordersThrough:'2026-09-28'},capabilities:{orders:true},holdings:[],prices:[],orders:[],dividends:[],accountResults:[]};
assert.equal(validateTossSnapshotPayload(validSnapshot),validSnapshot);
for(const invalid of [{},null,{...validSnapshot,orders:'not-an-array'},{...validSnapshot,accountScopeId:'unsafe'}])assert.throws(()=>validateTossSnapshotPayload(invalid));
console.log('Toss client security PASS: legacy browser credentials removed without reading');
