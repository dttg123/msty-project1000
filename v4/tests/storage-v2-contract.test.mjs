import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {blankState} from '../modules/state.js';
import {prepareDeltaRevision,assembleDeltaState,sha256Hex,canonicalStringify} from '../modules/cloud-contract.js';
import {rotateAutoBackups,readAutoBackup,AUTO_BACKUP_INDEX_KEY,AUTO_BACKUP_BUDGET} from '../modules/backup-history.js';
const state=blankState();state.unknown={rows:[{id:'keep',raw:{original:'토스 원본',nullable:null}}]};
state.trades=Array.from({length:3780},(_,i)=>({id:'t'+i,projectId:state.projects[0].id,date:'2000-01-01',shares:1,price:17.95}));
state.dividends=Array.from({length:16380},(_,i)=>({id:'d'+i,projectId:state.projects[0].id,date:'2000-01-01',amountUSD:12.34}));
const first=await prepareDeltaRevision(state,{batchId:'first'}),all=new Map(first.documents.map(d=>[d.contentId,d]));
assert.deepEqual(await assembleDeltaState(first.manifest,[...all.values()]),state);
const unchanged=await prepareDeltaRevision(state,{expectedRevision:1,previous:first.manifest,batchId:'same'});assert.equal(unchanged.documents.length,0,'unchanged content is never resent');
const edited=structuredClone(state);edited.dividends[100].amountUSD=45.67;
const second=await prepareDeltaRevision(edited,{expectedRevision:1,previous:first.manifest,batchId:'second'});
assert.equal(second.documents.length,1,'one dividend edit uploads only its affected segment');for(const d of second.documents)all.set(d.contentId,d);
assert.deepEqual(await assembleDeltaState(second.manifest,[...all.values()]),edited);
await assert.rejects(assembleDeltaState(first.manifest,first.documents.slice(1)),/누락/);
const corrupt=structuredClone(first.documents);corrupt.find(d=>d.rows?.length).rows[0].id='tampered';await assert.rejects(assembleDeltaState(first.manifest,corrupt),/무결성/);
const duplicate=structuredClone(first.manifest);duplicate.segments.push(duplicate.segments[0]);await assert.rejects(assembleDeltaState(duplicate,first.documents));
const local=new Map();let batchFail=false;
const storage={get:async k=>structuredClone(local.get(k)),set:async(k,v)=>local.set(k,structuredClone(v)),remove:async k=>local.delete(k),batch:async writes=>{if(batchFail)throw new Error('synthetic full disk');for(const w of writes)w.remove?local.delete(w.key):local.set(w.key,structuredClone(w.value));}};
for(let i=0;i<8;i++){state.meta.edit=i;await rotateAutoBackups(storage,state,{now:`2026-10-${String(i+1).padStart(2,'0')}T00:00:00Z`});}
const entries=local.get(AUTO_BACKUP_INDEX_KEY);assert.equal(entries.length,7);let bytes=0;for(const entry of entries){const stored=local.get(entry.key);assert.equal(stored.encoding,'gzip-base64-v1');bytes+=stored.bytes;const recovered=await readAutoBackup(storage,entry.id);assert.equal(await sha256Hex(canonicalStringify(recovered.state)),entry.hash);}
assert.ok(bytes<AUTO_BACKUP_BUDGET);assert.ok(bytes<JSON.stringify(state).length,'seven compressed backups use less than one raw ledger');
const before=canonicalStringify([...local]);batchFail=true;state.meta.edit=9;await assert.rejects(rotateAutoBackups(storage,state),/full disk/);assert.equal(canonicalStringify([...local]),before,'failed rotation retains all recovery copies');
const originalCompression=globalThis.CompressionStream;globalThis.CompressionStream=undefined;batchFail=false;
const preserved=canonicalStringify([...local]);const oversized=structuredClone(state);oversized.unknown.large='x'.repeat(17*1024*1024);await assert.rejects(rotateAutoBackups(storage,oversized),/용량 한도/);assert.equal(canonicalStringify([...local]),preserved,'oversized new backup never prunes existing recovery copies');
const small=blankState();await rotateAutoBackups(storage,small);assert.deepEqual((await readAutoBackup(storage,local.get(AUTO_BACKUP_INDEX_KEY)[0].id)).state,small);globalThis.CompressionStream=originalCompression;
// Legacy uncompressed payloads remain readable.
const legacyState=blankState(),legacyHash=await sha256Hex(legacyState),legacyEntry={...entries[0],id:'legacy',key:'autoBackupV1:legacy',hash:legacyHash};local.set(AUTO_BACKUP_INDEX_KEY,[legacyEntry,...entries]);local.set(legacyEntry.key,{...legacyEntry,state:legacyState});assert.deepEqual((await readAutoBackup(storage,'legacy')).state,legacyState);
const bad=local.get(entries[0].key);bad.data=bad.data.slice(0,-10);local.set(entries[0].key,bad);await assert.rejects(readAutoBackup(storage,entries[0].id));
// Exercise the production adapter against an isolated transactional Firestore facade.
const documents=new Map(),newRoot='users/qa/apps/dividend-os-ledger-v2';let rejectBatch=false,rejectPublish=false,contentWrites=0;
const path=(base,...parts)=>[...(typeof base==='string'?[base]:[]),...parts].join('/');const snap=ref=>({exists:()=>documents.has(ref),data:()=>structuredClone(documents.get(ref))});
globalThis.__storageQA={collection:path,doc:path,getDoc:async ref=>snap(ref),getDocs:async ref=>({docs:[...documents].filter(([k])=>k.startsWith(ref+'/')&&!k.slice(ref.length+1).includes('/')).map(([k,v])=>({id:k.split('/').at(-1),ref:k,data:()=>structuredClone(v)}))}),writeBatch:()=>{const writes=[];return{set:(ref,v)=>writes.push(()=>{documents.set(ref,structuredClone(v));if(ref.includes('/segments/'))contentWrites++;}),delete:ref=>writes.push(()=>documents.delete(ref)),commit:async()=>{if(rejectBatch)throw new Error('network interrupted');writes.forEach(fn=>fn());}};},runTransaction:async(_db,fn)=>{const writes=[];await fn({get:async ref=>snap(ref),set:(ref,v)=>writes.push(()=>documents.set(ref,structuredClone(v)))});if(rejectPublish)throw new Error('publish interrupted');writes.forEach(fn=>fn());},serverTimestamp:()=>null,onSnapshot:()=>()=>{}};
let source=readFileSync(new URL('../cloud.js',import.meta.url),'utf8').replace(/import \{[^\n]+\} from 'https:[^']+';/,'const {collection,doc,getDoc,getDocs,onSnapshot,runTransaction,serverTimestamp,writeBatch}=globalThis.__storageQA;').replace("import { firestore } from './firebase.js';",'const firestore={};').replace("'./modules/cloud-contract.js'",JSON.stringify(new URL('../modules/cloud-contract.js',import.meta.url).href));
source+='\nexport {cleanupDelta};';const adapter=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
await adapter.saveCloudDocument('qa',state);assert.deepEqual((await adapter.getCloudDocument('qa')).state,state);const oldPointer=structuredClone(documents.get(newRoot));
contentWrites=0;await adapter.saveCloudDocument('qa',state,{expectedRevision:1});assert.equal(contentWrites,0);
const oldPublished=structuredClone(documents.get(newRoot));rejectPublish=true;await assert.rejects(adapter.saveCloudDocument('qa',edited,{expectedRevision:2}),/publish interrupted/);assert.deepEqual(documents.get(newRoot),oldPublished);assert.deepEqual((await adapter.getCloudDocument('qa')).state,state);
rejectPublish=false;rejectBatch=true;await assert.rejects(adapter.saveCloudDocument('qa',edited,{expectedRevision:2}),/network interrupted/);assert.deepEqual(documents.get(newRoot),oldPublished);rejectBatch=false;
await adapter.saveCloudDocument('qa',edited,{expectedRevision:2});await assert.rejects(adapter.saveCloudDocument('qa',state,{expectedRevision:2}),/충돌/);assert.deepEqual((await adapter.getCloudDocument('qa')).state,edited);
// GC must retain the current and previous revision, as well as fresh staged data.
const stale='2000-01-01T00:00:00Z';documents.set(newRoot+'/segments/orphan',{storedAt:stale});documents.set(newRoot+'/segments/staged',{storedAt:new Date().toISOString()});documents.set(newRoot+'/revisions/future',{revision:99,createdAt:stale,segments:[]});
await adapter.cleanupDelta('qa',documents.get(newRoot));assert.equal(documents.has(newRoot+'/segments/orphan'),false);assert.equal(documents.has(newRoot+'/segments/staged'),true);assert.equal(documents.has(newRoot+'/revisions/future'),true);assert.deepEqual((await adapter.getCloudDocument('qa')).state,edited);
delete globalThis.__storageQA;
console.log(`Storage V2 PASS: 35-year exact roundtrip, delta reuse, staged publish failure, CAS conflict, corrupt/missing content rejection, seven compressed restores (${bytes} bytes), atomic backup failure`);
