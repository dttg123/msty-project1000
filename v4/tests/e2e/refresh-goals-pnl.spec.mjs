import {test,expect} from '@playwright/test';
import {blankState} from '../../modules/state.js';
test.use({serviceWorkers:'block'});
const cloud=`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
const native=`export function isNativeTossAvailable(){return true;}export async function nativeTossCredentialStatus(){return {available:true,configured:true,lastPublicIp:'1.2.3.4'};}export async function saveNativeTossCredentials(){}export async function clearNativeTossCredentials(){}export async function nativePublicIp(){return window.__newIp||'1.2.3.4';}export async function markNativeTossPublicIp(){}export async function openTossIpManagement(){}export async function fetchNativeTossSnapshot(){window.__tossCalls=(window.__tossCalls||0)+1;await new Promise(r=>setTimeout(r,180));if(window.__tossFail)throw new Error('Synthetic unavailable Toss');return {accountLabel:'QA account',accountScopeId:'0123456789abcdef01234567',fetchedAt:new Date().toISOString(),syncStatus:window.__partial?'partial':'complete',capabilities:{orders:true,holdings:true,prices:true,dividends:false},accountResults:[],holdings:[{symbol:'MSTY',market:'US',currency:'USD',quantity:'10',averagePurchasePrice:'10'}],prices:[{symbol:'MSTY',market:'US',currency:'USD',lastPrice:'8.4',timestamp:new Date().toISOString()}],orders:[],dividends:[],failedAccountCount:window.__partial?1:0,historyTruncated:false};}`;
function fixture(mode='auto'){
 const s=blankState(),p=s.projects[0],now=new Date(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 s.settings={...s.settings,displayCurrency:'USD',exchangeRateMode:mode,exchangeRate:1300,exchangeRateUpdatedAt:now.toISOString(),exchangeRateDate:date,targetMonthlyDividend:80,warningKRW:40000,thresholdKRW:60000};
 p.currentPrice=8.4;p.priceUpdatedAt=now.toISOString();
 s.trades=[{id:'buy',projectId:p.id,date:'2025-01-01',type:'buy',buyType:'direct',shares:10,price:10}];
 s.dividends=[{id:'receipt',projectId:p.id,date,amountUSD:40,rocAmountUSD:40}];return s;
}
async function read(page){return page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('state');});}
async function setup(page,{mode='auto',nativeAvailable=true}={}){
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloud}));
 if(nativeAvailable)await page.route('**/toss-native.js',r=>r.fulfill({contentType:'application/javascript',body:native}));
 const fx={calls:0,fail:false};await page.route('https://api.frankfurter.dev/v2/rate/USD/KRW',r=>{fx.calls++;return r.fulfill({status:fx.fail?503:200,contentType:'application/json',body:JSON.stringify({base:'USD',quote:'KRW',rate:1400,date:fixture().settings.exchangeRateDate})});});
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();await page.evaluate(async s=>{const {storageSet}=await import('/storage.js');await storageSet('state',s);},fixture(mode));await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();fx.calls=0;return fx;
}
async function openDividendSettings(page){
 await page.locator('[data-page="settings"]').first().click();
 const section=page.locator('details.settings-section').filter({has:page.locator('#dividendSettingsForm')});
 if(await section.getAttribute('open')===null)await section.locator(':scope > summary').click();
 const annual=page.locator('.annual-alert-settings');
 if(await annual.getAttribute('open')===null)await annual.locator(':scope > summary').click();
 await expect(page.locator('#dividendSettingsForm [name="dividendAlertEnabled"]')).toBeVisible();
}
async function refresh(page){await page.locator('#page-home [data-sync-all]').click();await expect(page.locator('#page-home [data-sync-all]')).toBeEnabled();}

for(const failure of ['none','toss','fx','partial'])test(`통합 갱신은 ${failure} 결과를 분리하고 장부와 환율을 함께 보존한다`,async({page})=>{
 const fx=await setup(page);fx.fail=failure==='fx';await page.evaluate(f=>{window.__tossFail=f==='toss';window.__partial=f==='partial';},failure);
 await page.locator('#page-home [data-sync-all]').evaluate(el=>{el.click();el.click();});
 await expect(page.locator('#page-home [data-sync-all]')).toBeEnabled();
 await expect(page.locator('#page-home .refresh-panel')).toContainText(failure==='toss'?'토스 확인 실패':failure==='partial'?'토스 일부 성공':'토스 성공');
 await expect(page.locator('#page-home .refresh-panel')).toContainText(failure==='fx'?'환율 실패 · 저장값 유지':'환율 성공');
 expect(await page.evaluate(()=>window.__tossCalls)).toBe(1);expect(fx.calls).toBe(1);
 const s=await read(page);expect(s.settings.exchangeRate).toBe(failure==='fx'?1300:1400);expect(s.integrations.toss.syncSequence||0).toBe(failure==='toss'?0:1);expect(s.trades).toHaveLength(1);expect(s.dividends).toHaveLength(1);
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await read(page)).settings.exchangeRate).toBe(s.settings.exchangeRate);
});
test('통합 갱신은 수동 환율을 유지하고 IP 등록 전 조회를 진행하지 않는다',async({page})=>{
 const fx=await setup(page,{mode:'manual'});await refresh(page);await expect(page.locator('#page-home .refresh-panel')).toContainText('환율 수동값 유지');expect(fx.calls).toBe(0);expect((await read(page)).settings.exchangeRate).toBe(1300);
 await page.evaluate(()=>{window.__newIp='5.6.7.8';});await page.locator('#page-home [data-sync-all]').click();await expect(page.locator('[data-confirm-toss-ip]')).toBeVisible();await expect(page.locator('#page-settings .refresh-panel')).toContainText('토스 IP 등록 필요');expect(await page.evaluate(()=>window.__tossCalls)).toBe(1);await page.locator('[data-confirm-toss-ip]').click();await expect(page.locator('#page-settings .refresh-panel')).toContainText('토스 성공');expect(await page.evaluate(()=>window.__tossCalls)).toBe(2);expect(fx.calls).toBe(0);
});
test('현재 주가 손실·배당 포함 이익과 실제 입금 목표를 모바일 화면에서 구분한다',async({page},info)=>{
 await setup(page,{mode:'manual'});await expect(page.locator('#page-home .monthly-dividend-goal')).toContainText('50.0%');await expect(page.locator('#page-home .dividend-alert')).toContainText('미리 알림');
 await page.locator('[data-page="projects"]').first().click();await expect(page.locator('#page-projects [data-sync-all]')).toBeVisible();await expect(page.locator('[data-current-pnl]')).toContainText('-$16');await expect(page.locator('.value-line')).toContainText('배당 포함 총손익 +$24');await expect(page.locator('[data-current-pnl]')).toContainText('ROC 조정 전');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('1.1-current-pnl.png'),fullPage:true});
 await openDividendSettings(page);await expect(page.locator('#page-settings [data-sync-all]')).toBeVisible();await page.locator('#dividendSettingsForm [name="thresholdKRW"]').fill('50000');await page.locator('#dividendSettingsForm button[type="submit"]').click();await expect.poll(async()=>(await read(page)).settings.thresholdKRW).toBe(50000);
 await page.locator('[data-page="home"]').first().click();await expect(page.locator('#page-home .dividend-alert')).toContainText('기준 도달');
 await openDividendSettings(page);await page.locator('#dividendSettingsForm [name="dividendAlertEnabled"]').selectOption('off');await page.locator('#dividendSettingsForm button[type="submit"]').click();await expect.poll(async()=>(await read(page)).settings.dividendAlertEnabled).toBe(false);await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await expect(page.locator('#page-home .dividend-alert')).toHaveCount(0);
});
test('토스 미연결 상태도 환율 갱신 결과와 연결 필요를 함께 표시한다',async({page})=>{
 const fx=await setup(page,{nativeAvailable:false});await page.locator('#page-home [data-sync-all]').click();await expect(page.locator('#page-settings .refresh-panel')).toContainText('토스 조회 연결 필요 · 환율 성공');expect(fx.calls).toBe(1);expect((await read(page)).settings.exchangeRate).toBe(1400);
});
