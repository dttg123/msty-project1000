import {test,expect} from '@playwright/test';
import {blankState} from '../../modules/state.js';
test.use({serviceWorkers:'block'});
const cloud=`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
function fixture(){const s=blankState(),p=s.projects[0];s.settings.displayCurrency='USD';p.targetUnits=1000;p.currentPrice=11;p.priceUpdatedAt=new Date().toISOString();s.trades=[{id:'first',projectId:p.id,date:'2025-01-01',type:'buy',buyType:'direct',shares:10,price:10}];s.dividends=[{id:'income',projectId:p.id,date:'2025-01-02',amountUSD:50}];return s;}
async function read(page){return page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('state');});}
async function setup(page){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloud}));
 await page.route(/\/storage\.js$/,r=>r.fulfill({contentType:'application/javascript',body:`export * from './storage.js?plan-original=1';import {storageSet as original} from './storage.js?plan-original=1';export async function storageSet(key,value){if(key==='state'&&window.__failPlan)throw new DOMException('Synthetic full disk','QuotaExceededError');return original(key,value);}`}));
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
 await page.evaluate(async s=>{const {storageSet}=await import('/storage.js');await storageSet('state',s);},fixture());
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').first().click();return errors;
}
async function useForm(page,amount='30',date='2025-01-04'){
 await page.locator('#page-projects [data-add-withdrawal]').click();await page.locator('#withdrawalForm [name="date"]').fill(date);await page.locator('#withdrawalForm [name="amountUSD"]').fill(amount);
}
async function manual(page,action){for(const name of ['record-center','manual-tools'])if(await page.locator('.'+name).getAttribute('open')===null)await page.locator('.'+name+' > summary').click();await page.locator(`[data-${action}]`).click();}


for(const action of ['edit','delete'])test(`사용 완료한 배당 ${action} 후에도 원장 잔액을 훼손하지 않아야 한다`,async({page},info)=>{
 test.setTimeout(90000);await setup(page);await useForm(page,'30');await page.locator('#withdrawalForm button[type="submit"]').click();await expect(page.locator('#withdrawalForm')).toBeHidden();
 if(await page.locator('.record-center').getAttribute('open')===null)await page.locator('.record-center > summary').click();await page.locator('.records-list [data-view-record="dividend:income"]').click();if(await page.locator('.record-manage > summary').count())await page.locator('.record-manage > summary').click();await page.locator('[data-edit-record="dividend:income"]').click();
 if(action==='edit'){await page.locator('#dividendForm [name="amountUSD"]').fill('10');await page.locator('#dividendForm button.primary').click();}else{await page.locator('[data-delete-from-edit]').click();await page.locator('#modalConfirm').click();}
 const evidence=await page.evaluate(async()=>{const {storageGet}=await import('/storage.js'),{createPortfolioEngine}=await import('/modules/portfolio.js'),{projectRecovery}=await import('/modules/dividend-plan.js');const s=await storageGet('state'),p=s.projects[0],c=createPortfolioEngine(()=>s,()=>p.id).computeProject(p);return {dividends:s.dividends,uses:s.cashAdjustments,minimum:c.minDividendBalance,deficits:c.cashDeficitEvents,recovery:projectRecovery(c)};});
 await info.attach('spent-dividend-mutation',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});console.log(action,JSON.stringify(evidence));expect(evidence.minimum).toBeGreaterThanOrEqual(0);expect(evidence.dividends).toHaveLength(1);expect(evidence.dividends[0].amountUSD).toBe(50);expect(evidence.uses[0].amountUSD).toBe(-30);
});

for(const mutation of ['date','currency','cash'])test(`고액 사용 후 ${mutation} 변경 차단·정상 수정 재시도·재시작은 원장을 보존한다`,async({page})=>{
 test.setTimeout(90000);await setup(page);await page.evaluate(async()=>{const {storageGet,storageSet}=await import('/storage.js');const s=await storageGet('state');s.dividends[0].amountUSD=50000;await storageSet('state',s);});await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').first().click();await useForm(page,'30000');await page.locator('#withdrawalForm button[type="submit"]').click();await expect(page.locator('#withdrawalForm')).toBeHidden();const before=await read(page);
 if(mutation==='cash'){
  await manual(page,'add-cash');await page.locator('#cashForm [name="date"]').fill('2025-01-05');await page.locator('#cashForm [name="amountUSD"]').fill('-30000');await page.locator('#cashForm button[type="submit"]').click();await expect(page.locator('.toast')).toContainText('부족');expect((await read(page)).cashAdjustments).toEqual(before.cashAdjustments);await page.locator('#cashForm [name="amountUSD"]').fill('10000');await page.locator('#cashForm button[type="submit"]').click();await expect(page.locator('#cashForm')).toBeHidden();
 }else{
  if(await page.locator('.record-center').getAttribute('open')===null)await page.locator('.record-center > summary').click();await page.locator('.records-list [data-view-record="dividend:income"]').click();if(await page.locator('.record-manage > summary').count())await page.locator('.record-manage > summary').click();await page.locator('[data-edit-record="dividend:income"]').click();
  if(mutation==='date')await page.locator('#dividendForm [name="date"]').fill('2025-01-05');else await page.locator('#dividendForm [name="currency"]').selectOption('KRW');await page.locator('#dividendForm button.primary').click();await expect(page.locator('.toast')).toContainText('부족');expect((await read(page)).dividends).toEqual(before.dividends);await page.waitForTimeout(850);await page.locator('#dividendForm [name="date"]').fill('2025-01-02');await page.locator('#dividendForm [name="currency"]').selectOption('USD');await page.locator('#dividendForm [name="amountUSD"]').fill('75000.01');await page.locator('#dividendForm button.primary').click();await expect(page.locator('#dividendForm')).toBeHidden();expect((await read(page)).dividends[0].amountUSD).toBe(75000.01);
 }
 const saved=await read(page);await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();const restored=await read(page);expect(restored.dividends).toEqual(saved.dividends);expect(restored.cashAdjustments).toEqual(saved.cashAdjustments);expect(restored.trades).toEqual(before.trades);
});
