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

const oldSnapshot=structuredClone(seed);oldSnapshot.trades[0].source=null;oldSnapshot.trades[0].feeUSD=null;oldSnapshot.dividends[0].referencePrice=null;oldSnapshot.projects[0].priceSource='';oldSnapshot.projects[0].priceUpdatedAt=null;oldSnapshot.meta.lastCloudAttemptAt=null;oldSnapshot.meta.migrationAudit={version:0,checks:[]};oldSnapshot.integrations.toss.correctionCandidates=null;
async function seedOriginal(page,snapshot,{native=false}={}){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/modules/cloud-api.js',route=>route.fulfill({contentType:'application/javascript',body:noAuth}));
  await page.route('**/data/dividend-announcements.json',route=>route.abort());
  await page.addInitScript(({snapshot,native})=>{
    Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new DOMException('Blocked','SecurityError');}}});
    if(!localStorage.getItem('dividend-os-v4:state'))localStorage.setItem('dividend-os-v4:state',JSON.stringify(snapshot));
    if(native){window.__ready=0;window.__installed=0;window.Capacitor={Plugins:{HotUpdate:{confirmReady:async()=>{window.__ready++;},status:async()=>({available:true,currentVersion:'0.12.24',latestVersion:'0.12.25',updateAvailable:true,nativeUpdateRequired:false}),install:async()=>{window.__installed++;return {started:true};}}}};}
  },{snapshot,native});
  await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();return errors;
}
test('이전 업데이트의 null·빈 값·구형 점검 기록이 있어도 원장을 열고 원본 사본을 보존한다',async({page})=>{
  const errors=await seedOriginal(page,oldSnapshot);await expect(page.locator('#page-home .danger')).toHaveCount(0);
  const state=await stored(page);expect(state.trades[0].shares).toBe(10.5);expect(state.dividends[0].amountUSD).toBe(3.25);expect(state.trades).toHaveLength(1);expect(state.dividends).toHaveLength(1);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('dividend-os-v4:startupCompatibilityOriginalV1')))).toEqual(oldSnapshot);
  await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await expect(page.locator('#page-home .danger')).toHaveCount(0);expect((await stored(page)).trades).toEqual(state.trades);expect(errors).toEqual([]);
});
test('시작 검증 실패 시 원본을 덮어쓰거나 업데이트 성공 처리하지 않고 복구 버튼이 작동한다',async({page})=>{
  const corrupt=structuredClone(seed);corrupt.trades[0].shares=true;
  const errors=await seedOriginal(page,corrupt,{native:true});await expect(page.locator('#page-home')).toContainText('기존 기록을 확인할 수 없습니다');expect(await stored(page)).toEqual(corrupt);expect(await page.evaluate(()=>window.__ready)).toBe(0);
  const download=page.waitForEvent('download');await page.locator('#bootOriginalBackup').click();const file=await download;expect(file.suggestedFilename()).toContain('DividendOS_original');expect(await stored(page)).toEqual(corrupt);
  await page.locator('#bootRecoveryUpdate').click();await expect.poll(()=>page.evaluate(()=>window.__installed)).toBe(1);expect(await stored(page)).toEqual(corrupt);expect(errors).toEqual([]);
});
