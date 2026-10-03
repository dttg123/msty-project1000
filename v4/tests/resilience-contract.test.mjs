import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const cloud=readFileSync(new URL('../cloud.js',import.meta.url),'utf8');
const deleted=[];
globalThis.__qaFirestore={
 collection:(_db,...path)=>path.join('/'),doc:(_db,...path)=>path.join('/'),
 getDocs:async ref=>({docs:ref.endsWith('/revisions')?[
   {id:'current',ref:'current',data:()=>({revision:5})},
   {id:'previous',ref:'previous',data:()=>({revision:4})},
   {id:'old',ref:'old',data:()=>({revision:3})},
   {id:'staged-next',ref:'staged-next',data:()=>({revision:6,status:'ready'})}
 ]:[{ref:ref+'/segment'}]}),
 writeBatch:()=>({delete:ref=>deleted.push(ref),commit:async()=>{}})
};
let source=cloud.replace(/import \{[^\n]+\} from 'https:[^']+';/,"const {collection,doc,getDoc,getDocs,onSnapshot,runTransaction,serverTimestamp,writeBatch}=globalThis.__qaFirestore;")
 .replace("import { firestore } from './firebase.js';",'const firestore={};')
 .replace("'./modules/cloud-contract.js'",JSON.stringify(pathToFileURL(new URL('../modules/cloud-contract.js',import.meta.url).pathname).href));
source+='\nexport {cleanupOldRevisions};';
const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
await module.cleanupOldRevisions('isolated-qa',{revisionId:'current',revision:5});
assert.ok(deleted.includes('old'),'expired revisions should be removed');
assert.ok(!deleted.some(ref=>ref.includes('staged-next')),'cleanup must never delete a newer revision that another device is preparing');
assert.ok(!deleted.includes('previous'),'previous published recovery copy is kept');

const originalIDB=globalThis.indexedDB,originalLS=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const values=new Map();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)??null,removeItem:k=>values.delete(k)}});
globalThis.indexedDB={open:()=>{throw new Error('SecurityError: persistence disabled');}};
const storageSource=readFileSync(new URL('../storage.js',import.meta.url),'utf8');
const store=await import('data:text/javascript;base64,'+Buffer.from(storageSource).toString('base64'));
await assert.doesNotReject(store.openStorage(),'synchronous IndexedDB failure must reach the durable fallback');
assert.equal(store.storageStatus().mode,'localstorage');
await store.storageSet('state',{dividends:[{amountUSD:12.34}]});
assert.deepEqual(await store.storageGet('state'),{dividends:[{amountUSD:12.34}]});
let recoveredIdbOpens=0;
globalThis.indexedDB={open:()=>{recoveredIdbOpens++;throw new Error('must retain saved fallback backend');}};
const recovered=await import('data:text/javascript;base64,'+Buffer.from(storageSource+'\n// recovered launch').toString('base64'));
await recovered.openStorage();
assert.equal(recovered.storageStatus().mode,'localstorage');
assert.deepEqual(await recovered.storageGet('state'),{dividends:[{amountUSD:12.34}]});
assert.equal(recoveredIdbOpens,0);
await recovered.storageDelete('state');
const afterDelete=await import('data:text/javascript;base64,'+Buffer.from(storageSource+'\n// launch after delete').toString('base64'));
await afterDelete.openStorage();
assert.equal(await afterDelete.storageGet('state'),undefined,'deleted ledger must not resurrect older IndexedDB data');
assert.equal(recoveredIdbOpens,0);
values.delete('dividend-os-v4:storage-backend');values.set('dividend-os-v4:state',JSON.stringify({legacyFallback:true}));
const previousFallback=await import('data:text/javascript;base64,'+Buffer.from(storageSource+'\n// previous version fallback').toString('base64'));
await previousFallback.openStorage();assert.deepEqual(await previousFallback.storageGet('state'),{legacyFallback:true});
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:()=>{throw new Error('quota');},getItem:()=>null,removeItem:()=>{}}});
const memory=await import('data:text/javascript;base64,'+Buffer.from(storageSource+'\n// separate memory scenario').toString('base64'));
await memory.openStorage();assert.equal(memory.storageStatus().durable,false,'blocked persistence must never claim durability');
await memory.storageSet('state',{value:1});assert.deepEqual(await memory.storageGet('state'),{value:1});
if(originalIDB===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=originalIDB;
if(originalLS)Object.defineProperty(globalThis,'localStorage',originalLS);else delete globalThis.localStorage;
delete globalThis.__qaFirestore;
console.log('Resilience contract PASS: staged cloud revisions, synchronous storage denial, durable fallback and honest memory mode');
