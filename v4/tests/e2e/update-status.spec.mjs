import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
const cloud=`export async function getGoogleIdToken(){return null;}export async function initGoogleAuth(){};export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
async function setup(page,mode){
 await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloud}));
 await page.addInitScript(mode=>{window.__updateMode=mode;window.__updateCalls=0;window.Capacitor={Plugins:{HotUpdate:{confirmReady:async()=>{},status:async()=>{window.__updateCalls++;if(window.__updateMode==='failure')throw new Error('업데이트 서버 연결 실패');return {available:true,currentVersion:'0.12.30',latestVersion:window.__updateMode==='new'?'0.12.31':'0.12.28',updateAvailable:window.__updateMode==='new',nativeUpdateRequired:false};}}}};},mode);
 await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();await expect.poll(()=>page.evaluate(()=>window.__updateCalls)).toBeGreaterThan(0);await page.locator('[data-page="settings"]').first().click();
 const section=page.locator('details.settings-section').filter({has:page.locator('[data-check-hot-update]')});if(await section.getAttribute('open')===null)await section.locator(':scope > summary').click();return section;
}
test('업데이트 서버 실패를 최신 버전이나 확인 성공으로 표시하지 않는다',async({page})=>{
 const section=await setup(page,'failure');await expect(section.locator('summary')).toContainText('확인 실패');await expect(section.locator('summary')).not.toContainText('최신 버전');await page.locator('[data-check-hot-update]').click();await expect(page.locator('.toast')).toContainText('업데이트 서버 연결 실패');await expect(page.locator('.toast')).not.toContainText('최신 버전');await expect(page.locator('[data-install-hot-update]')).toHaveCount(0);
});
test('현재 APK보다 오래된 배포 정보와 새 업데이트를 구분한다',async({page})=>{
 let section=await setup(page,'stale');await expect(section).toContainText('현재 0.12.30 · 배포 0.12.28');await expect(section.locator('summary')).toContainText('설치 버전이 더 최신');await page.locator('[data-check-hot-update]').click();await expect(page.locator('.toast')).toContainText('설치 버전이 배포 버전보다 최신');await page.evaluate(()=>window.__updateMode='new');await page.locator('[data-check-hot-update]').click();section=page.locator('details.settings-section').filter({has:page.locator('[data-check-hot-update]')});await expect(section.locator('summary')).toContainText('업데이트 있음');await expect(page.locator('[data-install-hot-update]')).toBeVisible();await page.evaluate(()=>window.__updateMode='failure');await page.locator('[data-check-hot-update]').click();await expect(page.locator('[data-install-hot-update]')).toHaveCount(0);
});
