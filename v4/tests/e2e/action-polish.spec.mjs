import {test,expect} from '@playwright/test';
import {openPortfolioDetail,openRecordAction} from './portfolio-navigation.mjs';
test.use({serviceWorkers:'block'});
const cloud=`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
async function setup(page){
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloud}));
 await page.route(/\/storage\.js$/,r=>r.fulfill({contentType:'application/javascript',body:`export * from './storage.js?polish-original=1';import {storageSet as original} from './storage.js?polish-original=1';export async function storageSet(key,value){if(key==='stateFundingV1'&&window.__failMutation)throw new DOMException('Synthetic full disk','QuotaExceededError');return original(key,value);}`}));
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
}
async function ledger(page){return page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('stateFundingV1');});}
test('dialog cycles focus in both directions and returns to its opener without changing records',async({page})=>{
 await setup(page);await page.locator('.nav-btn[data-page="projects"]').click();await openPortfolioDetail(page,'records');
 const before=await ledger(page),opener=page.locator('[data-record-add]');await opener.click();
 const dialog=page.getByRole('dialog');await expect(dialog).toHaveAccessibleName(/기록/);
 const close=page.locator('#modal .modal-close');await expect(close).toBeFocused();
 await close.press('Shift+Tab');await expect(close).not.toBeFocused();
 expect(await page.evaluate(()=>!!document.activeElement?.closest('#modal'))).toBe(true);
 await page.keyboard.press('Tab');await expect(close).toBeFocused();
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(opener).toBeFocused();
 expect((await ledger(page)).trades).toEqual(before.trades);expect((await ledger(page)).dividends).toEqual(before.dividends);
});
for(const [width,theme,fontSize] of [[320,'light','100%'],[412,'dark','125%']])test(`full save-failure instructions remain readable at ${width}px ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:915});await setup(page);
 await page.evaluate(({theme,fontSize})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=fontSize;},{theme,fontSize});
 await page.locator('.nav-btn[data-page="projects"]').click();await openPortfolioDetail(page,'dividend');
 const before=await ledger(page);await openRecordAction(page,'edit-price');await page.locator('#priceForm [name="price"]').fill('123');
 await page.evaluate(()=>window.__failMutation=true);await page.locator('#priceForm button[type="submit"]').click();
 const toast=page.locator('#toast');await expect(toast).toContainText('다시 시도해 주세요.');await expect(toast).toHaveAttribute('role','status');
 const bounds=await toast.evaluate(el=>{const r=el.getBoundingClientRect(),style=getComputedStyle(el);return {left:r.left,right:r.right,bottom:r.bottom,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,height:r.height,whiteSpace:style.whiteSpace};});
 expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(width);expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth+1);expect(bounds.height).toBeGreaterThan(45);expect(bounds.whiteSpace).toBe('normal');
 expect((await ledger(page)).projects).toEqual(before.projects);
 await page.screenshot({path:info.outputPath(`save-failure-${width}-${theme}.png`),fullPage:true});
});
test('currency and navigation controls show their state without shifting or altering records',async({page},info)=>{
 await setup(page);await expect(page.locator('.nav-btn[aria-current="page"]')).toHaveAttribute('data-page','home');
 for(const currency of ['usdBtn','krwBtn']){const box=await page.locator('#'+currency).boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(36);}
 const before=await ledger(page);await page.locator('#usdBtn').click();await expect(page.getByRole('button',{name:'달러로 표시'})).toHaveAttribute('aria-pressed','true');
 await page.locator('.nav-btn[data-page="goal"]').click();await expect(page.locator('.nav-btn[aria-current="page"]')).toHaveAttribute('data-page','goal');
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.nav-btn[data-page="home"]').click();
 expect(await page.locator('#page-home').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 expect((await ledger(page)).trades).toEqual(before.trades);expect((await ledger(page)).dividends).toEqual(before.dividends);
 await page.screenshot({path:info.outputPath('home-actions.png'),fullPage:true});
});
test('nine projects and thirty years of high dividends stay navigable in a narrow enlarged dark view',async({page},info)=>{
 test.setTimeout(90_000);await page.setViewportSize({width:320,height:915});await page.clock.setFixedTime(new Date('2027-01-02T00:00:00Z'));await setup(page);
 const {blankState,blankProject}=await import('../../modules/state.js');const state=blankState();state.settings.appearance='dark';state.settings.displayCurrency='KRW';state.projects=[];state.trades=[];state.dividends=[];
 for(let i=0;i<9;i++){const project=blankProject('QA'+i);project.id='long-'+i;project.category='highYield';project.currentPrice=12345.67;project.colorIndex=i;state.projects.push(project);state.trades.push({id:'buy-'+i,projectId:project.id,date:'1997-01-01',type:'buy',buyType:'direct',shares:10000,price:100});for(let y=1997;y<=2026;y++)for(let m=1;m<=12;m++)state.dividends.push({id:`d-${i}-${y}-${m}`,projectId:project.id,date:`${y}-${String(m).padStart(2,'0')}-15`,amountUSD:1234567.89});}
 await page.evaluate(async state=>{const {storageSet}=await import('/storage.js');await storageSet('stateFundingV1',state);},state);await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.evaluate(()=>document.documentElement.style.fontSize='125%');
 for(const name of ['home','projects','goal']){await page.locator(`.nav-btn[data-page="${name}"]`).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await expect(page.locator(`.nav-btn[data-page="${name}"]`)).toHaveAttribute('aria-current','page');}
 await page.locator('.nav-btn[data-page="projects"]').click();await openPortfolioDetail(page,'records');await expect(page.locator('.records-list [data-view-record]')).toHaveCount(10);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('30-year-nine-projects-dark-records.png'),fullPage:true});const after=await ledger(page);expect(after.projects).toHaveLength(9);expect(after.dividends).toEqual(state.dividends);expect(after.trades).toEqual(state.trades);
});
