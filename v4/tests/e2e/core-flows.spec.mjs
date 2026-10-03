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
  await page.locator('#usdBtn').click();
  await expect(page.locator('#usdBtn')).toHaveAttribute('aria-pressed','true');
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


test('동기화 문구와 빈 상태가 바뀌어도 상단과 목표 카드 위치가 유지된다',async({page},info)=>{
  const errors=await openDemo(page);
  await page.locator('[data-page="goal"]').first().click();
  for(const width of [320,360,380,412,430,600,1440]){
    await page.setViewportSize({width,height:915});
    const baseline=await page.evaluate(()=>{
      const status=document.getElementById('saveStatus');status.textContent='';status.className='save-pill';
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      return {header:rect('.topbar'),actions:rect('.topbar-actions'),goal:rect('#page-goal'),settings:rect('.top-icon-btn')};
    });
    for(const [text,kind] of [['준비 중',''],['동기화 중','cloud-busy'],['동기화 확인','cloud-busy'],['다른 기기 변경 · 확인 필요','cloud-error'],['클라우드 오류','cloud-error'],['오프라인','cloud-error'],['','cloud-ok']]){
      await page.evaluate(({text,kind})=>{const el=document.getElementById('saveStatus');el.textContent=text;el.className=`save-pill ${kind}`;},{text,kind});
      const actual=await page.evaluate(()=>{
        const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
        return {header:rect('.topbar'),actions:rect('.topbar-actions'),goal:rect('#page-goal'),settings:rect('.top-icon-btn')};
      });
      expect(actual,`${width}px / ${text||'empty'} must not move the header or content`).toEqual(baseline);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      if(text)await expect(page.locator('#saveStatus')).toBeVisible();
    }
    if(width===412)await page.screenshot({path:info.outputPath('stable-sync-header.png'),fullPage:true});
  }
  expect(errors).toEqual([]);
});
