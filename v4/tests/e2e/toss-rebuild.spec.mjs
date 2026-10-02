import {test,expect} from '@playwright/test';

async function readLedger(page,key='state'){
  return page.evaluate(key=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('DividendOSDB_V4');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,get=db.transaction('kv','readonly').objectStore('kv').get(key);
      get.onsuccess=()=>{db.close();resolve(get.result);};
      get.onerror=()=>{db.close();reject(get.error);};
    };
  }),key);
}

async function manualForm(page,kind){
  await page.locator('[data-page="projects"]').first().click();
  for(const name of ['record-center','manual-tools']){
    if(await page.locator(`.${name}`).getAttribute('open')===null)await page.locator(`.${name} > summary`).click();
  }
  await page.locator(`[data-add-${kind}]`).click();
}

async function setup(page,holdingShares){
  await page.goto('/');
  await expect(page.locator('#splashScreen')).toBeHidden();
  await manualForm(page,'trade');
  await page.locator('#tradeForm [name="date"]').fill('2025-12-01');
  await page.locator('#tradeForm [name="shares"]').fill('238');
  await page.locator('#tradeForm [name="price"]').fill('10');
  await page.locator('#tradeForm button[type="submit"]').click();
  await expect(page.locator('#tradeForm')).toBeHidden();
  await manualForm(page,'dividend');
  await page.locator('#dividendForm [name="date"]').fill('2026-01-02');
  await page.locator('#dividendForm [name="amountUSD"]').fill('10');
  await page.locator('#dividendForm button[type="submit"].primary').click();
  await expect(page.locator('#dividendForm')).toBeHidden();
  const snapshot={
    accountScopeId:'0123456789abcdef01234567',syncStatus:'complete',failedAccountCount:0,historyTruncated:false,
    syncCursor:{ordersThrough:'2026-01-02'},capabilities:{orders:true,holdings:true,prices:false,dividends:false},accountResults:[],prices:[],dividends:[],
    holdings:[{symbol:'MSTY',currency:'USD',shares:holdingShares}],
    orders:[{id:'synthetic-authoritative',symbol:'MSTY',currency:'USD',date:'2026-01-01',type:'buy',shares:247,price:11}]
  };
  await page.locator('#tossImportInput').setInputFiles({
    name:'synthetic-toss.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({format:'dividend-os-toss-snapshot',version:1,exportedAt:'2026-01-02T00:00:00.000Z',snapshot}))
  });
  await expect(page.locator('[data-rebuild-msty-toss]')).toBeAttached();
  const section=page.locator('details.settings-section').filter({has:page.locator('[data-rebuild-msty-toss]')});
  if(await section.getAttribute('open')===null)await section.locator(':scope > summary').click();
}

test('토스 원본 재구축은 238주를 247주로 대조하고 배당과 안전 사본을 보존한다',async({page})=>{
  await setup(page,247);
  const before=await readLedger(page);
  expect(before.trades).toHaveLength(1);
  expect(before.trades[0].shares).toBe(238);
  await page.locator('details.toss-details').filter({has:page.locator('[data-rebuild-msty-toss]')}).locator(':scope > summary').click();
  await page.locator('[data-rebuild-msty-toss]').click();
  await page.locator('#modalConfirm').click();
  await expect(page.locator('.toast')).toContainText('토스 원본 1건으로 다시 만들었습니다');
  const rebuilt=await readLedger(page),safety=await readLedger(page,'safetyBackup');
  expect(rebuilt.trades).toHaveLength(1);
  expect(rebuilt.trades[0].shares).toBe(247);
  expect(rebuilt.trades[0].source.provider).toBe('toss');
  expect(rebuilt.dividends).toEqual(before.dividends);
  expect(rebuilt.integrations.toss.comparisons[0].difference).toBe(0);
  expect(rebuilt.integrations.toss.candidates).toHaveLength(0);
  expect(safety.trades).toEqual(before.trades);
  await page.reload();
  await expect(page.locator('#splashScreen')).toBeHidden();
  expect((await readLedger(page)).trades).toEqual(rebuilt.trades);
});

test('토스 보유주수와 체결 합계가 다르면 재구축을 거절하고 기존 기록을 유지한다',async({page})=>{
  await setup(page,246);
  const before=await readLedger(page);
  await page.locator('details.toss-details').filter({has:page.locator('[data-rebuild-msty-toss]')}).locator(':scope > summary').click();
  await page.locator('[data-rebuild-msty-toss]').click();
  await page.locator('#modalConfirm').click();
  await expect(page.locator('.toast')).toContainText('정확히 대조할 수 없어 기존 기록을 유지');
  const after=await readLedger(page);
  expect(after.trades).toEqual(before.trades);
  expect(after.dividends).toEqual(before.dividends);
  expect(after.integrations.toss.candidates).toEqual(before.integrations.toss.candidates);
});

test('예외 삭제는 저장 장부를 유지하고 재조회와 앱 재시작에도 동일 후보가 돌아오지 않는다',async({page})=>{
  await setup(page,247);
  const before=await readLedger(page);
  await page.locator('[data-delete-toss-exceptions]').click();
  await page.locator('#selectAllTossExceptions').click();
  await page.locator('#tossDeleteForm button[type="submit"]').click();
  await page.locator('#modalConfirm').click();
  await expect(page.locator('.toast')).toContainText('1건의 예외를 삭제');
  const deleted=await readLedger(page);
  expect(deleted.trades).toEqual(before.trades);
  expect(deleted.dividends).toEqual(before.dividends);
  expect(deleted.integrations.toss.sourceLedger).toEqual(before.integrations.toss.sourceLedger);
  expect(deleted.integrations.toss.candidates).toHaveLength(0);
  await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();
  await page.locator('#tossImportInput').setInputFiles({name:'repeated.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'dividend-os-toss-snapshot',version:1,exportedAt:'2026-01-02T00:00:00.000Z',snapshot:{prices:[],dividends:[],accountResults:[],syncCursor:{ordersThrough:'2026-01-02'},accountScopeId:deleted.integrations.toss.accountScopeId,orders:[{id:'synthetic-authoritative',symbol:'MSTY',currency:'USD',date:'2026-01-01',type:'buy',shares:247,price:11}],holdings:[{symbol:'MSTY',currency:'USD',shares:247}],capabilities:{orders:true,holdings:true,dividends:false},syncStatus:'complete'}}))});
  await expect.poll(async()=> (await readLedger(page)).integrations.toss.syncSequence).toBeGreaterThan(deleted.integrations.toss.syncSequence);
  expect((await readLedger(page)).integrations.toss.candidates).toHaveLength(0);
});

test('환율 갱신 성공과 실패를 구분하며 실패 시 저장 환율을 유지한다',async({page})=>{
  await setup(page,247);
  let fail=false;
  await page.route('https://api.frankfurter.dev/**',route=>fail?route.fulfill({status:503,body:'Unavailable'}):route.fulfill({contentType:'application/json',body:JSON.stringify({base:'USD',quote:'KRW',rate:1450.25,date:new Date().toISOString().slice(0,10)})}));
  const display=page.locator('details.settings-section').filter({has:page.locator('#displaySettingsForm')});await display.locator(':scope > summary').click();
  await page.locator('[data-refresh-exchange-rate]').click();
  await expect.poll(async()=>(await readLedger(page)).settings.exchangeRate).toBe(1450.25);
  await expect(page.locator('[data-refresh-exchange-rate]')).toBeEnabled();
  fail=true;await page.locator('[data-refresh-exchange-rate]').click();
  await expect(display).toContainText('환율 조회 실패 · 마지막 저장 환율 유지');
  expect((await readLedger(page)).settings.exchangeRate).toBe(1450.25);
  await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();
  expect((await readLedger(page)).settings.exchangeRate).toBe(1450.25);
});

test('Android 백업 저장 버튼은 네이티브 저장 창을 호출하고 취소 시 완료로 표시하지 않는다',async({page})=>{
  await page.addInitScript(()=>{window.Capacitor={isNativePlatform:()=>true,Plugins:{BackupFile:{save:async(data)=>{window.backupSaveCall=data;return {cancelled:true};},download:async(data)=>{window.backupDownloadCall=data;return {saved:true};}}}};});
  await setup(page,247);
  const advanced=page.locator('details.settings-section').filter({has:page.locator('[data-backup]')});await advanced.locator(':scope > summary').click();
  await page.locator('[data-backup]').click();await expect(page.locator('[data-backup-save]')).toBeVisible();
  await page.locator('[data-backup-save]').click();
  await expect.poll(()=>page.evaluate(()=>window.backupSaveCall?.filename||'')).toMatch(/\.zip$/);
  await expect(page.locator('[data-backup-save]')).toBeVisible();
  await page.locator('[data-backup-download]').click();
  await expect(page.locator('.toast')).toContainText('다운로드 폴더에 ZIP 백업을 저장');
  const file=await page.evaluate(()=>window.backupDownloadCall);
  expect(Buffer.from(file.base64,'base64').subarray(0,2).toString()).toBe('PK');
});
