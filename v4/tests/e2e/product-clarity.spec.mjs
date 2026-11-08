import {test,expect} from '@playwright/test';
import {blankState} from '../../modules/state.js';
test.use({serviceWorkers:'block'});
const noAuth=`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
const read=page=>page.evaluate(async()=>{const{storageGet}=await import('/storage.js');return storageGet('stateFundingV1');});
async function setup(page,{empty=false}={}){
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:noAuth}));
 await page.clock.install({time:new Date('2026-11-07T03:00:00Z')});
 await page.route('https://**/*',r=>r.abort());await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
 const s=blankState();s.projects[0].id='p';s.projects[0].currentPrice=13.8494;s.projects[0].priceSource='toss';s.projects[0].priceUpdatedAt='2026-10-17T08:59:37+09:00';s.settings.displayCurrency='USD';s.settings.exchangeRateMode='manual';
 if(!empty){s.trades=[{id:'t',projectId:'p',symbol:'MSTY',date:'2026-10-01',type:'buy',buyType:'direct',shares:267,price:17.9,feeUSD:4.41}];s.dividends=[{id:'d',projectId:'p',date:'2026-11-06',amountUSD:35.1,note:'clarity QA'}];s.meta.lastLocalSaveAt='2026-11-07T02:00:00Z';}
 await page.evaluate(async s=>{const{storageSet}=await import('/storage.js');await storageSet('stateFundingV1',s);},s);await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();return read(page);
}
test('home keeps month history accessible after removing the duplicated receipt card',async({page})=>{
 const before=await setup(page);await expect(page.locator('.home-recent')).toHaveCount(0);await expect(page.locator('.hero-amount')).toHaveText('$35.10');
 await page.locator('.cashflow-card [data-income-month]').click();await expect(page.locator('.month-actual-summary strong')).toHaveText('$35.10');await page.locator('[data-view-record="dividend:d"]').click();await expect(page.locator('#modal')).toContainText('clarity QA');
 const after=await read(page);expect(after.trades).toEqual(before.trades);expect(after.dividends).toEqual(before.dividends);
});
test('quote, cost basis and dividend direction are clear without modifying the ledger',async({page})=>{
 const before=await setup(page);await page.locator('[data-page="projects"]').first().click();await expect(page.locator('.value-caption small')).toContainText('2026.10.17 08:59');await expect(page.locator('.portfolio-status-strip')).toContainText('배당 사용 방침: 재투자');
 await expect(page.locator('.valuation-guide')).toHaveCount(0);await page.locator('.project-symbol-link').click();await page.locator('.valuation-guide>summary').click();await expect(page.locator('.valuation-guide')).toContainText('아직 발생하지 않은 매도 비용은 빼지 않아요');
 await page.setViewportSize({width:320,height:915});await page.evaluate(()=>document.documentElement.style.fontSize='20px');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('[data-page="goal"]').first().click();await expect(page.locator('.goal-plan-note')).toContainText('재투자를 쉬거나');const after=await read(page);expect(after.trades).toEqual(before.trades);expect(after.dividends).toEqual(before.dividends);expect(after.projects).toEqual(before.projects);
});
test('empty state distinguishes a configured plan and cloud login from saved holdings',async({page})=>{
 await setup(page,{empty:true});await expect(page.locator('.monthly-dividend-goal')).toContainText('(설정값)');await page.locator('[data-page="projects"]').first().click();await expect(page.locator('.portfolio-status-strip')).toContainText('현재 보유 없음');await expect(page.locator('.portfolio-status-strip')).not.toContainText('재투자 중');
 await page.locator('[data-page="settings"]').first().click();await expect(page.locator('#localSaveSummary')).toHaveText('아직 저장한 기록 없음');await page.locator('.settings-status>summary').click();await expect(page.locator('.settings-status')).toContainText('기기 저장·클라우드·자동 사본은 각각 별도예요');
});

for(const theme of ['light','dark'])test(`outside plan and honest management status at enlarged 320px in ${theme}`,async({page})=>{
 const before=await setup(page);await page.evaluate(async theme=>{const {storageGet,storageSet}=await import('/storage.js');const s=await storageGet('stateFundingV1');s.projects[0].dividendPlan={...s.projects[0].dividendPlan,mode:'outside',history:[]};s.settings.appearance=theme;s.integrations.toss.status='partial';await storageSet('stateFundingV1',s);},theme);await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();
 const original=await read(page);await page.setViewportSize({width:320,height:915});await page.evaluate(()=>document.documentElement.style.fontSize='20px');await page.locator('[data-page="projects"]').first().click();await expect(page.locator('.portfolio-status-strip')).toContainText('배당 사용 방침: 외부 사용');await expect(page.locator('.valuation-guide')).toHaveCount(0);await page.locator('.project-symbol-link').click();await page.locator('.valuation-guide>summary').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('[data-page="goal"]').first().click();await expect(page.locator('.goal-step-card>summary')).toContainText('배당 외부 사용');await expect(page.locator('.goal-plan-note')).toBeVisible();
 await page.locator('[data-page="settings"]').first().click();await page.locator('.settings-status>summary').click();await expect(page.locator('.management-status')).toContainText('토스 조회 확인 필요');await expect(page.locator('.management-status')).toContainText('백업 파일 저장 권장');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);const after=await read(page);for(const k of ['projects','trades','dividends','cashAdjustments'])expect(after[k]).toEqual(original[k]);
});
