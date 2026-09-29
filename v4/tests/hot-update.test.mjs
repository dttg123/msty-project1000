import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

let confirmed=0,installed=0;
globalThis.window={Capacitor:{Plugins:{HotUpdate:{
  status:async()=>({available:true,currentVersion:'0.12.9',latestVersion:'0.13.0',updateAvailable:true,nativeUpdateRequired:false}),
  install:async()=>{installed++;return {started:true};},
  confirmReady:async()=>{confirmed++;}
}}}};
const update=await import('../hot-update.js');
assert.equal(update.isHotUpdateAvailable(),true);
assert.equal((await update.hotUpdateStatus()).updateAvailable,true);
await update.installHotUpdate();await update.confirmHotUpdateReady();
assert.equal(installed,1);assert.equal(confirmed,1);
const native=readFileSync(resolve(import.meta.dirname,'../android/app/src/main/java/com/dividendos/app/HotUpdatePlugin.java'),'utf8');
assert.match(native,/SHA256withRSA/);
assert.match(native,/getCanonicalPath\(\)\.startsWith\(root\)/);
assert.match(native,/MAX_EXPANDED_BYTES/);
assert.match(native,/rollbackPendingUpdate/);
assert.match(native,/raw\.githubusercontent\.com\/dttg123\/msty-project1000\/main\/updates/);
assert.doesNotMatch(native,/call\.getString\("(?:url|bundleUrl)"/);
console.log('Signed in-app hot update contract PASS');
