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
 await expect(page.locator('.home-cashflow-details')).not.toHaveAttribute('open','');
 await expect(page.locator('.cashflow-year-summary')).toBeHidden();
 await page.locator('.home-cashflow-details > summary').click();await expect(page.locator('.cashflow-year-summary')).toBeVisible();await page.locator('.home-cashflow-details > summary').click();
 await page.screenshot({path:info.outputPath('app-review-home.png'),fullPage:true});
 await page.locator('#page-home [data-project-detail="schd"]').click();
 await expect(page.locator('#page-projects')).toBeVisible();await expect(page.locator('.brand-wrap')).toBeHidden();await expect(page.locator('.project-detail-heading')).toContainText('SCHD');
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
 await openPortfolioDetail(page,'records');await expect(page.locator('.history-search')).not.toHaveAttribute('open','');
 await page.locator('#historyFilterForm [name="kind"]').selectOption('dividend');await expect(page.locator('.records-list [data-view-record]')).toHaveCount(1);
 await page.locator('#historyFilterForm [name="kind"]').selectOption('trade');await expect(page.locator('.records-list')).toContainText('직접매수');
 await page.locator('[data-history-reset]').click();await expect(page.locator('.records-list [data-view-record]')).toHaveCount(2);
 await page.locator('.history-search > summary').click();await page.locator('#historyFilterForm [name="query"]').fill('2026-10-09');await page.locator('#historyFilterForm button[type="submit"]').click();await expect(page.locator('.records-list [data-view-record]')).toHaveCount(1);await page.locator('[data-history-reset]').click();
 await page.screenshot({path:info.outputPath('app-review-records.png'),fullPage:true});
 await page.locator('[data-record-add]').click();await expect(page.locator('#modalBackdrop')).toBeVisible();
 await page.locator('#modal [data-add-dividend]').click();await expect(page.locator('#dividendForm')).toBeVisible();await page.locator('[data-close-modal]').first().click();
 await page.locator('.nav-btn[data-page="goal"]').click();await page.locator('.goal-step-card').first().locator(':scope > summary').click();
 await expect(page.locator('.goal-milestones').first()).toContainText('2026.10.03');
 await page.screenshot({path:info.outputPath('app-review-goals.png'),fullPage:true});
 await page.locator('[data-page="settings"]').click();await page.screenshot({path:info.outputPath('app-review-settings.png'),fullPage:true});
 const after=await ledger(page);for(const key of ['trades','dividends','cashAdjustments','splits','projects'])expect(after[key]).toEqual(before[key]);expect(errors).toEqual([]);
});

test('chart selection preserves the page, expanded analysis and navigation clearance',async({page},info)=>{
 await setup(page);
 await page.evaluate(async()=>{const {storageGet,storageSet}=await import('/storage.js');const s=await storageGet('state');s.dividends.push({id:'sep',projectId:'msty',date:'2026-09-09',amountUSD:30},{id:'aug',projectId:'msty',date:'2026-08-09',amountUSD:20});await storageSet('state',s);});
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();
 const card=page.locator('.cashflow-card'),details=page.locator('.home-cashflow-details');
 await card.scrollIntoViewIfNeeded();await details.locator(':scope > summary').click();
 await page.evaluate(()=>{window.__chartRoot=document.querySelector('.cashflow-chart');window.__homeRow=document.querySelector('.home-stocks .list-row');window.__sepBar=document.querySelector('[data-cashflow-period="2026-09"]');});
 for(const month of ['2026-09','2026-08','2026-10','2026-09']){
  const button=page.locator(`[data-cashflow-period="${month}"]`);await button.scrollIntoViewIfNeeded();
  const top=await page.evaluate(()=>window.scrollY);await button.click();
  await expect(details).toHaveAttribute('open','');await expect(button).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.cashflow-picked')).toContainText(`${+month.slice(5)}월`);
  expect(await page.evaluate(()=>Math.abs(window.scrollY))).toBeGreaterThan(0);
  expect(Math.abs(await page.evaluate(()=>window.scrollY)-top)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(()=>window.__chartRoot===document.querySelector('.cashflow-chart')&&window.__homeRow===document.querySelector('.home-stocks .list-row')&&window.__sepBar===document.querySelector('[data-cashflow-period="2026-09"]'))).toBe(true);
 }
 await page.locator('#usdBtn').click();await expect(details).toHaveAttribute('open','');await expect(page.locator('.cashflow-picked strong')).toContainText('$');
 await page.locator('[data-home-cashflow-mode="year"]').scrollIntoViewIfNeeded();const yearTop=await page.evaluate(()=>window.scrollY);await page.locator('[data-home-cashflow-mode="year"]').click();
 await expect(details).toHaveAttribute('open','');await page.waitForTimeout(100);expect(Math.abs(await page.evaluate(()=>window.scrollY)-yearTop)).toBeLessThanOrEqual(2);
 await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
 const goal=await page.locator('.next-card').boundingBox(),nav=await page.locator('.bottom-nav').boundingBox();expect(goal.y+goal.height).toBeLessThanOrEqual(nav.y-12);
 expect(await page.locator('.home-stocks .list-row').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.screenshot({path:info.outputPath('stable-home-analysis.png'),fullPage:true});
});
