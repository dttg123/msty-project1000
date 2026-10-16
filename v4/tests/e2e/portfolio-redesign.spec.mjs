import {test,expect} from '@playwright/test';
import {blankState,blankProject} from '../../modules/state.js';
import {openPortfolioDetail} from './portfolio-navigation.mjs';
test.use({serviceWorkers:'block'});
const noAuth=`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
async function read(page){return page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('stateFundingV1');});}
async function setup(page,{appearance='dark',many=false,empty=false,date='2026-10-11T09:00:00Z'}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:noAuth}));await page.clock.setFixedTime(new Date(date));
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();const fixtureDay=await page.evaluate(()=>new Date().toLocaleDateString('sv-SE'));const s=blankState();s.settings={...s.settings,appearance,displayCurrency:'USD'};const p=s.projects[0];p.id='p-msty';p.projectStart=fixtureDay;p.currentPrice=15.8;p.priceUpdatedAt=date;p.colorIndex=2;p.targetUnits=1000;
 if(!empty){s.trades=[{id:'buy',projectId:p.id,date:'2025-01-01',type:'buy',buyType:'direct',shares:255,price:18}];s.dividends=Array.from({length:8},(_,i)=>({id:'d'+i,projectId:p.id,date:`2026-${String(i+3).padStart(2,'0')}-01`,amountUSD:50+i*10}));}
 if(many)for(let i=0;i<6;i++){const x=blankProject('QASTOCK'+i);x.id='stock'+i;x.projectStart=fixtureDay;x.category=i<4?'highYield':'growth';x.colorIndex=i;s.projects.push(x);}
 await page.evaluate(async s=>{const {storageSet}=await import('/storage.js');await storageSet('stateFundingV1',s);},s);await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').first().click();return {errors,state:s};
}
for(const appearance of ['dark','light'])test(`1.4 ${appearance}: short overview, detail tabs and original ledger`,async({page},info)=>{
 const {errors}=await setup(page,{appearance}),before=await read(page);await expect(page.locator('.portfolio-overview')).toBeVisible();await expect(page.locator('#page-projects .card')).toHaveCount(2);await expect(page.locator('.summary-month-chart button')).toHaveCount(6);await expect(page.locator('.dividend-management,.record-center,[data-refresh-official-distributions]')).toHaveCount(0);
 await expect(page.locator('[data-current-pnl]')).toContainText('-$561.00');await expect(page.locator('.portfolio-status-strip')).toContainText('다음 목표 500주');
 const actual=await page.locator('.portfolio-income-hero').textContent();expect(actual).toContain('$120.00');
 const tint=await page.locator('.summary-bar-track i').last().evaluate(el=>getComputedStyle(el).backgroundImage);expect(tint).toBe('none');
 if(info.project.name==='mobile-chromium')expect(await page.locator('.portfolio-overview').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(680);
 await page.screenshot({path:info.outputPath(`1.4-${appearance}-overview.png`),fullPage:true});
 await page.locator('.project-symbol-link').click();await expect(page.locator('[data-project-detail-tab="summary"]')).toHaveAttribute('aria-selected','true');await expect(page.locator('#detail-panel-summary')).toBeVisible();await expect(page.locator('#detail-panel-dividend')).toBeHidden();await openPortfolioDetail(page,'dividend');await expect(page.locator('#detail-panel-recovery')).toBeHidden();
 await openPortfolioDetail(page,'recovery');await expect(page.locator('#page-projects .dividend-management')).toBeVisible();await expect(page.locator('#detail-panel-dividend')).toBeHidden();await page.screenshot({path:info.outputPath(`1.2-${appearance}-recovery.png`),fullPage:true});
 await openPortfolioDetail(page,'records');await expect(page.locator('.records-list')).toBeVisible();await expect(page.locator('.records-list')).toBeVisible();await page.locator('[data-project-detail-tab="records"]').press('ArrowLeft');await expect(page.locator('[data-project-detail-tab="recovery"]')).toHaveAttribute('aria-selected','true');
 await page.locator('[data-portfolio-overview]').click();await expect(page.locator('.portfolio-overview')).toBeVisible();await page.locator('#page-projects [data-project-detail]').last().click();await page.goBack();await expect(page.locator('.portfolio-overview')).toBeVisible();
 const after=await read(page);expect(after.trades).toEqual(before.trades);expect(after.dividends).toEqual(before.dividends);expect(after.projects).toEqual(before.projects);await page.locator('[data-page="settings"]').first().click();await expect(page.locator('.app-version')).toHaveText('DividendOS 1.8');expect(errors).toEqual([]);
});
test('7 stocks: changing group and stock selects only that stock, no horizontal overflow',async({page})=>{
 const {errors}=await setup(page,{many:true});await expect(page.locator('[data-project-select]')).toBeVisible();await page.locator('[data-project-select]').selectOption('stock2');await expect(page.locator('.project-symbol')).toContainText('QASTOCK2');await openPortfolioDetail(page,'records');await page.locator('[data-page="projects"]').first().click();await expect(page.locator('.portfolio-overview')).toBeVisible();await page.locator('[data-portfolio-group="dividend"]').click();await page.locator('[data-select-project="stock5"]').click();await expect(page.locator('.project-symbol')).toContainText('QASTOCK5');
 for(const width of [320,360,412,600,1440]){await page.setViewportSize({width,height:915});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}expect(errors).toEqual([]);
});
test('new year overview has six dated real months, zero balance works',async({page})=>{
 await setup(page,{empty:true,date:'2027-01-11T09:00:00Z'});await expect(page.locator('.summary-month-chart button')).toHaveCount(6);await expect(page.locator('.summary-month-chart button').first()).toHaveAttribute('data-income-month','2026-08');await expect(page.locator('.summary-month-chart button').last()).toHaveAttribute('data-income-month','2027-01');await expect(page.locator('.portfolio-income-hero')).toContainText('$0.00');await page.locator('.summary-month-chart button').last().click();await page.locator('.summary-income-records').click();await expect(page.locator('.month-navigation strong')).toHaveText('2027년 01월');
});

test('saved theme and stock colors survive edit, reload and summary/detail navigation',async({page})=>{
 await setup(page);await page.locator('[data-project-settings]').click();await page.locator('#projectForm .form-advanced > summary').click();await expect(page.locator('#projectForm [name="projectStart"]')).toHaveValue('2026-10-11');await page.locator('#projectForm .color-picker label').filter({has:page.locator('input[value="4"]')}).click();await page.locator('#projectForm button[type="submit"]').click();await expect(page.locator('#projectForm')).toBeHidden();const before=await read(page);expect(before.projects[0].colorIndex).toBe(4);const color=await page.locator('.portfolio-overview').evaluate(el=>getComputedStyle(el).getPropertyValue('--project-a'));
 await page.locator('[data-page="settings"]').first().click();await page.locator('details.settings-section').filter({has:page.locator('#displaySettingsForm')}).locator(':scope > summary').click();await page.locator('#displaySettingsForm [name="appearance"]').selectOption('light');await page.locator('#displaySettingsForm button[type="submit"]').click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').first().click();expect(await page.locator('.portfolio-overview').evaluate(el=>getComputedStyle(el).getPropertyValue('--project-a'))).toBe(color);expect(await page.locator('.portfolio-summary').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('20px');await openPortfolioDetail(page);expect((await read(page)).projects[0].colorIndex).toBe(4);expect((await read(page)).settings.appearance).toBe('light');
});

for(const appearance of ['dark','light'])test(`1.4 typography ${appearance}: local font, readable captions and enlarged text`,async({page},info)=>{
 await setup(page,{appearance});await page.evaluate(()=>document.fonts.load('650 15px "Dividend Sans"','배당 123'));
 expect(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='Dividend Sans'&&f.status==='loaded'))).toBe(true);
 for(const selector of ['.portfolio-summary .current-pnl>span','.portfolio-summary .holding-row span','.portfolio-income-hero span']){
  expect(await page.locator(selector).first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
 }
 const contrast=await page.locator('.portfolio-summary').evaluate(el=>{
  const css=getComputedStyle(el),root=getComputedStyle(document.documentElement);
  const luminance=color=>{const c=color.startsWith('#')?[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)):color.match(/[\d.]+/g).slice(0,3).map(Number);const v=c.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
  const bg=luminance(document.documentElement.dataset.theme==='dark'?'#1d2536':'#ffffff');
  return ['--muted','--green','--red'].map(token=>{const fg=luminance(root.getPropertyValue(token).trim());return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);});
 });for(const ratio of contrast)expect(ratio).toBeGreaterThanOrEqual(4.5);
 await page.screenshot({path:info.outputPath(`1.4-${appearance}-type.png`),fullPage:true});
 await page.setViewportSize({width:320,height:915});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(page.locator('.project-symbol-link')).toBeVisible();await page.locator('.project-symbol-link').click();await expect(page.locator('[data-project-detail-tab="records"]')).toBeVisible();await page.locator('[data-page="settings"]').first().click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('selected month shows its own amount above the chart and opens only its records',async({page})=>{
 await setup(page);const before=await read(page);await page.locator('[data-portfolio-income-month="2026-05"]').click();
 await expect(page.locator('.portfolio-month-summary h3')).toHaveText('2026년 05월 받은 배당');await expect(page.locator('.portfolio-income-hero strong')).toHaveText('$70.00');
 await expect(page.locator('[data-portfolio-income-month="2026-05"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#modalBackdrop')).toBeHidden();
 await page.locator('.summary-income-records').click();await expect(page.locator('.month-navigation strong')).toHaveText('2026년 05월');
 await page.locator('[data-close-modal]').first().click();await page.locator('.project-symbol-link').click();await page.locator('[data-portfolio-overview]').click();await expect(page.locator('.portfolio-income-hero strong')).toHaveText('$70.00');
 const after=await read(page);expect(after.trades).toEqual(before.trades);expect(after.dividends).toEqual(before.dividends);
});
