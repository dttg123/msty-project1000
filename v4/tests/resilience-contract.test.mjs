import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const cloud=readFileSync(new URL('../cloud.js',import.meta.url),'utf8');
let source=cloud.replace(/import \{[^\n]+\} from 'https:[^']+';/,"const {collection,doc,getDoc,getDocs,onSnapshot,runTransaction,serverTimestamp,writeBatch}=globalThis.__qaFirestore;")
 .replace("import { firestore } from './firebase.js';",'const firestore={};')
 .replace("'./modules/cloud-contract.js'",JSON.stringify(pathToFileURL(new URL('../modules/cloud-contract.js',import.meta.url).pathname).href));
const originalIDB=globalThis.indexedDB,originalLS=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const values=new Map();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)??null,removeItem:k=>values.delete(k)}});
globalThis.indexedDB={open:()=>{throw new Error('SecurityError: persistence disabled');}};
const storageSource=readFileSync(new URL('../storage.js',import.meta.url),'utf8').replace("'./modules/cloud-contract.js'",JSON.stringify(new URL('../modules/cloud-contract.js',import.meta.url).href));
const store=await import('data:text/javascript;base64,'+Buffer.from(storageSource).toString('base64'));
await assert.doesNotReject(store.openStorage(),'synchronous IndexedDB failure must reach the durable fallback');
assert.equal(store.storageStatus().mode,'localstorage');
await store.storageSet('state',{dividends:[{amountUSD:12.34}]});
assert.deepEqual(await store.storageGet('state'),{dividends:[{amountUSD:12.34}]});
const recovered=await import('data:text/javascript;base64,'+Buffer.from(storageSource+'\n// recovered launch').toString('base64'));
await recovered.openStorage();
assert.equal(recovered.storageStatus().mode,'localstorage');
assert.deepEqual(await recovered.storageGet('state'),{dividends:[{amountUSD:12.34}]});

await recovered.storageDelete('state');
const afterDelete=await import('data:text/javascript;base64,'+Buffer.from(storageSource+'\n// launch after delete').toString('base64'));
await afterDelete.openStorage();
assert.equal(await afterDelete.storageGet('state'),undefined,'deleted ledger must not resurrect older IndexedDB data');

values.delete('dividend-os-v4:storage-backend');values.set('dividend-os-v4:state',JSON.stringify({legacyFallback:true}));
const previousFallback=await import('data:text/javascript;base64,'+Buffer.from(storageSource+'\n// previous version fallback').toString('base64'));
await previousFallback.openStorage();assert.deepEqual(await previousFallback.storageGet('state'),{legacyFallback:true});
const secondTab=await import('data:text/javascript;base64,'+Buffer.from(storageSource+'\n// second funding tab').toString('base64'));
await secondTab.openStorage();
await previousFallback.storageGet('stateFundingV1');await secondTab.storageGet('stateFundingV1');
await previousFallback.storageSet('stateFundingV1',{dividends:[{amountUSD:23.45}]});
await assert.rejects(secondTab.storageSet('stateFundingV1',{dividends:[{amountUSD:1}]}),/다른 화면/,'a stale tab must not overwrite the new funding ledger');
assert.equal(JSON.parse(values.get('dividend-os-v4:stateFundingV1')).dividends[0].amountUSD,23.45);
await previousFallback.storageSet('state',{oldClient:true});
assert.equal(JSON.parse(values.get('dividend-os-v4:stateFundingV1')).dividends[0].amountUSD,23.45,'old-client writes use a separate key');
globalThis.indexedDB={open:()=>{throw new Error('SecurityError: persistence disabled');}};
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:()=>{throw new Error('quota');},getItem:()=>null,removeItem:()=>{}}});
const memory=await import('data:text/javascript;base64,'+Buffer.from(storageSource+'\n// separate memory scenario').toString('base64'));
await memory.openStorage();assert.equal(memory.storageStatus().durable,false,'blocked persistence must never claim durability');
await memory.storageSet('state',{value:1});assert.deepEqual(await memory.storageGet('state'),{value:1});
if(originalIDB===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=originalIDB;
if(originalLS)Object.defineProperty(globalThis,'localStorage',originalLS);else delete globalThis.localStorage;
delete globalThis.__qaFirestore;
console.log('Resilience contract PASS: staged cloud revisions, synchronous storage denial, durable fallback and honest memory mode');

// Execute the real cloud adapter against an isolated in-memory Firestore facade.
const documents=new Map(),root='users/qa/apps/',oldRoot=root+'dividend-os-v4',newRoot=root+'dividend-os-ledger-v2';
const {blankState}=await import('../modules/state.js');
const oldState=blankState();oldState.dividends=[{id:'income',projectId:oldState.projects[0].id,date:'2025-01-01',amountUSD:12}];
documents.set(oldRoot,{state:oldState,revision:7});
const path=(base,...parts)=>[...(typeof base==='string'?[base]:[]),...parts].join('/');
const snapshot=ref=>({exists:()=>documents.has(ref),data:()=>structuredClone(documents.get(ref))});
globalThis.__qaFirestore={collection:path,doc:path,getDoc:async ref=>snapshot(ref),getDocs:async ref=>({docs:[...documents].filter(([key])=>key.startsWith(ref+'/')&&!key.slice(ref.length+1).includes('/')).map(([key,value])=>({id:key.split('/').at(-1),ref:key,data:()=>structuredClone(value)}))}),writeBatch:()=>{const writes=[];return {set:(ref,data)=>writes.push(()=>documents.set(ref,structuredClone(data))),delete:ref=>writes.push(()=>documents.delete(ref)),commit:async()=>writes.forEach(write=>write())};},runTransaction:async(_db,fn)=>fn({get:async ref=>snapshot(ref),set:(ref,data)=>documents.set(ref,structuredClone(data))}),serverTimestamp:()=>null,onSnapshot:()=>()=>{}};
const adapter=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// funding cloud namespace').toString('base64'));
const migrated=await adapter.getCloudDocument('qa');assert.equal(migrated.revision,0);assert.deepEqual(migrated.state,oldState);
const newState=structuredClone(oldState);newState.dividends[0].amountUSD=23;
await adapter.saveCloudDocument('qa',newState,{expectedRevision:0,appVersion:'funding-QA'});
assert.equal(documents.get(oldRoot).state.dividends[0].amountUSD,12,'migration never mutates the old namespace');
documents.set(oldRoot,{state:{...oldState,dividends:[]},revision:8});
await assert.rejects(adapter.getCloudDocument('qa'),/이전 버전/,'changed legacy source must stop automatic overwrite');
documents.set(oldRoot,{state:oldState,revision:7});
assert.deepEqual((await adapter.getCloudDocument('qa')).state,newState);
assert.equal(documents.get(newRoot).revision,1);
await assert.rejects(adapter.saveCloudDocument('qa',oldState,{expectedRevision:0}),/충돌/);
delete globalThis.__qaFirestore;
console.log('Funding compatibility PASS: isolated local/cloud namespaces, read-only legacy migration, stale-tab compare-and-save, cloud revision guard');
