import assert from 'node:assert/strict';
import {blankState} from '../modules/state.js';
import {assembleCloudState,assertCloudRevision,canonicalStringify,CloudConflictError,prepareCloudRevision,utf8Bytes} from '../modules/cloud-contract.js';
import {AUTO_BACKUP_KEEP,rotateAutoBackups} from '../modules/backup-history.js';

const state=blankState();
state.projects=[{...state.projects[0],id:'p-msty'}];
state.trades=Array.from({length:15000},(_,index)=>({id:`t-${index}`,projectId:'p-msty',symbol:'MSTY',date:`${2020+Math.floor(index/365)}-${String(index%12+1).padStart(2,'0')}-${String(index%28+1).padStart(2,'0')}`,type:'buy',buyType:'direct',shares:1,price:10+index%9,feeUSD:.01,taxUSD:0,note:'장기 데이터 '.repeat(3)}));
state.dividends=Array.from({length:6000},(_,index)=>({id:`d-${index}`,projectId:'p-msty',symbol:'MSTY',date:`${2020+Math.floor(index/365)}-${String(index%12+1).padStart(2,'0')}-${String(index%28+1).padStart(2,'0')}`,amountUSD:1+index%5,status:'actual'}));
assert.ok(utf8Bytes(state)>1_048_576,'fixture must exceed Firestore single-document size');
const prepared=await prepareCloudRevision(state,{expectedRevision:4,batchId:'batch-fixed',createdAt:'2026-09-28T00:00:00.000Z'});
const replay=await prepareCloudRevision(state,{expectedRevision:4,batchId:'batch-fixed',createdAt:'2026-09-28T00:00:00.000Z'});
assert.deepEqual(replay.manifest,prepared.manifest,'same batch replay must be deterministic');
assert.equal(prepared.manifest.revision,5);assert.equal(prepared.manifest.expectedRevision,4);assert.ok(prepared.documents.length>7);
assert.ok(prepared.documents.every(document=>document.bytes<=700_000));
assert.deepEqual(await assembleCloudState(prepared.manifest,prepared.documents),state);
await assert.rejects(assembleCloudState(prepared.manifest,prepared.documents.slice(1)),/누락/);
const tampered=structuredClone(prepared.documents);tampered.find(document=>document.key==='trades').rows[0].price=999;
await assert.rejects(assembleCloudState(prepared.manifest,tampered),/무결성/);
assert.equal(assertCloudRevision(4,4),true);
assert.throws(()=>assertCloudRevision(4,5),error=>error instanceof CloudConflictError&&error.code==='cloud-conflict');
let currentRevision=0;assertCloudRevision(0,currentRevision);currentRevision=1;assert.throws(()=>assertCloudRevision(0,currentRevision),CloudConflictError,'second device starting at the same revision must be blocked');

const memory=new Map(),storage={get:key=>memory.get(key),set:(key,value)=>{memory.set(key,structuredClone(value));},remove:key=>{memory.delete(key);}};
for(let index=0;index<9;index++){const next=structuredClone(state);next.meta.updatedAt=`2026-09-${String(index+1).padStart(2,'0')}T00:00:00.000Z`;await rotateAutoBackups(storage,next,{now:next.meta.updatedAt});}
const index=memory.get('autoBackupIndexV1');assert.equal(index.length,AUTO_BACKUP_KEEP);assert.equal([...memory.keys()].filter(key=>key.startsWith('autoBackupV1:')).length,AUTO_BACKUP_KEEP);
assert.equal(index[0].createdAt,'2026-09-09T00:00:00.000Z');
console.log(`Cloud contract PASS: ${prepared.manifest.stateBytes} bytes split into ${prepared.documents.length} verified documents; revision conflict and 7-copy rotation protected`);
