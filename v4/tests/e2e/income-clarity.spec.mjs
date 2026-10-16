import {test,expect} from '@playwright/test';
import {demoState} from '../../modules/demo.js';
import {blankState,blankProject} from '../../modules/state.js';
const noAuth=`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){throw new Error('Synthetic review must not write cloud');}export async function subscribeCloudDocument(){return ()=>{};}`;
test.use({serviceWorkers:'block'});
for(const count of [0,1,6,9])for(const theme of ['light','dark'])test(`${count} synthetic holdings, ${theme}: income stays readable and navigation preserves records`,async({page},info)=>{
 await page.setViewportSize({width:theme==='dark'?320:412,height:915});
 await page.clock.setFixedTime(new Date('2026-10-16T10:00:00Z'));
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:noAuth}));
 await page.route('https://**/*',r=>r.abort());
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
 const state=count?demoState(new Date('2026-10-16T10:00:00Z')):blankState();
 if(count===1){state.projects=state.projects.slice(0,1);state.trades=state.trades.filter(r=>r.projectId===state.projects[0].id);state.dividends=state.dividends.filter(r=>r.projectId===state.projects[0].id);state.cashAdjustments=[];}
 if(count===9)for(let i=6;i<9;i++){const p=blankProject('QA'+i);p.id='qa-'+i;p.currentPrice=100;state.projects.push(p);state.trades.push({id:'qa-buy-'+i,projectId:p.id,date:'2020-01-01',type:'buy',buyType:'direct',shares:10000,price:100});state.dividends.push({id:'qa-div-'+i,projectId:p.id,date:'2026-10-10',amountUSD:1234567.89});}
 state.meta.demo=false;state.settings.appearance=theme;state.settings.exchangeRateMode='manual';
 await page.evaluate(async state=>{const {storageSet}=await import('/storage.js');await storageSet('stateFundingV1',state);},state);
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();if(count===9)await page.evaluate(()=>document.documentElement.style.fontSize='125%');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const read=()=>page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('stateFundingV1');});const before=await read();
 await expect(page.locator('.month-parts')).toHaveCount(0);await expect(page.locator('.monthly-dividend-goal')).toContainText('월 배당 목표');
 if(count===9){await expect(page.locator('.monthly-dividend-goal')).toContainText('월 배당 목표 달성');const amount=await page.locator('.hero-amount').evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight)}));expect(amount.height).toBeLessThan(amount.line*1.5);}
 await page.screenshot({path:info.outputPath(`home-${count}-${theme}.png`),fullPage:true});
 for(const tab of ['projects','goal','home']){await page.locator(`.nav-btn[data-page="${tab}"]`).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 if(count){await page.locator('#page-home [data-project-detail]').first().click();await expect(page.locator('.project-detail-heading')).toBeVisible();await page.locator('.nav-btn[data-page="home"]').click();await page.locator('[data-income-month]').first().click();await expect(page.locator('#modalBackdrop')).toHaveClass(/show/);await page.locator('[data-close-modal]').first().click();}
 await page.locator('[data-page="settings"]').first().click();await expect(page.locator('.settings-status')).not.toContainText('구버전');await expect(page.locator('#cloudConnectionSummary')).toHaveText('클라우드 로그인 안 됨');await page.locator('.settings-status>summary').click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath(`settings-${count}-${theme}.png`),fullPage:true});
 const after=await read();for(const key of ['projects','trades','dividends','cashAdjustments','splits'])expect(after[key]).toEqual(before[key]);expect(errors).toEqual([]);
});
