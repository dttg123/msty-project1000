import {expect} from '@playwright/test';
export async function openPortfolioDetail(page,tab='dividend'){
 const link=page.locator('#page-projects [data-project-detail]');
 if(await link.count())await link.last().click();
 const button=page.locator(`[data-project-detail-tab="${tab}"]`);
 await expect(button).toBeVisible();
 if(await button.getAttribute('aria-selected')!=='true')await button.click();
 await expect(page.locator(`#detail-panel-${tab}`)).toBeVisible();
}

export async function openRecordAction(page,action){
 await openPortfolioDetail(page,'records');
 if(['add-trade','add-dividend','add-split','add-withdrawal'].includes(action))await page.locator('[data-record-add]').click();
 else {const tools=page.locator('.manual-tools');if(await tools.getAttribute('open')===null)await tools.locator(':scope > summary').click();}
 await page.locator(`${['add-trade','add-dividend','add-split','add-withdrawal'].includes(action)?'#modal ':''}[data-${action}]`).click();
}
