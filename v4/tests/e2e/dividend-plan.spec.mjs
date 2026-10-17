import {openPortfolioDetail,openRecordAction} from './portfolio-navigation.mjs';
import {test,expect} from '@playwright/test';
import {blankState} from '../../modules/state.js';
import {tossCandidateToTrade} from '../../modules/toss.js';
import {readStateFromBackupFile} from '../../backup.js';
import {readFile} from 'node:fs/promises';
test.use({serviceWorkers:'block'});
const cloud=`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
function fixture(broker=false){const s=blankState(),p=s.projects[0];s.settings.displayCurrency='USD';p.targetUnits=1000;p.currentPrice=11;p.priceUpdatedAt=new Date().toISOString();s.trades=[{id:'first',projectId:p.id,date:'2025-01-01',type:'buy',buyType:'direct',shares:10,price:10}];s.dividends=[{id:'income',projectId:p.id,date:'2025-01-02',amountUSD:50}];if(broker)s.trades.push(tossCandidateToTrade({id:'broker',symbol:p.symbol,type:'buy',date:'2025-01-03',currency:'USD',shares:1,price:10},{projectId:p.id,id:'broker'}));return s;}
async function read(page){return page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('stateFundingV1');});}
async function setup(page,broker=false){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloud}));
 await page.route(/\/storage\.js$/,r=>r.fulfill({contentType:'application/javascript',body:`export * from './storage.js?plan-original=1';import {storageSet as original} from './storage.js?plan-original=1';export async function storageSet(key,value){if(key==='stateFundingV1'&&window.__failPlan)throw new DOMException('Synthetic full disk','QuotaExceededError');return original(key,value);}`}));
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
 await page.evaluate(async s=>{const {storageSet}=await import('/storage.js');await storageSet('stateFundingV1',s);},fixture(broker));
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').first().click();await openPortfolioDetail(page,'recovery');return errors;
}
async function useForm(page,amount='30',date='2025-01-04'){
 await openPortfolioDetail(page,'recovery');await page.locator('#page-projects [data-add-withdrawal]').click();await page.locator('#withdrawalForm [name="date"]').fill(date);await page.locator('#withdrawalForm [name="amountUSD"]').fill(amount);
}
async function details(page){await openPortfolioDetail(page,'recovery');const d=page.locator('#page-projects .dividend-use-details');if(await d.getAttribute('open')===null)await d.locator(':scope > summary').click();return d;}
async function manual(page,action){
 await openRecordAction(page,action);
}

test('플러스 전환 → ISA 사용 → 마이너스 재개 → 목표 달성은 과거 사용액을 유지한다',async({page})=>{
 test.setTimeout(90000);const errors=await setup(page),before=await read(page);
 await openPortfolioDetail(page,'recovery');await expect(page.locator('#page-projects .dividend-plan-notice')).toContainText('플러스');await page.locator('#page-projects .dividend-plan-notice [data-dividend-mode]').click();await page.locator('#modalConfirm').click();await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
 await useForm(page);await page.locator('#withdrawalForm [name="destination"]').selectOption('isa');await page.locator('#withdrawalForm button[type="submit"]').click();await expect(page.locator('#withdrawalForm')).toBeHidden();
 const d=await details(page);await expect(d).toContainText('$20');expect((await read(page)).trades).toEqual(before.trades);
 await manual(page,'edit-price');await page.locator('#priceForm [name="price"]').fill('9');await page.locator('#priceForm button[type="submit"]').click();await expect(page.locator('#priceForm')).toBeHidden();
 await openPortfolioDetail(page,'recovery');await expect(page.locator('#page-projects .dividend-plan-notice')).toContainText('마이너스');await page.locator('#page-projects .dividend-plan-notice [data-dividend-mode]').click();await page.locator('#modalConfirm').click();
 expect((await read(page)).cashAdjustments[0].amountUSD).toBe(-30);expect((await read(page)).projects[0].dividendPlan.history).toHaveLength(2);
 await manual(page,'add-trade');await page.locator('#tradeForm [name="date"]').fill('2025-01-05');await page.locator('#tradeForm [name="shares"]').fill('990');await page.locator('#tradeForm [name="price"]').fill('10');await page.locator('#tradeForm button[type="submit"]').click();await expect(page.locator('#tradeForm')).toBeHidden();
 await expect(page.locator('.dividend-management .recovery-hero')).toContainText('회수할 원금');await expect(page.locator('.dividend-management .recovery-hero')).toContainText('$9,970');
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
 await page.locator('[data-close-modal]').click();await page.evaluate(async()=>{const {storageGet,storageSet}=await import('/storage.js');const s=await storageGet('stateFundingV1');s.cashAdjustments=[];delete s.projects[0].dividendPlan;delete s.trades[1].dividendFunding;await storageSet('stateFundingV1',s);});await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();
 await page.locator('#restoreInput').setInputFiles({name:'restored-plan.zip',mimeType:'application/zip',buffer:bytes});await expect(page.locator('#confirmRestore')).toBeVisible();await page.locator('#confirmRestore').click();await expect(page.locator('#confirmRestore')).toBeHidden();const restored=await read(page);expect(restored.projects[0].dividendPlan).toEqual(original.projects[0].dividendPlan);expect(restored.cashAdjustments).toEqual(original.cashAdjustments);expect(restored.trades).toEqual(original.trades);expect(errors).toEqual([]);
});

test('외부에서 이미 사용한 배당을 재투자 매수에 중복 사용할 수 없다',async({page})=>{
 const errors=await setup(page);await useForm(page);await page.locator('#withdrawalForm button[type="submit"]').click();await expect(page.locator('#withdrawalForm')).toBeHidden();await manual(page,'add-trade');await page.locator('#tradeForm [name="date"]').fill('2025-01-05');await page.locator('#tradeForm [name="buyType"]').selectOption('reinvest');await page.locator('#tradeForm [name="shares"]').fill('3');await page.locator('#tradeForm [name="price"]').fill('10');await page.locator('#tradeForm button[type="submit"]').click();await expect(page.locator('.toast')).toContainText('배당 잔액이 부족');expect((await read(page)).trades).toHaveLength(1);await page.locator('#tradeForm [name="shares"]').fill('2');await page.locator('#tradeForm button[type="submit"]').click();await expect(page.locator('#tradeForm')).toBeHidden();const saved=await read(page);expect(saved.trades).toHaveLength(2);expect(saved.cashAdjustments[0].amountUSD).toBe(-30);expect(errors).toEqual([]);
});

test('미확인 자금은 사용을 막고 실제 출금일 확인 후 잔액을 연다',async({page})=>{
 const errors=await setup(page,true),original=await read(page);
 await expect(page.locator('#page-projects [data-add-withdrawal]')).toBeDisabled();
 await details(page);await expect(page.locator('.dividend-use-details')).toContainText('잔액 계산 보류');
 await manual(page,'add-withdrawal');await expect(page.locator('#withdrawalForm')).toHaveCount(0);await expect(page.locator('.toast')).toContainText('배당 사용 전에');await page.locator('#modal [data-close-modal]').click();
 await details(page);await page.locator('[data-review-funding]').click();await page.locator('[data-funding-trade="broker"]').click();
 await page.locator('#fundingForm [name="amountUSD"]').fill('10');await page.locator('#fundingForm [name="cashDate"]').fill('2025-01-04');await page.locator('#fundingForm button[type="submit"]').click();
 await expect(page.locator('#fundingForm')).toBeHidden();await expect(page.locator('#page-projects [data-add-withdrawal]')).toBeEnabled();
 const after=await read(page);expect(after.trades[1].source).toEqual(original.trades[1].source);expect(after.trades[1].date).toBe(original.trades[1].date);expect(after.trades[1].dividendFunding.cashDate).toBe('2025-01-04');
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await read(page)).trades[1].dividendFunding.cashDate).toBe('2025-01-04');expect(errors).toEqual([]);
});

test('중간 잔액 제외는 원래 값을 보존하고 저장 실패 시 되돌린다',async({page})=>{
 const errors=await setup(page);await page.evaluate(async()=>{const {storageGet,storageSet}=await import('/storage.js');const s=await storageGet('stateFundingV1');s.projects[0].initialDividendBalance=8;s.projects[0].initialDividendBalanceDate='2025-01-03';await storageSet('stateFundingV1',s);});
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').click();await openPortfolioDetail(page,'recovery');await details(page);
 await expect(page.locator('#page-projects [data-add-withdrawal]')).toBeDisabled();await page.locator('[data-exclude-opening-snapshot]').click();await page.evaluate(()=>window.__failPlan=true);await page.locator('#modalConfirm').click();await expect(page.locator('.toast')).toContainText('기기 저장에 실패');expect((await read(page)).projects[0].initialDividendBalanceTreatment).toBeUndefined();
 await page.evaluate(()=>window.__failPlan=false);await page.locator('#modalConfirm').click();await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);await expect(page.locator('#page-projects [data-add-withdrawal]')).toBeEnabled();
 const after=await read(page);expect(after.projects[0].initialDividendBalance).toBe(8);expect(after.projects[0].initialDividendBalanceTreatment).toBe('excludedSnapshot');await details(page);await expect(page.locator('.dividend-use-details')).toContainText('$50');expect(errors).toEqual([]);
});

test('혼합 자금은 재사용 금액을 새 원금에 더하지 않는다',async({page})=>{
 const errors=await setup(page,true),before=await read(page);await details(page);await page.locator('[data-review-funding]').click();await page.locator('[data-funding-trade="broker"]').click();await page.locator('#fundingForm [name="amountUSD"]').fill('5');await page.locator('#fundingForm [name="contributionUSD"]').fill('3');await page.locator('#fundingForm button[type="submit"]').click();await expect(page.locator('#fundingForm')).toBeHidden();
 const after=await read(page);expect(after.trades[1].dividendFunding.contributionUSD).toBe(3);expect(after.trades[1].dividendFunding.cashDebitUSD).toBe(10);expect(after.trades[1].source).toEqual(before.trades[1].source);await details(page);await expect(page.locator('.dividend-use-details')).toContainText('$103');await expect(page.locator('.dividend-use-details')).toContainText('$45');expect(errors).toEqual([]);
});

test('구버전 저장은 재무 업데이트 원장을 덮지 않고 최초 복사는 원본을 보존한다',async({page})=>{
 const seed=fixture();
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloud}));
 await page.addInitScript(seed=>{if(!localStorage.getItem('qa-old-seeded')){localStorage.setItem('dividend-os-v4:state',JSON.stringify(seed));localStorage.setItem('qa-old-seeded','yes');}},seed);
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
 expect((await read(page)).dividends[0].amountUSD).toBe(50);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('dividend-os-v4:state')))).toEqual(seed);
 await page.evaluate(()=>{const old=JSON.parse(localStorage.getItem('dividend-os-v4:state'));old.dividends=[];localStorage.setItem('dividend-os-v4:state',JSON.stringify(old));});
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await read(page)).dividends[0].amountUSD).toBe(50);
});

test('같은 날 배당 입금 후 매수만 허용하고 입력 시각은 재실행 후 유지한다',async({page})=>{
 const errors=await setup(page,true);
 await page.evaluate(async()=>{const {storageGet,storageSet}=await import('/storage.js');const s=await storageGet('stateFundingV1');s.dividends[0].date='2025-01-03';s.dividends[0].cashTime='16:09';await storageSet('stateFundingV1',s);});
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').first().click();await details(page);await page.locator('[data-review-funding]').click();await page.locator('[data-funding-trade="broker"]').click();
 await page.locator('#fundingForm [name="amountUSD"]').fill('10');await page.locator('#fundingForm [name="cashTime"]').fill('06:57');await page.locator('#fundingForm button[type="submit"]').click();
 await expect(page.locator('.toast')).toContainText('입출금');expect((await read(page)).trades[1].dividendFunding).toBeUndefined();
 await page.locator('#fundingForm [name="cashTime"]').fill('17:00');await page.locator('#fundingForm button[type="submit"]').click();await expect(page.locator('#fundingForm')).toBeHidden();await expect(page.locator('#page-projects [data-add-withdrawal]')).toBeEnabled();
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await read(page)).trades[1].dividendFunding.cashTime).toBe('17:00');expect(errors).toEqual([]);
});

test('두 화면에서 동시 기록하면 먼저 저장한 금액을 오래된 화면이 덮지 않는다',async({page,context})=>{
 const errors=await setup(page),other=await context.newPage();
 await other.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloud}));
 await other.goto('/');await expect(other.locator('#splashScreen')).toBeHidden();await other.locator('[data-page="projects"]').first().click();await openPortfolioDetail(other,'recovery');
 await useForm(page,'20');await useForm(other,'10');
 await page.locator('#withdrawalForm button[type="submit"]').click();await expect(page.locator('#withdrawalForm')).toBeHidden();
 await other.locator('#withdrawalForm button[type="submit"]').click();await expect(other.locator('.toast')).toContainText('기기 저장에 실패');
 const saved=await read(page);expect(saved.cashAdjustments).toHaveLength(1);expect(saved.cashAdjustments[0].amountUSD).toBe(-20);
 await other.reload();await expect(other.locator('#splashScreen')).toBeHidden();expect((await read(other)).cashAdjustments).toEqual(saved.cashAdjustments);expect(errors).toEqual([]);await other.close();
});

test('과거 부족 기록은 추가 사용을 막으면서 기존 사용액 감소로 복구할 수 있다',async({page})=>{
 const errors=await setup(page);
 await page.evaluate(async()=>{const {storageGet,storageSet}=await import('/storage.js');const s=await storageGet('stateFundingV1'),p=s.projects[0];s.dividends[0].amountUSD=20;s.dividends.push({id:'later',projectId:p.id,date:'2025-01-05',amountUSD:20});s.cashAdjustments=[{id:'bad',projectId:p.id,date:'2025-01-04',amountUSD:-30,purpose:'dividendUse',destination:'isa'}];await storageSet('stateFundingV1',s);});
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').first().click();await openPortfolioDetail(page,'recovery');await expect(page.locator('#page-projects [data-add-withdrawal]')).toBeDisabled();
 await openPortfolioDetail(page,'records');await page.locator('.records-list [data-view-record="cash:bad"]').click();await page.locator('.record-manage > summary').click();await page.locator('[data-edit-record="cash:bad"]').click();await expect(page.locator('#withdrawalForm')).toBeVisible();
 await page.locator('#withdrawalForm [name="amountUSD"]').fill('10');await page.locator('#withdrawalForm button[type="submit"]').click();await expect(page.locator('#withdrawalForm')).toBeHidden();expect((await read(page)).cashAdjustments[0].amountUSD).toBe(-10);await openPortfolioDetail(page,'recovery');await expect(page.locator('#page-projects [data-add-withdrawal]')).toBeEnabled();expect(errors).toEqual([]);
});

test('반 센트 경계의 출금액은 입력 화면·저장 검증·재시작에서 일치한다',async({page})=>{
 const errors=await setup(page,true);
 await page.evaluate(async()=>{const {storageGet,storageSet}=await import('/storage.js'),{tossCandidateToTrade}=await import('/modules/toss.js');const s=await storageGet('stateFundingV1'),p=s.projects[0];s.trades[1]=tossCandidateToTrade({id:'half-cent',symbol:p.symbol,type:'buy',date:'2025-01-03',currency:'USD',shares:1,price:1.005},{projectId:p.id,id:'broker'});await storageSet('stateFundingV1',s);});
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').first().click();await details(page);await page.locator('[data-review-funding]').click();await page.locator('[data-funding-trade="broker"]').click();
 await expect(page.locator('#fundingForm [name="amountUSD"]')).toHaveAttribute('max','1.01');await page.locator('#fundingForm [name="amountUSD"]').fill('1.01');await page.locator('#fundingForm button[type="submit"]').click();await expect(page.locator('#fundingForm')).toBeHidden();
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();const t=(await read(page)).trades[1];expect(t.price).toBe(1.005);expect(t.dividendFunding.cashDebitUSD).toBe(1.01);expect(t.dividendFunding.amountUSD).toBe(1.01);expect(errors).toEqual([]);
});

test('결제 예정 재투자 예약금은 수동 재투자에서도 중복 사용되지 않는다',async({page})=>{
 const errors=await setup(page,true);
 await page.evaluate(async()=>{const {storageGet,storageSet}=await import('/storage.js');const s=await storageGet('stateFundingV1'),t=s.trades[1];t.dividendFunding={amountUSD:10,contributionUSD:0,sourceFingerprint:t.source.sourceFingerprint,cashDate:'2099-01-01'};await storageSet('stateFundingV1',s);});
 await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('[data-page="projects"]').first().click();await manual(page,'add-trade');await page.locator('#tradeForm [name="date"]').fill('2025-01-04');await page.locator('#tradeForm [name="buyType"]').selectOption('reinvest');await page.locator('#tradeForm [name="shares"]').fill('4.5');await page.locator('#tradeForm [name="price"]').fill('10');await page.locator('#tradeForm button[type="submit"]').click();await expect(page.locator('.toast')).toContainText('부족');expect((await read(page)).trades).toHaveLength(2);
 await page.locator('#tradeForm [name="shares"]').fill('4');await page.locator('#tradeForm button[type="submit"]').click();await expect(page.locator('#tradeForm')).toBeHidden();expect((await read(page)).trades).toHaveLength(3);expect(errors).toEqual([]);
});
