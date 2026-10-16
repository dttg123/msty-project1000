import {test,expect} from '@playwright/test';
import {blankState} from '../../modules/state.js';
test.use({serviceWorkers:'block'});
test('a successful login cannot clear a failed cloud write or claim cloud save completion',async({page},info)=>{
 const state=blankState();state.trades=[{id:'synthetic-buy',projectId:state.projects[0].id,date:'2026-01-01',type:'buy',buyType:'direct',shares:10,price:10}];
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:`export async function initGoogleAuth(o){await window.__seedReady;await o.onSignedIn({uid:'synthetic-failed-cloud'});}export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){throw new Error('Synthetic cloud write failure');}export async function subscribeCloudDocument(){return ()=>{};}`}));
 await page.route('https://**/*',r=>r.abort());
 await page.addInitScript(state=>{window.__seedReady=new Promise(resolve=>{const r=indexedDB.open('DividendOSDB_V4',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>{const db=r.result,tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(state,'stateFundingV1');tx.oncomplete=()=>{db.close();resolve();};};});},state);
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();await expect(page.locator('#saveStatus')).toHaveText('클라우드 저장 실패');
 await page.locator('[data-page="settings"]').first().click();await expect(page.locator('#cloudConnectionSummary')).toHaveText('클라우드 저장 실패');await expect(page.locator('#cloudSectionSummary')).toHaveText('저장 실패');await page.locator('.settings-status>summary').click();await expect(page.locator('#cloudSavedAt')).toHaveText('기록 없음');
 const saved=await page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('stateFundingV1');});expect(saved.trades).toEqual(state.trades);expect(saved.meta.lastCloudSaveAt||'').toBe('');
 await page.screenshot({path:info.outputPath('failed-cloud-is-not-connected-success.png'),fullPage:true});
});
