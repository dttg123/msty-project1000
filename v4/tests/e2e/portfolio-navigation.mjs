import {expect} from '@playwright/test';
export async function openPortfolioDetail(page,tab='dividend'){
 const link=page.locator('#page-projects [data-project-detail]');
 if(await link.count())await link.last().click();
 const button=page.locator(`[data-project-detail-tab="${tab}"]`);
 await expect(button).toBeVisible();
 if(await button.getAttribute('aria-selected')!=='true')await button.click();
 await expect(page.locator(`#detail-panel-${tab}`)).toBeVisible();
}
