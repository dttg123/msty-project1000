import assert from 'node:assert/strict';
import {removeLegacyTossBrowserCredentials,isTossBridgeConfigured} from '../toss-client.js';

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
console.log('Toss client security PASS: legacy browser credentials removed without reading');
