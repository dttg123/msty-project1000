import {test,expect} from '@playwright/test';
import {blankState} from '../../modules/state.js';
import {createStoreZip} from '../../backup.js';
test.use({serviceWorkers:'block'});
const cloud=`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
const native=`export function isNativeTossAvailable(){return true;}export async function nativeTossCredentialStatus(){return {available:true,configured:true,lastPublicIp:'1.2.3.4'};}export async function saveNativeTossCredentials(){}export async function clearNativeTossCredentials(){}export async function nativePublicIp(){return window.__newIp||'1.2.3.4';}export async function markNativeTossPublicIp(){}export async function openTossIpManagement(){}export async function fetchNativeTossSnapshot(){window.__tossCalls=(window.__tossCalls||0)+1;await new Promise(r=>setTimeout(r,180));if(window.__tossFail)throw new Error('Synthetic unavailable Toss');return {accountLabel:'QA account',accountScopeId:'0123456789abcdef01234567',fetchedAt:new Date().toISOString(),syncStatus:window.__partial?'partial':'complete',capabilities:{orders:true,holdings:true,prices:true,dividends:false},accountResults:[],holdings:[{symbol:'MSTY',market:'US',currency:'USD',quantity:'10',averagePurchasePrice:'10'}],prices:[{symbol:'MSTY',market:'US',currency:'USD',lastPrice:'8.4',timestamp:new Date().toISOString()}],orders:[],dividends:[],failedAccountCount:window.__partial?1:0,historyTruncated:false};}`;
function fixture(mode='auto'){
 const s=blankState(),p=s.projects[0],now=new Date(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 s.settings={...s.settings,displayCurrency:'USD',appearance:'dark',exchangeRateMode:mode,exchangeRate:1300,exchangeRateUpdatedAt:now.toISOString(),exchangeRateDate:date,targetMonthlyDividend:80,warningKRW:40000,thresholdKRW:60000};
 p.currentPrice=8.4;p.priceUpdatedAt=now.toISOString();
 s.trades=[{id:'buy',projectId:p.id,date:'2025-01-01',type:'buy',buyType:'direct',shares:10,price:10}];
 s.dividends=[{id:'receipt',projectId:p.id,date,amountUSD:40,rocAmountUSD:40}];return s;
}
async function read(page){return page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('stateFundingV1');});}
async function setup(page,{mode='auto',nativeAvailable=true}={}){
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloud}));
 if(nativeAvailable)await page.route('**/toss-native.js',r=>r.fulfill({contentType:'application/javascript',body:native}));
 const fx={calls:0,fail:false};await page.route('https://api.frankfurter.dev/v2/rate/USD/KRW',r=>{fx.calls++;return r.fulfill({status:fx.fail?503:200,contentType:'application/json',body:JSON.stringify({base:'USD',quote:'KRW',rate:1400,date:fixture().settings.exchangeRateDate})});});
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();await page.evaluate(async s=>{const {storageSet}=await import('/storage.js');await storageSet('stateFundingV1',s);},fixture(mode));await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();fx.calls=0;return fx;
}
async function openAlertSettings(page){
 await page.locator('[data-open-alerts]').click();
 await page.locator('[data-alert-settings]').click();
 await expect(page.locator('#alertSettingsForm [name="annual"]')).toBeVisible();
}
async function expectAnnualAlert(page,text){
 await page.locator('[data-open-alerts]').click();
 await expect(page.locator('#modal .alert-inbox')).toContainText(text);
 await page.locator('#modal [data-close-modal]').click();
}
async function refresh(page){await page.locator('[data-page="settings"]').first().click();await page.locator('#page-settings [data-sync-all]').click();await expect(page.locator('#page-settings [data-sync-all]')).toBeEnabled();}

for(const failure of ['none','toss','fx','partial'])test(`통합 갱신은 ${failure} 결과를 분리하고 장부와 환율을 함께 보존한다`,async({page})=>{
 const fx=await setup(page);await page.locator('[data-page="settings"]').first().click();fx.fail=failure==='fx';await page.evaluate(f=>{window.__tossFail=f==='toss';window.__partial=f==='partial';},failure);
 await page.locator('#page-settings [data-sync-all]').evaluate(el=>{el.click();el.click();});
 await expect(page.locator('#page-settings [data-sync-all]')).toBeEnabled();
 await expect(page.locator('#page-settings .refresh-panel')).toContainText(failure==='toss'?'토스 확인 실패':failure==='partial'?'토스 일부 성공':'토스 성공');
 await expect(page.locator('#page-settings .refresh-panel')).toContainText(failure==='fx'?'환율 실패 · 저장값 유지':'환율 성공');
 expect(await page.evaluate(()=>window.__tossCalls)).toBe(1);expect(fx.calls).toBe(1);
 const s=await read(page);
 if(failure!=='toss')expect(s.integrations.toss.lastImportSummary.projects).toEqual([]);
 expect(s.settings.exchangeRate).toBe(failure==='fx'?1300:1400);expect(s.integrations.toss.syncSequence||0).toBe(failure==='toss'?0:1);expect(s.trades).toHaveLength(1);expect(s.dividends).toHaveLength(1);
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await read(page)).settings.exchangeRate).toBe(s.settings.exchangeRate);
});
test('통합 갱신은 수동 환율을 유지하고 IP 등록 전 조회를 진행하지 않는다',async({page})=>{
 const fx=await setup(page,{mode:'manual'});await refresh(page);await expect(page.locator('#page-settings .refresh-panel')).toContainText('환율 수동값 유지');expect(fx.calls).toBe(0);expect((await read(page)).settings.exchangeRate).toBe(1300);
 await page.evaluate(()=>{window.__newIp='5.6.7.8';});await page.locator('#page-settings [data-sync-all]').click();await expect(page.locator('[data-confirm-toss-ip]')).toBeVisible();await expect(page.locator('#page-settings .refresh-panel')).toContainText('토스 IP 등록 필요');expect(await page.evaluate(()=>window.__tossCalls)).toBe(1);await page.locator('[data-confirm-toss-ip]').click();await expect(page.locator('#page-settings .refresh-panel')).toContainText('토스 성공');expect(await page.evaluate(()=>window.__tossCalls)).toBe(2);expect(fx.calls).toBe(0);
});
test('현재 주가 손실·배당 포함 이익과 실제 입금 목표를 모바일 화면에서 구분한다',async({page},info)=>{
 await setup(page,{mode:'manual'});await expect(page.locator('#page-home .monthly-dividend-goal')).toContainText('50.0%');await expect(page.locator('#page-home .dividend-alert')).toHaveCount(0);await expectAnnualAlert(page,'기준에 가까워졌어요');
 await page.locator('[data-page="projects"]').first().click();await expect(page.locator('#page-projects [data-sync-all]')).toHaveCount(0);await expect(page.locator('#page-home [data-sync-all]')).toHaveCount(0);await expect(page.locator('[data-refresh-exchange-rate]')).toHaveCount(0);await expect(page.locator('[data-sync-all]')).toHaveCount(1);await expect(page.locator('[data-current-pnl]')).toContainText('-$16');await expect(page.locator('.value-line')).toContainText('배당 포함 손익 +$24');await expect(page.locator('[data-current-pnl]')).not.toContainText('ROC 조정 전');await expect(page.locator('.performance-breakdown')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('1.2-compact-portfolio.png'),fullPage:true});
 await openAlertSettings(page);await expect(page.locator('#page-settings [data-sync-all]')).toBeVisible();await expect(page.locator('.refresh-info p')).toBeHidden();await page.locator('#alertSettingsForm [name="thresholdKRW"]').fill('50000');await page.locator('#alertSettingsForm button[type="submit"]').click();await expect.poll(async()=>(await read(page)).settings.thresholdKRW).toBe(50000);
 await page.locator('[data-page="home"]').first().click();await expectAnnualAlert(page,'기준 도달');
 await openAlertSettings(page);await page.locator('#alertSettingsForm [name="annual"]').uncheck();await page.locator('#alertSettingsForm button[type="submit"]').click();await expect.poll(async()=>(await read(page)).settings.dividendAlertEnabled).toBe(false);await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await expect(page.locator('#page-home .dividend-alert')).toHaveCount(0);await expectAnnualAlert(page,'확인할 알림이 없어요.');
});
test('토스 미연결 상태도 환율 갱신 결과와 연결 필요를 함께 표시한다',async({page})=>{
 const fx=await setup(page,{nativeAvailable:false});await page.locator('[data-page="settings"]').first().click();await page.locator('#page-settings [data-sync-all]').click();await expect(page.locator('#page-settings .refresh-panel')).toContainText('토스 조회 연결 필요 · 환율 성공');expect(fx.calls).toBe(1);expect((await read(page)).settings.exchangeRate).toBe(1400);
});

test('알림함 읽음 상태는 재시작 후 유지되고 연간 설정은 한 곳에만 있다',async({page})=>{
 await setup(page,{mode:'manual'});
 const bell=page.locator('[data-open-alerts]');
 await expect(bell).toHaveAccessibleName(/읽지 않은 알림 1개/);
 await bell.click();
 await page.locator('[data-read-all-alerts]').click();
 await expect(page.locator('#modal [data-alert-key]')).toHaveCount(1);
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();
 await expect(bell).toHaveAccessibleName('알림함 열기');
 await openAlertSettings(page);
 await expect(page.locator('[name="thresholdKRW"]')).toHaveCount(1);
 await expect(page.locator('#dividendSettingsForm [name="annual"]')).toHaveCount(0);
});

test('목표는 종목별 거래를 분리하고 백업은 복원 전에 현재 기록과 비교한다',async({page})=>{
 await setup(page,{mode:'manual'});
 await page.clock.setFixedTime(new Date('2026-11-09T03:00:00Z'));
 await page.evaluate(async()=>{
   const {storageGet,storageSet}=await import('/storage.js');
   const {blankProject}=await import('/modules/state.js');
   const data=await storageGet('stateFundingV1');
   const msty=data.projects[0],other=blankProject('SCHD','Schwab dividend');
   data.projects.push(other);
   msty.targetUnits=1000;
   other.targetUnits=100;
   const buy=(id,project,date,shares)=>({id,projectId:project.id,date,shares,type:'buy',buyType:'direct',price:10});
   data.trades=[buy('old',msty,'2026-07-01',237),buy('a',msty,'2026-08-10',8),buy('b',msty,'2026-10-10',22),buy('c',other,'2026-10-10',2)];
   await storageSet('stateFundingV1',data);
 });
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();
 await page.locator('[data-page="goal"]').click();
 const msty=page.locator('.goal-step-card').filter({hasText:'MSTY'}),schd=page.locator('.goal-step-card').filter({hasText:'SCHD'});
 await msty.locator(':scope > summary').click();
 await expect(msty).toContainText('2028년 11월 예상');
 await msty.locator('.goal-estimate-details summary').click();
 await expect(msty.locator('.goal-estimate-details li')).toHaveText(['8월 +8주','9월 0주','10월 +22주']);
 await schd.locator(':scope > summary').click();
 await expect(schd.locator('.goal-estimate-details summary')).toContainText('최근 1개월 · 월평균 2주');
 const earlier=await read(page);earlier.trades=earlier.trades.slice(0,3);
 const zip=createStoreZip([{name:'data/state.json',data:JSON.stringify(earlier)}]);
 await page.locator('#restoreInput').setInputFiles({name:'earlier.zip',mimeType:'application/zip',buffer:Buffer.from(await zip.arrayBuffer())});
 const comparison=page.getByRole('table',{name:'복원 전 비교'});
 await expect(comparison.getByRole('row').filter({hasText:'거래'}).first()).toContainText(/거래\s*4\s*3/);
 await page.locator('#modal [data-close-modal]').first().click();
 expect((await read(page)).trades).toHaveLength(4);
});
