import {test,expect} from '@playwright/test';

// Opt-in release QA. Every record goes through the visible form and Save button.
// A fresh non-persistent localhost browser context has no user account or cloud data.
async function ledger(page){
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('DividendOSDB_V4');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('kv','readonly');
      const get=tx.objectStore('kv').get('state');
      get.onsuccess=()=>{db.close();resolve(get.result);};
      get.onerror=()=>{db.close();reject(get.error);};
    };
  }));
}

async function openManual(page,action){
  await page.locator('[data-page="projects"]').first().click();
  for(const selector of ['.record-center','.manual-tools']){
    if(await page.locator(selector).getAttribute('open')===null){
      await page.locator(`${selector} > summary`).click();
    }
  }
  await page.locator(`[data-add-${action}]`).click();
}

async function enterTrade(page,date,shares,price){
  await openManual(page,'trade');
  await page.locator('#tradeForm [name="date"]').fill(date);
  await page.locator('#tradeForm [name="shares"]').fill(shares);
  await page.locator('#tradeForm [name="price"]').fill(price);
  await page.locator('#tradeForm button[type="submit"]').click();
  await expect(page.locator('#tradeForm')).toBeHidden();
}

async function openAdvancedSettings(page){
  await page.locator('[data-page="settings"]').first().click();
  const section=page.locator('details.settings-section').filter({has:page.locator('[data-backup]')});
  if(await section.getAttribute('open')===null)await section.locator(':scope > summary').click();
}

test('30년 월별 거래·배당 720건을 개별 입력하고 재시작·ZIP 복원·되돌리기를 대조한다',async({page},testInfo)=>{
  test.skip(process.env.QA_LIFETIME_UI!=='1'||testInfo.project.name!=='mobile-chromium','Explicit mobile release QA only');
  test.setTimeout(15*60_000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#splashScreen')).toBeHidden();
  const initial=await ledger(page);
  expect(initial.trades).toHaveLength(0);
  expect(initial.dividends).toHaveLength(0);
  expect(initial.integrations.toss.status).toBe('not_connected');
  const expectedTrades=[],expectedDividends=[];
  for(let year=1995;year<=2024;year++){
    for(let month=1;month<=12;month++){
      const date=`${year}-${String(month).padStart(2,'0')}-15`;
      await enterTrade(page,date,'1.25','10.20');
      expectedTrades.push({date,shares:1.25,price:10.2});
      // Independent expected values in integer cents; never read from app calculations.
      const cents=expectedTrades.length;
      await openManual(page,'dividend');
      await page.locator('#dividendForm [name="date"]').fill(date);
      await page.locator('#dividendForm [name="amountUSD"]').fill((cents/100).toFixed(2));
      await page.locator('#dividendForm button[type="submit"].primary').click();
      await expect(page.locator('#dividendForm')).toBeHidden();
      expectedDividends.push({date,amountUSD:cents/100});
      const saved=await ledger(page);
      expect(saved.trades).toHaveLength(expectedTrades.length);
      expect(saved.dividends).toHaveLength(expectedDividends.length);
      expect(saved.trades.at(-1)).toMatchObject(expectedTrades.at(-1));
      expect(saved.dividends.at(-1)).toMatchObject(expectedDividends.at(-1));
    }
    console.log(`UI lifetime QA: ${year}, ${expectedTrades.length+expectedDividends.length} individually saved records`);
  }
  const before=await ledger(page);
  expect(before.trades.reduce((sum,row)=>sum+row.shares,0)).toBe(450);
  expect(before.dividends.reduce((sum,row)=>sum+Math.round(row.amountUSD*100),0)).toBe(64980);
  await page.locator('#usdBtn').click();
  await expect(page.locator('.holding-row strong').first()).toHaveText('450주');
  await expect(page.locator('.cashflow-secondary strong').first()).toHaveText('$649.80');
  await page.reload();
  await expect(page.locator('#splashScreen')).toBeHidden();
  const restarted=await ledger(page);
  expect(restarted.trades).toEqual(before.trades);
  expect(restarted.dividends).toEqual(before.dividends);
  for(const section of ['home','projects','goal','settings']){
    await page.locator(`[data-page="${section}"]`).first().click();
    await expect(page.locator(`#page-${section}`)).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await openAdvancedSettings(page);
  await page.locator('[data-backup]').click();
  await expect(page.locator('.modal-title')).toHaveText('백업 준비 완료');
  const downloadPromise=page.waitForEvent('download');
  await page.locator('a.backup-download').click();
  const download=await downloadPromise;
  const backupPath=testInfo.outputPath('synthetic-30y-backup.zip');
  await download.saveAs(backupPath);
  await page.locator('[data-close-modal]').click();
  await enterTrade(page,'2025-01-15','2','11');
  expect((await ledger(page)).trades).toHaveLength(361);
  await page.locator('#restoreInput').setInputFiles(backupPath);
  await page.locator('#confirmRestore').click();
  await expect(page.locator('#confirmRestore')).toBeHidden();
  const restored=await ledger(page);
  expect(restored.trades).toEqual(before.trades);
  expect(restored.dividends).toEqual(before.dividends);
  await openAdvancedSettings(page);
  await page.locator('[data-restore-safety]').click();
  await page.locator('#modalConfirm').click();
  await expect(page.locator('#modalConfirm')).toBeHidden();
  const rolledBack=await ledger(page);
  expect(rolledBack.trades).toHaveLength(361);
  expect(rolledBack.dividends).toEqual(before.dividends);
  expect(errors).toEqual([]);
  await testInfo.attach('lifetime-ui-evidence',{
    body:JSON.stringify({scope:'localhost isolated browser, synthetic data only',years:30,individualSaves:720,tradeCount:360,dividendCount:360,shares:450,dividendCents:64980,restart:true,zipRestore:true,safetyRollback:true,pageErrors:errors},null,2),contentType:'application/json'
  });
  await openAdvancedSettings(page);
  await page.locator('[data-reset]').click();
  await page.locator('#modalConfirm').click();
  await expect(page.locator('#modalConfirm')).toBeHidden();
  const cleared=await ledger(page);
  expect(cleared.trades).toHaveLength(0);
  expect(cleared.dividends).toHaveLength(0);
  expect(cleared.integrations.toss.status).toBe('not_connected');
});
