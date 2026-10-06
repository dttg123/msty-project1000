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
  await expect(page.locator('[data-review-toss]')).toBeHidden();
  await expect(page.locator('[data-delete-toss-exceptions]')).toBeHidden();
  await expect(page.locator('.toast')).not.toContainText('자동 대조를 통과하지 못한');
  await page.locator('details.toss-details').filter({has:page.locator('[data-delete-toss-exceptions]')}).locator(':scope > summary').click();
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

test('Android 백업은 저장 창 없이 다운로드하며 실패·중복 요청을 완료로 표시하지 않는다',async({page})=>{
  await page.addInitScript(()=>{window.backupCalls=0;window.backupMode='pending';window.Capacitor={isNativePlatform:()=>true,Plugins:{BackupFile:{save:async()=>{throw new Error('unsafe picker invoked');},download:async(data)=>{window.backupCalls++;window.backupDownloadCall=data;if(window.backupMode==='pending')return new Promise((resolve,reject)=>{window.rejectBackup=reject;});return window.backupMode==='unconfirmed'?{}:{saved:true};}}}};});
  await setup(page,247);const before=await readLedger(page);
  const advanced=page.locator('details.settings-section').filter({has:page.locator('[data-backup]')});await advanced.locator(':scope > summary').click();
  await page.locator('[data-backup]').click();await expect(page.locator('[data-backup-download]')).toBeVisible();
  await expect(page.locator('[data-backup-save]')).toBeVisible();
  await page.evaluate(()=>{const button=document.querySelector('[data-backup-download]');button.click();button.click();});
  await expect.poll(()=>page.evaluate(()=>window.backupCalls)).toBe(1);
  await expect(page.locator('[data-backup-download]')).toBeDisabled();
  expect((await readLedger(page)).meta.lastBackupAt).toBe(before.meta.lastBackupAt);
  await page.evaluate(()=>window.rejectBackup(new Error('disk full')));
  await expect(page.locator('.toast')).toContainText('백업 저장에 실패');
  await expect(page.locator('[data-backup-download]')).toBeEnabled();
  await page.evaluate(()=>window.backupMode='unconfirmed');await page.locator('[data-backup-download]').click();
  await expect.poll(()=>page.evaluate(()=>window.backupCalls)).toBe(2);
  await expect(page.locator('[data-backup-download]')).toBeEnabled();
  expect((await readLedger(page)).meta.lastBackupAt).toBe(before.meta.lastBackupAt);
  await page.evaluate(()=>window.backupMode='saved');await page.locator('[data-backup-download]').click();
  await expect(page.locator('.toast')).toContainText('다운로드 폴더에 ZIP 백업을 저장');
  const file=await page.evaluate(()=>window.backupDownloadCall),bytes=Buffer.from(file.base64,'base64');
  expect(bytes.length).toBeGreaterThan(700000);expect(bytes.subarray(0,2).toString()).toBe('PK');
  const restored=await page.evaluate(async(base64)=>{const {readStateFromBackupFile}=await import('/backup.js');return readStateFromBackupFile(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'backup.zip'));},file.base64);
  expect(restored.trades).toEqual(before.trades);expect(restored.dividends).toEqual(before.dividends);
  const saved=await readLedger(page);expect(saved.trades).toEqual(before.trades);expect(saved.dividends).toEqual(before.dividends);expect(saved.meta.lastBackupAt).toBeTruthy();
});

test('과거 수동 중복 후보를 보존하면서 새 4주를 자동 저장하고 재조회해도 251주를 유지한다',async({page})=>{
  await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
  await manualForm(page,'trade');
  await page.locator('#tradeForm [name="date"]').fill('2025-12-01');
  await page.locator('#tradeForm [name="shares"]').fill('247');
  await page.locator('#tradeForm [name="price"]').fill('18.01');
  await page.locator('#tradeForm button[type="submit"]').click();await expect(page.locator('#tradeForm')).toBeHidden();
  await manualForm(page,'dividend');
  await page.locator('#dividendForm [name="date"]').fill('2026-01-02');
  await page.locator('#dividendForm [name="amountUSD"]').fill('10');
  await page.locator('#dividendForm button[type="submit"].primary').click();await expect(page.locator('#dividendForm')).toBeHidden();
  const before=await readLedger(page);
  const snapshot={accountScopeId:'0123456789abcdef01234567',syncCursor:{ordersThrough:'2026-02-01'},syncStatus:'complete',failedAccountCount:0,historyTruncated:false,prices:[],dividends:[],accountResults:[],capabilities:{orders:true,holdings:true,dividends:false},holdings:[{symbol:'MSTY',currency:'USD',shares:251}],orders:[{id:'old-manual-match',symbol:'MSTY',currency:'USD',date:'2025-12-01',type:'buy',shares:247,price:18.01},{id:'new-four',symbol:'MSTY',currency:'USD',date:'2026-02-01',type:'buy',shares:4,price:16.25}]};
  const load=()=>page.locator('#tossImportInput').setInputFiles({name:'incremental.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'dividend-os-toss-snapshot',version:1,exportedAt:'2026-02-01T00:00:00Z',snapshot}))});
  await page.locator('#tossImportInput').setInputFiles({name:'holdings-only.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'dividend-os-toss-snapshot',version:1,exportedAt:'2026-02-01T00:00:00Z',snapshot:{...snapshot,orders:[]}}))});
  await expect(page.locator('.toast')).toContainText('체결 합계와 보유주수 불일치');
  expect((await readLedger(page)).trades).toEqual(before.trades);
  await load();await expect(page.locator('.toast')).toContainText('매수 1건');
  const saved=await readLedger(page),safety=await readLedger(page,'safetyBackup');
  expect(saved.trades).toHaveLength(2);expect(saved.trades.reduce((sum,row)=>sum+row.shares,0)).toBe(251);
  expect(saved.dividends).toEqual(before.dividends);expect(saved.trades[0]).toEqual(before.trades[0]);
  expect(saved.integrations.toss.comparisons[0].difference).toBe(0);
  expect(saved.integrations.toss.candidates).toHaveLength(1);expect(saved.integrations.toss.candidates[0].possibleManualDuplicate).toBe(true);
  expect(safety.trades).toEqual(before.trades);
  await load();await expect.poll(async()=>(await readLedger(page)).integrations.toss.syncSequence).toBeGreaterThan(saved.integrations.toss.syncSequence);
  expect((await readLedger(page)).trades).toEqual(saved.trades);
  const section=page.locator('details.settings-section').filter({has:page.locator('[data-review-toss]')});
  if(await section.getAttribute('open')===null)await section.locator(':scope > summary').click();
  await expect(page.locator('.toss-sync-warning')).toHaveCount(0);
  snapshot.holdings[0].shares=253;
  snapshot.orders.push({id:'missing-counterpart',symbol:'MSTY',currency:'USD',date:'2026-02-02',type:'buy',shares:1,price:16.25});
  await load();await expect(page.locator('.toast')).toContainText('체결 합계와 보유주수 불일치');
  expect((await readLedger(page)).trades).toEqual(saved.trades);
  if(await section.getAttribute('open')===null)await section.locator(':scope > summary').click();
  await expect(page.locator('.toss-sync-warning')).toBeVisible();await expect(page.locator('.toss-sync-warning')).toContainText('보유주수');
  await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await readLedger(page)).trades).toEqual(saved.trades);
});

test('같은 날 토스 매수·매도는 원본 체결시각 순서로 저장하고 재시작해도 유지한다',async({page})=>{
  await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
  const snapshot={accountScopeId:'0123456789abcdef01234567',syncCursor:{ordersThrough:'2026-01-01'},syncStatus:'complete',failedAccountCount:0,historyTruncated:false,prices:[],dividends:[],accountResults:[],capabilities:{orders:true,holdings:true,dividends:false},holdings:[{symbol:'MSTY',currency:'USD',shares:5}],orders:[
    {id:'a-sell-first-in-response',symbol:'MSTY',currency:'USD',date:'2026-01-01',type:'sell',shares:5,price:12,filledAt:'2026-01-01T11:00:00+09:00'},
    {id:'z-buy',symbol:'MSTY',currency:'USD',date:'2026-01-01',type:'buy',shares:10,price:10,filledAt:'2026-01-01T10:00:00+09:00'}
  ]};
  await page.locator('#tossImportInput').setInputFiles({name:'same-day.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'dividend-os-toss-snapshot',version:1,exportedAt:'2026-01-02T00:00:00Z',snapshot}))});
  await expect(page.locator('.toast')).toContainText('매수 1건');
  const saved=await readLedger(page);expect(saved.trades).toHaveLength(2);expect(saved.trades.every(row=>!!row.source.filledAt)).toBe(true);
  expect(saved.integrations.toss.comparisons[0].difference).toBe(0);
  await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await readLedger(page)).trades).toEqual(saved.trades);
});


test('시작 시 거부되는 과도한 설정값은 저장 전에 차단되고 기존 기록으로 다시 열린다',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await setup(page,247);const before=await readLedger(page);
  const display=page.locator('details.settings-section').filter({has:page.locator('#displaySettingsForm')});await display.locator(':scope > summary').click();
  await page.locator('#displaySettingsForm [name="exchangeRate"]').fill('10000000000000000');
  await page.locator('#displaySettingsForm button[type="submit"]').click();
  await expect(page.locator('.toast')).toContainText('기기 저장에 실패');
  expect((await readLedger(page)).settings).toEqual(before.settings);expect((await readLedger(page)).trades).toEqual(before.trades);
  await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await expect(page.locator('#bootRetry')).toHaveCount(0);expect((await readLedger(page)).settings).toEqual(before.settings);expect(errors).toEqual([]);
});

test.describe('legacy execution and storage failure recovery',()=>{
// Failure injection must reach module requests on every reload, not a cached worker response.
test.use({serviceWorkers:'block'});
for(const scenario of ['matched','mismatch','real-oversell','safety-save-failed','ledger-save-failed'])test(`과거 토스 체결시각 복원과 신규 저장: ${scenario}`,async({page})=>{
  const saveFailure=scenario.endsWith('save-failed'),errors=[];page.on('pageerror',error=>errors.push(error.message));
  if(saveFailure)await page.route(/\/storage\.js$/,route=>route.fulfill({contentType:'application/javascript',body:`export * from './storage.js?qa-original=1';import {storageSet as original} from './storage.js?qa-original=1';export async function storageSet(key,value){(window.__tossWriteAttempts??=[]).push(key);if(window.__failTossSave===key)throw new DOMException('Synthetic full disk','QuotaExceededError');return original(key,value);}`}));
  await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
  const orders=[
    {id:'a-old-sell',symbol:'MSTY',currency:'USD',date:'2026-01-01',type:'sell',shares:10,price:12,filledAt:scenario==='real-oversell'?'2026-01-01T09:00:00+09:00':'2026-01-01T11:00:00+09:00'},
    {id:'z-old-buy',symbol:'MSTY',currency:'USD',date:'2026-01-01',type:'buy',shares:10,price:10,filledAt:'2026-01-01T10:00:00+09:00'},
    {id:'old-position',symbol:'MSTY',currency:'USD',date:'2026-01-02',type:'buy',shares:247,price:11,filledAt:'2026-01-02T10:00:00+09:00'}
  ];
  await page.evaluate(async orders=>{
    const {blankState}=await import('/modules/state.js'),{tossCandidateToTrade}=await import('/modules/toss.js');
    const state=blankState();state.trades=orders.map(order=>{const trade=tossCandidateToTrade(order,{projectId:state.projects[0].id,id:order.id,createdAt:'2026-10-01T00:00:00Z'});delete trade.source.filledAt;return trade;});
    state.integrations.toss.sourceLedger.orders=orders;
    await new Promise((resolve,reject)=>{const request=indexedDB.open('DividendOSDB_V4');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(state,'state');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
  },orders);
  await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();const before=await readLedger(page);
  const snapshot={accountScopeId:'0123456789abcdef01234567',syncCursor:{ordersThrough:'2026-02-01'},syncStatus:'complete',failedAccountCount:0,historyTruncated:false,prices:[],dividends:[],accountResults:[],capabilities:{orders:true,holdings:true,dividends:false},holdings:[{symbol:'MSTY',currency:'USD',shares:scenario==='mismatch'?252:251}],orders:[...orders,{id:'new-buy-four',symbol:'MSTY',currency:'USD',date:'2026-02-01',type:'buy',shares:4,price:16,filledAt:'2026-02-01T10:00:00+09:00'}]};
  const load=()=>page.locator('#tossImportInput').setInputFiles({name:'legacy-execution.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'dividend-os-toss-snapshot',version:1,exportedAt:'2026-02-02T00:00:00Z',snapshot}))});
  if(saveFailure)await page.evaluate(key=>window.__failTossSave=key,scenario==='safety-save-failed'?'safetyBackup':'state');
  await load();
  if(saveFailure){
    await expect.poll(()=>page.evaluate(()=>window.__tossWriteAttempts||[])).toContain(scenario==='safety-save-failed'?'safetyBackup':'state');
    await expect(page.locator('.toast')).toContainText(scenario==='safety-save-failed'?'Synthetic full disk':'기기 저장에 실패');
    expect((await readLedger(page)).trades).toEqual(before.trades);
    await page.evaluate(()=>window.__failTossSave='');
    await page.locator('#krwBtn').click();await expect.poll(async()=>(await readLedger(page)).settings.displayCurrency).toBe('KRW');
    expect((await readLedger(page)).trades).toEqual(before.trades);
    await load();await expect(page.locator('.toast')).toContainText('매수 1건');
    expect((await readLedger(page)).trades).toHaveLength(4);expect(errors).toEqual([]);
  }else if(scenario==='matched'){
    await expect(page.locator('.toast')).toContainText('매수 1건');const saved=await readLedger(page),safety=await readLedger(page,'safetyBackup');
    expect(saved.trades).toHaveLength(4);expect(saved.integrations.toss.comparisons[0].difference).toBe(0);
    expect(saved.trades.slice(0,3).every(trade=>!!trade.source.filledAt)).toBe(true);
    expect(saved.trades.slice(0,3).map(({source,...row})=>row)).toEqual(before.trades.map(({source,...row})=>row));
    expect(safety.trades).toEqual(before.trades);
    await load();await expect.poll(async()=>(await readLedger(page)).integrations.toss.syncSequence).toBeGreaterThan(saved.integrations.toss.syncSequence);
    expect((await readLedger(page)).trades).toEqual(saved.trades);
  }else{
    await expect(page.locator('.toast')).toContainText(scenario==='mismatch'?'체결 합계와 보유주수 불일치':'중간 보유주수 초과 매도');
    expect((await readLedger(page)).trades).toEqual(before.trades);
  }
  const after=await readLedger(page);await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await readLedger(page)).trades).toEqual(after.trades);
});

});


test('관리하지 않는 과거 종목의 초과 매도가 MSTY 251 갱신을 막지 않는다',async({page})=>{
  await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();
  const snapshot={syncCursor:{ordersThrough:'2026-02-02'},syncStatus:'complete',failedAccountCount:0,historyTruncated:false,accountScopeId:'0123456789abcdef01234567',prices:[],dividends:[],accountResults:[],capabilities:{orders:true,holdings:true,dividends:false},holdings:[{symbol:'MSTY',currency:'USD',shares:251}],orders:[{id:'old-msty',symbol:'MSTY',currency:'USD',date:'2026-01-01',type:'buy',shares:247,price:10},{id:'new-four',symbol:'MSTY',currency:'USD',date:'2026-02-01',type:'buy',shares:4,price:16},{id:'closed-old-sell',symbol:'TSLA',currency:'USD',date:'2023-02-21',type:'sell',shares:0.441733,price:200}]};
  const load=()=>page.locator('#tossImportInput').setInputFiles({name:'scope.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'dividend-os-toss-snapshot',version:1,exportedAt:'2026-02-02T00:00:00Z',snapshot}))});
  await load();await expect(page.locator('.toast')).toContainText('매수 2건');
  const saved=await readLedger(page);expect(saved.projects.map(p=>p.symbol)).toEqual(['MSTY']);expect(saved.trades.reduce((sum,t)=>sum+t.shares,0)).toBe(251);expect(saved.integrations.toss.comparisons[0].difference).toBe(0);expect(saved.integrations.toss.sourceLedger.orders).toHaveLength(3);expect(saved.integrations.toss.candidates).toHaveLength(1);
  await load();await expect.poll(async()=>(await readLedger(page)).integrations.toss.syncSequence).toBeGreaterThan(saved.integrations.toss.syncSequence);expect((await readLedger(page)).trades).toEqual(saved.trades);
  await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();expect((await readLedger(page)).trades).toEqual(saved.trades);
});

for(const outcome of ['saved','cancelled','failed'])test(`Android 백업 위치 선택: ${outcome}`,async({page})=>{
  await page.addInitScript(outcome=>{window.Capacitor={isNativePlatform:()=>true,Plugins:{BackupFile:{saveAtLocation:async data=>{window.pickerCall=data;if(outcome==='failed')throw new Error('write failed');return outcome==='cancelled'?{cancelled:true}:{saved:true};},download:async()=>{throw new Error('wrong backup route');}}}};},outcome);
  await setup(page,247);const before=await readLedger(page);
  const section=page.locator('details.settings-section').filter({has:page.locator('[data-backup]')});await section.locator(':scope > summary').click();await page.locator('[data-backup]').click();await expect(page.locator('[data-backup-save]')).toBeVisible();await page.locator('[data-backup-save]').click();await expect.poll(()=>page.evaluate(()=>!!window.pickerCall)).toBe(true);
  if(outcome==='saved'){await expect(page.locator('.toast')).toContainText('선택한 위치에 ZIP 백업');expect((await readLedger(page)).meta.lastBackupAt).toBeTruthy();}
  else {await expect(page.locator('[data-backup-save]')).toBeEnabled();expect((await readLedger(page)).meta.lastBackupAt).toBe(before.meta.lastBackupAt);if(outcome==='failed')await expect(page.locator('.toast')).toContainText('위치 선택 저장에 실패');}
});
