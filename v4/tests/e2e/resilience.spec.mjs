import {test,expect} from '@playwright/test';
import {blankState} from '../../modules/state.js';
const noAuth=`export async function initGoogleAuth(){};export async function logoutGoogle(){};export async function getGoogleIdToken(){return null;}export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
async function receipt(page,amount='12.34'){
 await page.locator('[data-page="projects"]').first().click();
 for(const selector of ['.record-center','.manual-tools'])if(await page.locator(selector).getAttribute('open')===null)await page.locator(selector+' > summary').click();
 await page.locator('[data-add-dividend]').click();await page.locator('#dividendForm [name="date"]').fill('2026-01-02');await page.locator('#dividendForm [name="amountUSD"]').fill(amount);await page.locator('#dividendForm button[type="submit"].primary').click();
}
async function ledger(page){return page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('DividendOSDB_V4');r.onsuccess=()=>{const db=r.result,q=db.transaction('kv').objectStore('kv').get('state');q.onsuccess=()=>{db.close();resolve(q.result);};};}));}

test('IndexedDB 즉시 거부에도 대체 저장이 작동하고 재시작 후 실제 배당을 유지한다',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:noAuth}));
 await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new DOMException('Blocked','SecurityError');}}}));
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();await receipt(page);await expect(page.locator('#dividendForm')).toBeHidden();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('dividend-os-v4:state')).dividends[0].amountUSD)).toBe(12.34);
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('dividend-os-v4:state')).dividends[0].amountUSD)).toBe(12.34);expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath('durable-fallback.png'),fullPage:true});
});

test('모든 저장소 차단 시 앱이 열리고 임시 저장을 영구 저장으로 표시하지 않는다',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:noAuth}));
 await page.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new DOMException('Blocked','SecurityError');}}});for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{configurable:true,get(){throw new DOMException('Blocked','SecurityError');}});});
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();await expect(page.locator('#saveStatus')).toContainText('임시 저장');await receipt(page);await expect(page.locator('#dividendForm')).toBeHidden();await expect(page.locator('#saveStatus')).toContainText('임시 저장');expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('memory-warning.png'),fullPage:true});
});

const seed=blankState();seed.trades=[{id:'synthetic-t',projectId:seed.projects[0].id,date:'2026-01-01',type:'buy',buyType:'direct',shares:10,price:10}];
const cloudApi=`export async function initGoogleAuth(o){await window.__seedReady;window.__signedOut=o.onSignedOut;await o.onSignedIn({uid:'isolated-qa'});}
export async function logoutGoogle(){window.__signedOut();}export async function getGoogleIdToken(){return null;}
export async function getCloudDocument(){return {state:structuredClone(window.__remote),revision:window.__revision};}export async function getLegacyCloudDocument(){return null;}
export async function saveCloudDocument(uid,state,options){window.__writes++;if(window.__defer)await new Promise((resolve,reject)=>{window.__reject=reject;});if(window.__fail)throw {code:'unavailable'};if(options.expectedRevision!==window.__revision)throw {code:'cloud-conflict'};window.__remote=structuredClone(state);return {revision:++window.__revision};}
export async function subscribeCloudDocument(uid,data,error){window.__subscriptionError=error;return ()=>{};}`;
async function cloudSetup(page){
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloudApi}));
 await page.addInitScript(seed=>{window.__remote=structuredClone(seed);window.__revision=1;window.__writes=0;window.__seedReady=new Promise(resolve=>{const r=indexedDB.open('DividendOSDB_V4',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>{const db=r.result,tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(seed,'state');tx.oncomplete=()=>{db.close();resolve();};};});},seed);
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();await expect.poll(()=>page.evaluate(()=>!!window.__subscriptionError)).toBe(true);
}

test('클라우드 실패와 오프라인 입력은 기기에 남고 재연결하면 실제 금액 그대로 저장된다',async({page,context})=>{
 await cloudSetup(page);await page.evaluate(()=>window.__fail=true);await receipt(page);await expect(page.locator('#dividendForm')).toBeHidden();expect((await ledger(page)).dividends[0].amountUSD).toBe(12.34);expect(await page.evaluate(()=>window.__remote.dividends.length)).toBe(0);
 await context.setOffline(true);await receipt(page,'5.67');await expect(page.locator('#dividendForm')).toBeHidden();expect((await ledger(page)).dividends.map(d=>d.amountUSD)).toEqual([12.34,5.67]);
 await page.evaluate(()=>window.__fail=false);await context.setOffline(false);await expect.poll(()=>page.evaluate(()=>window.__remote.dividends.map(d=>d.amountUSD))).toEqual([12.34,5.67]);expect((await ledger(page)).trades).toEqual(seed.trades);
});

test('저장 중 로그아웃 후 늦은 충돌·구독 오류가 와도 기기 기록과 로그인 상태를 훼손하지 않는다',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await cloudSetup(page);await page.evaluate(()=>window.__defer=true);await receipt(page);await expect.poll(()=>page.evaluate(()=>!!window.__reject)).toBe(true);
 await page.evaluate(()=>{window.__signedOut();window.__reject({code:'cloud-conflict'});window.__subscriptionError({code:'permission-denied'});});
 await expect(page.locator('#dividendForm')).toBeHidden();expect((await ledger(page)).dividends[0].amountUSD).toBe(12.34);await expect(page.locator('#authGate')).toBeHidden();await expect(page.locator('#saveStatus')).not.toContainText('동기화 오류');expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('late-account-error.png'),fullPage:true});
});
