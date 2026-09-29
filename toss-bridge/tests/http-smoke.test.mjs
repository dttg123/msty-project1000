import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';

const port=18000+(process.pid%1000);
const base=`http://127.0.0.1:${port}`;
let server;

async function waitForServer(){
  for(let attempt=0;attempt<50;attempt++){
    try{
      const response=await fetch(`${base}/health`);
      if(response.ok)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Toss bridge did not start');
}

test.before(async()=>{
  server=spawn(process.execPath,['server.mjs'],{
    cwd:new URL('..',import.meta.url),
    env:{...process.env,PORT:String(port),TOSS_CLIENT_ID:'qa-client',TOSS_CLIENT_SECRET:'qa-secret',FIREBASE_PROJECT_ID:'qa-project',ALLOWED_FIREBASE_UID:'qa_owner',ALLOWED_ORIGIN:'https://dttg123.github.io'},
    stdio:['ignore','ignore','pipe']
  });
  await waitForServer();
});

test.after(()=>{
  if(server&&!server.killed)server.kill('SIGTERM');
});

test('health exposes read-only mode without account data',async()=>{
  const response=await fetch(`${base}/health`),body=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(body,{ok:true,mode:'read-only',ordersEnabled:false});
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('snapshot rejects unauthenticated and foreign-origin requests',async()=>{
  const unauthenticated=await fetch(`${base}/v1/toss/snapshot`,{headers:{Origin:'https://dttg123.github.io'}});
  assert.equal(unauthenticated.status,401);
  assert.equal((await unauthenticated.json()).code,'login-required');

  const foreign=await fetch(`${base}/v1/toss/snapshot`,{headers:{Origin:'https://evil.example'}});
  assert.equal(foreign.status,403);
  assert.equal((await foreign.json()).code,'origin-not-allowed');
});

test('bridge exposes no order mutation route',async()=>{
  for(const path of ['/api/v1/orders','/api/v1/orders/opaque/cancel','/api/v1/orders/opaque/modify']){
    const response=await fetch(`${base}${path}`,{method:'POST',headers:{Origin:'https://dttg123.github.io'}});
    assert.equal(response.status,404);
    assert.equal((await response.json()).code,'not-found');
  }
});
