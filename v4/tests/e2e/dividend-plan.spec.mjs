import {test,expect} from '@playwright/test';
import {blankState} from '../../modules/state.js';
import {tossCandidateToTrade} from '../../modules/toss.js';
import {readStateFromBackupFile} from '../../backup.js';
import {readFile} from 'node:fs/promises';
test.use({serviceWorkers:'block'});
const cloud=`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
function fixture(broker=false){const s=blankState(),p=s.projects[0];s.settings.displayCurrency='USD';p.targetUnits=1000;p.currentPrice=11;p.priceUpdatedAt=new Date().toISOString();s.trades=[{id:'first',projectId:p.id,date:'2025-01-01',type:'buy',buyType:'direct',shares:10,price:10}];s.dividends=[{id:'income',projectId:p.id,date:'2025-01-02',amountUSD:50}];if(broker)s.trades.push(tossCandidateToTrade({id:'broker',symbol:p.symbol,type:'buy',date:'2025-01-03',currency:'USD',shares:1,price:10},{projectId:p.id,id:'broker'}));return s;}
async function read(page){return page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('state');});}
async function setup(page,broker=false){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloud}));
 await page.route(/\/storage\.js$/,r=>r.fulfill({contentType:'application/javascript',body:`export * from './storage.js?plan-original=1';import {storageSet as original} from './storage.js?plan-original=1';export async function storageSet(key,value){if(key==='state'&&window.__failPlan)throw new DOMException('Synthetic full disk','QuotaExceededError');return original(key,value);}`}));
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
 await page.evaluate(async s=>{const {storageSet}=await import('/storage.js');await storageSet('state',s);},fixture(broker));
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').first().click();return errors;
}
async function useForm(page,amount='30',date='2025-01-04'){
 await page.locator('#page-projects [data-add-withdrawal]').click();await page.locator('#withdrawalForm [name="date"]').fill(date);await page.locator('#withdrawalForm [name="amountUSD"]').fill(amount);
}
async function details(page){const d=page.locator('#page-projects .dividend-use-details');if(await d.getAttribute('open')===null)await d.locator(':scope > summary').click();return d;}
async function manual(page,action){for(const name of ['record-center','manual-tools'])if(await page.locator('.'+name).getAttribute('open')===null)await page.locator('.'+name+' > summary').click();await page.locator(`[data-${action}]`).click();}

test('플러스 전환 → ISA 사용 → 마이너스 재개 → 목표 달성은 과거 사용액을 유지한다',async({page})=>{
 test.setTimeout(90000);const errors=await setup(page),before=await read(page);
 await expect(page.locator('#page-projects .dividend-plan-notice')).toContainText('플러스');await page.locator('#page-projects .dividend-plan-notice [data-dividend-mode]').click();await page.locator('#modalConfirm').click();await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
 await useForm(page);await page.locator('#withdrawalForm [name="destination"]').selectOption('isa');await page.locator('#withdrawalForm button[type="submit"]').click();await expect(page.locator('#withdrawalForm')).toBeHidden();
 const d=await details(page);await expect(d).toContainText('$20');expect((await read(page)).trades).toEqual(before.trades);
 await manual(page,'edit-price');await page.locator('#priceForm [name="price"]').fill('9');await page.locator('#priceForm button[type="submit"]').click();await expect(page.locator('#priceForm')).toBeHidden();
 await expect(page.locator('#page-projects .dividend-plan-notice')).toContainText('마이너스');await page.locator('#page-projects .dividend-plan-notice [data-dividend-mode]').click();await page.locator('#modalConfirm').click();
 expect((await read(page)).cashAdjustments[0].amountUSD).toBe(-30);expect((await read(page)).projects[0].dividendPlan.history).toHaveLength(2);
 await manual(page,'add-trade');await page.locator('#tradeForm [name="date"]').fill('2025-01-05');await page.locator('#tradeForm [name="shares"]').fill('990');await page.locator('#tradeForm [name="price"]').fill('10');await page.locator('#tradeForm button[type="submit"]').click();await expect(page.locator('#tradeForm')).toBeHidden();
 await expect(page.locator('.dividend-management .recovery-hero')).toContainText('남은 회수 원금');await expect(page.locator('.dividend-management .recovery-hero')).toContainText('$9,970');
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await read(page)).cashAdjustments[0].amountUSD).toBe(-30);expect((await read(page)).projects[0].dividendPlan.mode).toBe('reinvest');expect(errors).toEqual([]);
});

test('잔액 초과와 입금 전 과거 사용은 저장되지 않는다',async({page})=>{
 const errors=await setup(page);await useForm(page,'60');expect(await page.locator('#withdrawalForm').evaluate(f=>f.checkValidity())).toBe(false);expect((await read(page)).cashAdjustments).toHaveLength(0);
 await page.locator('#withdrawalForm [name="amountUSD"]').fill('30');await page.locator('#withdrawalForm [name="date"]').fill('2024-12-01');await page.locator('#withdrawalForm button[type="submit"]').click();await expect(page.locator('.toast')).toContainText('이 날짜');expect((await read(page)).cashAdjustments).toHaveLength(0);expect(errors).toEqual([]);
});

test('토스 매수 자금 출처 확인은 원본을 유지하고 재투자 잔액만 줄인다',async({page})=>{
 const errors=await setup(page,true),before=await read(page);await details(page);await page.locator('#page-projects [data-review-funding]').click();await page.locator('[data-funding-trade="broker"]').click();await page.locator('#fundingForm [name="amountUSD"]').fill('10');await page.locator('#fundingForm button[type="submit"]').click();await expect(page.locator('#fundingForm')).toBeHidden();const after=await read(page);expect(after.trades[1].source).toEqual(before.trades[1].source);expect(after.trades[1].shares).toBe(1);expect(after.trades[1].price).toBe(10);expect(after.trades[1].dividendFunding.amountUSD).toBe(10);await expect(page.locator('#page-projects .dividend-use-details')).toContainText('$40');await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await read(page)).trades[1].dividendFunding.amountUSD).toBe(10);expect(errors).toEqual([]);
});

for(const action of ['use','funding','mode'])test(`${action} 저장 실패 후 재시도는 한 번만 반영한다`,async({page})=>{
 const errors=await setup(page,action==='funding'),before=await read(page);
 if(action==='use')await useForm(page);
 if(action==='funding'){await details(page);await page.locator('#page-projects [data-review-funding]').click();await page.locator('[data-funding-trade="broker"]').click();await page.locator('#fundingForm [name="amountUSD"]').fill('10');}
 if(action==='mode'){await page.locator('#page-projects .dividend-plan-notice [data-dividend-mode]').click();}
 await page.evaluate(()=>window.__failPlan=true);
 const submit=action==='mode'?page.locator('#modalConfirm'):page.locator(`#${action==='use'?'withdrawal':'funding'}Form button[type="submit"]`);
 await submit.click();await expect(page.locator('.toast')).toContainText('기기 저장에 실패');const failed=await read(page);expect(failed.trades).toEqual(before.trades);expect(failed.cashAdjustments).toEqual(before.cashAdjustments);expect(failed.projects).toEqual(before.projects);
 await page.evaluate(()=>window.__failPlan=false);await submit.click();await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);const after=await read(page);if(action==='use')expect(after.cashAdjustments).toHaveLength(1);if(action==='funding')expect(after.trades[1].dividendFunding.amountUSD).toBe(10);if(action==='mode')expect(after.projects[0].dividendPlan.history).toHaveLength(1);expect(errors).toEqual([]);
});

test('실제 ZIP 다운로드와 복원이 방향·사용처·토스 자금 출처를 보존한다',async({page})=>{
 test.setTimeout(90000);const errors=await setup(page,true);
 await details(page);await page.locator('#page-projects [data-review-funding]').click();await page.locator('[data-funding-trade="broker"]').click();await page.locator('#fundingForm [name="amountUSD"]').fill('10');await page.locator('#fundingForm button[type="submit"]').click();await expect(page.locator('#fundingForm')).toBeHidden();
 await useForm(page,'20');await page.locator('#withdrawalForm [name="destination"]').selectOption('otherDividend');await page.locator('#withdrawalForm [name="note"]').fill('SCHD 실제 매수에 사용');await page.locator('#withdrawalForm button[type="submit"]').click();await expect(page.locator('#withdrawalForm')).toBeHidden();
 await page.locator('#page-projects [data-dividend-mode]').last().click();await page.locator('#modalConfirm').click();await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);const original=await read(page);
 await page.locator('[data-page="settings"]').first().click();const section=page.locator('.settings-section').filter({has:page.locator('[data-backup]')});await section.locator(':scope > summary').click();await page.locator('[data-backup]').click();await expect(page.locator('[data-backup-download]')).toBeVisible();
 const downloadEvent=page.waitForEvent('download');await page.locator('[data-backup-download]').click();const download=await downloadEvent;const bytes=await readFile(await download.path());
 const file=Object.assign(new Blob([bytes]),{name:'restored-plan.zip'}),backup=await readStateFromBackupFile(file);expect(backup.projects[0].dividendPlan).toEqual(original.projects[0].dividendPlan);expect(backup.cashAdjustments).toEqual(original.cashAdjustments);expect(backup.trades).toEqual(original.trades);
 await page.locator('[data-close-modal]').click();await page.evaluate(async()=>{const {storageGet,storageSet}=await import('/storage.js');const s=await storageGet('state');s.cashAdjustments=[];delete s.projects[0].dividendPlan;delete s.trades[1].dividendFunding;await storageSet('state',s);});await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();
 await page.locator('#restoreInput').setInputFiles({name:'restored-plan.zip',mimeType:'application/zip',buffer:bytes});await expect(page.locator('#confirmRestore')).toBeVisible();await page.locator('#confirmRestore').click();await expect(page.locator('#confirmRestore')).toBeHidden();const restored=await read(page);expect(restored.projects[0].dividendPlan).toEqual(original.projects[0].dividendPlan);expect(restored.cashAdjustments).toEqual(original.cashAdjustments);expect(restored.trades).toEqual(original.trades);expect(errors).toEqual([]);
});
