import {test,expect} from '@playwright/test';
import {blankState} from '../../modules/state.js';
import {createStoreZip} from '../../backup.js';
const noAuth=`export async function initGoogleAuth(){};export async function logoutGoogle(){};export async function getGoogleIdToken(){return null;}export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
const seed=blankState();seed.trades=[{id:'numeric-buy',projectId:seed.projects[0].id,date:'2026-01-01',type:'buy',buyType:'direct',shares:'10.5',price:'2',feeUSD:'0'}];seed.dividends=[{id:'numeric-dividend',projectId:seed.projects[0].id,date:'2026-01-02',amountUSD:'3.25',referencePrice:'0',rocPercent:null}];
async function open(page){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/modules/cloud-api.js',route=>route.fulfill({contentType:'application/javascript',body:noAuth}));
  await page.route('**/data/dividend-announcements.json',route=>route.abort());
  await page.addInitScript(seed=>{Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new DOMException('Blocked','SecurityError');}}});if(!localStorage.getItem('dividend-os-v4:state'))localStorage.setItem('dividend-os-v4:state',JSON.stringify(seed));},seed);
  await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();return errors;
}
async function stored(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('dividend-os-v4:state')));}
test('기존 숫자 문자열은 실제 숫자로 복원되고 0원과 미확인 ROC는 재시작해도 유지된다',async({page})=>{
  const errors=await open(page);const first=await stored(page);expect(first.trades[0].shares).toBe(10.5);expect(first.trades[0].feeUSD).toBe(0);expect(first.dividends[0].referencePrice).toBe(0);expect(first.dividends[0].rocPercent).toBeNull();
  await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await stored(page)).trades).toEqual(first.trades);expect((await stored(page)).dividends).toEqual(first.dividends);expect(errors).toEqual([]);
});
test('잘못된 수량이 든 ZIP 복원은 현재 원장을 교체하지 않는다',async({page})=>{
  const errors=await open(page),before=await stored(page),bad=structuredClone(before);bad.trades[0].shares=true;
  const zip=createStoreZip([{name:'data/state.json',data:JSON.stringify(bad)}]);
  await page.locator('#restoreInput').setInputFiles({name:'invalid-state.zip',mimeType:'application/zip',buffer:Buffer.from(await zip.arrayBuffer())});
  await expect(page.locator('#toast')).toContainText('유한한 숫자');await expect(page.locator('#confirmRestore')).toHaveCount(0);expect(await stored(page)).toEqual(before);expect(errors).toEqual([]);
});
