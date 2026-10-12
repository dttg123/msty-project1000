import {test,expect} from '@playwright/test';
import {blankState,blankProject} from '../../modules/state.js';
import {openPortfolioDetail} from './portfolio-navigation.mjs';
test.use({serviceWorkers:'block'});
const noAuth=`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
async function ledger(page){return page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('state');});}
async function setup(page){
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:noAuth}));
 await page.clock.setFixedTime(new Date('2026-10-11T09:00:00Z'));
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
 const s=blankState();s.settings.appearance='light';s.settings.displayCurrency='KRW';s.projects[0].id='msty';s.projects[0].targetUnits=1000;s.projects[0].currentPrice=18;s.projects[0].priceUpdatedAt='2026-10-11T09:00:00Z';
 const growth=blankProject('SCHD');growth.id='schd';growth.category='growth';growth.currentPrice=28;s.projects.push(growth);
 s.trades=[{id:'buy',projectId:'msty',date:'2026-10-03',type:'buy',buyType:'direct',shares:250,price:20},{id:'schd-buy',projectId:'schd',date:'2026-10-03',type:'buy',buyType:'direct',shares:10,price:25}];
 s.dividends=[{id:'d1',projectId:'msty',date:'2026-10-09',amountUSD:40},{id:'d2',projectId:'schd',date:'2026-10-08',amountUSD:5}];
 await page.evaluate(async s=>{const {storageSet}=await import('/storage.js');await storageSet('state',s);},s);await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();return ledger(page);
}
test('home links select the right category; four tabs and records preserve the ledger',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const before=await setup(page);
 await page.screenshot({path:info.outputPath('app-review-home.png'),fullPage:true});
 await page.locator('#page-home [data-project-detail="schd"]').click();
 await expect(page.locator('#page-projects')).toBeVisible();await expect(page.locator('.project-detail-heading')).toContainText('SCHD');
 await expect(page.locator('[data-project-detail-tab="summary"]')).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#detail-panel-summary .portfolio-summary')).toBeVisible();
 await openPortfolioDetail(page,'dividend');await expect(page.locator('#detail-panel-summary')).toBeHidden();
 await expect(page.locator('#detail-panel-dividend .portfolio-summary')).toHaveCount(0);
 await openPortfolioDetail(page,'records');await expect(page.locator('.records-list')).toBeVisible();
 await expect(page.locator('.record-center > summary')).toHaveCount(0);
 await expect(page.locator('.records-list')).toContainText('세후배당');
 await page.locator('[data-project-detail-tab="records"]').press('ArrowRight');
 await expect(page.locator('[data-project-detail-tab="summary"]')).toHaveAttribute('aria-selected','true');
 await page.locator('.nav-btn[data-page="home"]').click();await page.locator('#page-home [data-project-detail="msty"]').click();
 await page.screenshot({path:info.outputPath('app-review-summary.png'),fullPage:true});
 await openPortfolioDetail(page,'dividend');await page.screenshot({path:info.outputPath('app-review-dividend.png'),fullPage:true});
 await openPortfolioDetail(page,'recovery');await page.screenshot({path:info.outputPath('app-review-recovery.png'),fullPage:true});
 await openPortfolioDetail(page,'records');await page.screenshot({path:info.outputPath('app-review-records.png'),fullPage:true});
 await page.locator('[data-record-add]').click();await expect(page.locator('#modalBackdrop')).toBeVisible();
 await page.locator('#modal [data-add-dividend]').click();await expect(page.locator('#dividendForm')).toBeVisible();await page.locator('[data-close-modal]').first().click();
 await page.locator('.nav-btn[data-page="goal"]').click();await page.locator('.goal-step-card').first().locator(':scope > summary').click();
 await expect(page.locator('.goal-milestones').first()).toContainText('2026.10.03');
 await page.screenshot({path:info.outputPath('app-review-goals.png'),fullPage:true});
 await page.locator('[data-page="settings"]').click();await page.screenshot({path:info.outputPath('app-review-settings.png'),fullPage:true});
 const after=await ledger(page);for(const key of ['trades','dividends','cashAdjustments','splits','projects'])expect(after[key]).toEqual(before[key]);expect(errors).toEqual([]);
});
