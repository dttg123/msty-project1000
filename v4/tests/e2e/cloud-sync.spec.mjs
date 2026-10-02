import {test,expect} from '@playwright/test';
import {blankState} from '../../modules/state.js';
const original=blankState();const id=original.projects[0].id;
original.trades=[{id:'t',projectId:id,date:'2026-01-01',type:'buy',buyType:'direct',shares:10,price:10}];
original.dividends=[{id:'d',projectId:id,date:'2026-01-02',amountUSD:1,currency:'USD'}];
const remote=structuredClone(original);remote.dividends[0].amountUSD=99;
const api=`export async function initGoogleAuth(o){await window.__seedReady;window.__signedIn=o.onSignedIn;await o.onSignedIn({uid:'qa-user'});}
export async function logoutGoogle(){};export async function getGoogleIdToken(){return null;}
export async function getCloudDocument(){return {state:structuredClone(window.__remote),revision:window.__revision};}
export async function getLegacyCloudDocument(){return null;}
export async function saveCloudDocument(uid,state,options){if(options.expectedRevision!==window.__revision)throw {code:'cloud-conflict'};window.__remote=structuredClone(state);return {revision:++window.__revision};}
export async function subscribeCloudDocument(){return ()=>{};}`;
async function ledger(page){return page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('DividendOSDB_V4');r.onsuccess=()=>{const db=r.result,q=db.transaction('kv').objectStore('kv').get('state');q.onsuccess=()=>{db.close();resolve(q.result);};};}));}
test('로그인과 클라우드 충돌은 분리되고 초기 배당 교체는 기기에 안전 저장된다',async({page},testInfo)=>{
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:api}));
 await page.route('**/data/dividend-announcements.json',r=>r.abort());
 await page.addInitScript(({original,remote})=>{window.__remote=remote;window.__revision=1;window.__seedReady=new Promise(resolve=>{const r=indexedDB.open('DividendOSDB_V4',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>{const db=r.result,tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(original,'state');tx.oncomplete=()=>{db.close();resolve();};};});},{original,remote});
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();await expect(page.locator('#authGate')).toBeHidden();await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
 await page.locator('[data-page="settings"]').first().click();await expect(page.locator('#page-settings')).toContainText('연결됨');
 const advanced=page.locator('details.settings-section').filter({has:page.locator('[data-backup]')});await advanced.locator(':scope > summary').click();await expect(page.locator('[data-replace-dividends]')).toBeHidden();
 const once=page.locator('details.initial-import-tools').filter({has:page.locator('[data-replace-dividends]')});await once.locator(':scope > summary').click();await page.locator('[data-replace-dividends]').click();
 await page.locator('#dividendReplacementInput').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'dividend-os-dividend-replacement-v1',scope:'all-dividends',symbol:'MSTY',currency:'USD',rows:[{date:'2026-01-02',amountUSD:12.34}]}))});
 await expect(page.locator('#confirmDividendReplacement')).toBeVisible();await page.locator('#confirmDividendReplacement').click();await expect.poll(async()=>(await ledger(page)).dividends[0].amountUSD).toBe(12.34);expect(await page.evaluate(()=>window.__remote.dividends[0].amountUSD)).toBe(99);expect((await ledger(page)).trades).toEqual(original.trades);
 await page.locator('[data-page="settings"]').first().click();const cloud=page.locator('details.settings-section').filter({has:page.locator('[data-review-cloud]')});await cloud.locator(':scope > summary').click();await page.locator('[data-review-cloud]').click();await expect(page.locator('#useLocal')).toBeVisible();await page.locator('#useLocal').click();await expect.poll(()=>page.evaluate(()=>window.__remote.dividends[0].amountUSD)).toBe(12.34);
 await page.evaluate(()=>window.__signedIn({uid:'qa-user'}));await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);await expect(page.locator('#authGate')).toBeHidden();await page.screenshot({path:testInfo.outputPath('cloud-login-independent.png'),fullPage:true});
});
