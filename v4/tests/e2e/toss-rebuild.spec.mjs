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
  await page.locator('[data-rebuild-msty-toss]').click();
  await page.locator('#modalConfirm').click();
  await expect(page.locator('.toast')).toContainText('정확히 대조할 수 없어 기존 기록을 유지');
  const after=await readLedger(page);
  expect(after.trades).toEqual(before.trades);
  expect(after.dividends).toEqual(before.dividends);
  expect(after.integrations.toss.candidates).toEqual(before.integrations.toss.candidates);
});
