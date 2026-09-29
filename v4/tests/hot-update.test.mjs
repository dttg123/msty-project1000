import assert from 'node:assert/strict';
import {createHash,createPublicKey,verify} from 'node:crypto';
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
const manifest=JSON.parse(readFileSync(resolve(import.meta.dirname,'../../updates/latest.json'),'utf8'));
const bundle=readFileSync(resolve(import.meta.dirname,`../../updates/DividendOS-web-${manifest.version}.zip`));
assert.equal(bundle.subarray(0,4).toString('hex'),'504b0304','published hot-update bundle must be a ZIP archive');
assert.equal(createHash('sha256').update(bundle).digest('hex'),manifest.sha256,'published hot-update bundle hash must match');
const publicDer=native.match(/private static final String PUBLIC_KEY = "([^"]+)";/)?.[1];
assert.ok(publicDer,'native update public key must be embedded');
const publicKey=createPublicKey({key:Buffer.from(publicDer,'base64'),format:'der',type:'spki'});
assert.equal(verify('sha256',Buffer.from(`${manifest.version}\n${manifest.sha256}\n${manifest.minNativeVersion}`),publicKey,Buffer.from(manifest.signature,'base64')),true,'published manifest signature must match the exact native verification payload');
console.log('Signed in-app hot update contract PASS');
