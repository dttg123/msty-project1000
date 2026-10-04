import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import vm from 'node:vm';

const root=resolve(import.meta.dirname,'..');
const source=await readFile(resolve(root,'sw.js'),'utf8');
const manifest=JSON.parse(await readFile(resolve(root,'manifest.webmanifest'),'utf8'));
const index=await readFile(resolve(root,'index.html'),'utf8');
const handlers=new Map(),stores=new Map();
const scope='https://example.test/v4/';
const key=value=>new URL(typeof value==='string'?value:value.url,scope).href;
class WorkerRequest {
  constructor(input,init={}){
    this.url=key(input);this.method=init.method||input?.method||'GET';
    this.mode=init.mode||input?.mode||'cors';this.cache=init.cache||input?.cache||'default';
  }
}
const cacheApi={
  async open(name){
    if(!stores.has(name))stores.set(name,new Map());
    const store=stores.get(name);
    return {
      async addAll(assets){for(const asset of assets)store.set(key(asset),new Response(`cached:${asset}`));},
      async put(request,response){store.set(key(request),response);}
    };
  },
  async keys(){return [...stores.keys()];},
  async delete(name){return stores.delete(name);},
  async match(request){for(const store of stores.values()){const found=store.get(key(request));if(found)return found.clone();}return undefined;}
};
let online=true,claimed=false,skipped=false;
const context={
  URL,Request:WorkerRequest,Response,console,caches:cacheApi,
  registration:{scope},location:new URL(scope),
  clients:{claim:async()=>{claimed=true;}},skipWaiting:async()=>{skipped=true;},
  fetch:async request=>{if(!online)throw new Error('offline');return new Response(`fresh:${key(request)}`,{status:200});},
  addEventListener:(name,listener)=>handlers.set(name,listener)
};
vm.runInNewContext(source,context,{filename:'sw.js'});
assert.deepEqual([...handlers.keys()].sort(),['activate','fetch','install']);

let pending;
handlers.get('install')({waitUntil:value=>{pending=value;}});await pending;
assert.equal(skipped,true,'new worker must activate without leaving mixed app shells');
const current=[...stores.keys()].find(name=>name.includes('dividend-os-v0.12.26-r87'));
assert.ok(current,'cache name must contain the displayed deployment version');
for(const required of ['./','./index.html','./app.js','./styles.css','./manifest.webmanifest'])assert.ok(stores.get(current).has(key(required)),`precache missing ${required}`);

stores.set('dividend-os-/v4/-old-release',new Map());
stores.set('unrelated-cache',new Map());
handlers.get('activate')({waitUntil:value=>{pending=value;}});await pending;
assert.equal(claimed,true);assert.equal(stores.has('dividend-os-/v4/-old-release'),false);assert.equal(stores.has('unrelated-cache'),true);

async function dispatchFetch(url,{method='GET',mode}={}){
  let responsePromise;
  const request=new WorkerRequest(url,{method,mode});
  handlers.get('fetch')({request,respondWith:value=>{responsePromise=value;}});
  return responsePromise?await responsePromise:null;
}
const appUrl=new URL('app.js',scope).href;
assert.match(await (await dispatchFetch(appUrl)).text(),/^fresh:/,'online requests must revalidate before cache use');
online=false;
assert.match(await (await dispatchFetch(appUrl)).text(),/^fresh:/,'last verified response must remain available offline');
const navigation=await dispatchFetch(new URL('deep/link',scope).href,{mode:'navigate'});
assert.match(await navigation.text(),/^cached:\.\/index\.html$/,'offline direct navigation must fall back to the app shell');
assert.equal(await dispatchFetch(appUrl,{method:'POST'}),null,'non-GET requests must never be intercepted');
assert.equal(await dispatchFetch('https://other.test/app.js'),null,'cross-origin requests must never be intercepted');

assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.display,'standalone');
assert.deepEqual(manifest.icons.map(icon=>icon.sizes),['192x192','512x512']);
assert.ok(index.includes('<link rel="manifest" href="manifest.webmanifest" />'));
assert.equal(manifest.name,'DividendOS');assert.equal(manifest.short_name,'DividendOS');
assert.ok(index.includes('v0.12.26')&&source.includes('v0.12.26-r87'),'visible and cached releases must agree');
console.log('PWA contract PASS: install, update cleanup, online revalidation, offline shell, manifest, and version coherence');
