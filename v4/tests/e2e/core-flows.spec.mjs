import {test,expect} from '@playwright/test';

async function openDemo(page){
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?demo=1');
  await expect(page.locator('.demo-banner')).toContainText('테스트 데이터');
  await expect(page.locator('#splashScreen')).toBeHidden();
  return errors;
}

test('핵심 화면을 모바일과 데스크톱에서 안전하게 탐색한다',async({page})=>{
  const errors=await openDemo(page);
  for(const pageName of ['home','projects','goal','settings']){
    await page.locator(`[data-page="${pageName}"]`).first().click();
    await expect(page.locator(`#page-${pageName}`)).toBeVisible();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('거래 입력이 원장과 보유주수에 즉시 반영된다',async({page})=>{
  const errors=await openDemo(page);
  await page.locator('[data-page="projects"]').first().click();
  const before=await page.locator('.holding-row strong').first().textContent();
  await page.locator('.record-center > summary').click();
  await page.locator('.manual-tools > summary').click();
  await page.locator('[data-add-trade]').click();
  await page.locator('#tradeForm [name="date"]').fill('2026-09-01');
  await page.locator('#tradeForm [name="shares"]').fill('1.2345');
  await page.locator('#tradeForm [name="price"]').fill('10.25');
  await page.locator('#tradeForm button[type="submit"].primary').click();
  await expect(page.locator('.toast')).toContainText('거래를 저장했습니다');
  await expect(page.locator('.holding-row strong').first()).not.toHaveText(before||'');
  expect(errors).toEqual([]);
});

test('배당 입력은 실제 입금액만 저장하고 예상값으로 부풀리지 않는다',async({page})=>{
  const errors=await openDemo(page);
  await page.locator('[data-page="projects"]').first().click();
  await page.locator('.record-center > summary').click();
  await page.locator('.manual-tools > summary').click();
  await page.locator('[data-add-dividend]').click();
  await page.locator('#dividendForm [name="date"]').fill('2026-09-02');
  await page.locator('#dividendForm [name="amountUSD"]').fill('12.34');
  await expect(page.locator('.dividend-preview')).toContainText('이번 실제 입금');
  await expect(page.locator('.dividend-preview')).toContainText('$12.34');
  await expect(page.locator('.dividend-preview')).toContainText('실제 입금값만 저장');
  await page.locator('#dividendForm button[type="submit"].primary').click();
  await expect(page.locator('.toast')).toContainText('배당을 저장했습니다');
  await expect(page.locator('#page-projects')).toContainText('$12.34');
  expect(errors).toEqual([]);
});
