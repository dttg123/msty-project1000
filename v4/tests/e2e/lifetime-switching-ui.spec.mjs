import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const cloud=`export async function initGoogleAuth(){};export async function logoutGoogle(){};export async function getGoogleIdToken(){return null;}export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){return {revision:1};}export async function subscribeCloudDocument(){return ()=>{};}`;
const thresholds=[250,500,452,173,687,333,829,997,1000];
async function installDriver(page){await page.evaluate(()=>{
 const pause=()=>new Promise(r=>setTimeout(r,10));
 window.qaSubmit=async(kind,values)=>{
  if(kind==='withdrawal')document.querySelector('#page-projects [data-add-withdrawal]').click();
  else {for(const name of ['record-center','manual-tools']){const detail=document.querySelector('.'+name);if(!detail.open)detail.querySelector('summary').click();}document.querySelector(`[data-${kind==='price'?'edit-price':'add-'+kind}]`).click();}
  const form=document.querySelector('#'+({price:'price',trade:'trade',dividend:'dividend',withdrawal:'withdrawal'}[kind])+'Form');if(!form)throw Error('Missing form '+kind);
  for(const [name,value] of Object.entries(values)){const input=form.elements.namedItem(name);if(!input)throw Error('Missing field '+kind+':'+name);input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
  if(!form.checkValidity())throw Error('Invalid UI form '+kind+' '+JSON.stringify(values));
  form.querySelector('button[type="submit"].primary,button[type="submit"]').click();const start=performance.now();
  while(form.isConnected){if(performance.now()-start>30000)throw Error('UI save timeout '+kind+' '+document.querySelector('.toast')?.textContent);await pause();}
 };
 window.qaSelect=(id,symbol)=>{document.querySelector('[data-page="projects"]').click();if(!document.querySelector('[data-portfolio-group="highYield"]').classList.contains('active'))document.querySelector('[data-portfolio-group="highYield"]').click();const select=document.querySelector('[data-project-select]');if(select){select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));}else document.querySelector(`[data-select-project="${id}"]`)?.click();if(document.querySelector('.project-symbol').textContent!==symbol)throw Error('Selected wrong project');};
 window.qaMode=async(id,mode)=>{const button=document.querySelector(`#page-projects [data-dividend-mode="${id}:${mode}"]`);if(!button)throw Error('Missing mode control '+mode);button.click();document.querySelector('#modalConfirm').click();const started=performance.now();while(document.querySelector('#modalBackdrop').classList.contains('show')){if(performance.now()-started>30000)throw Error('Mode save timeout');await pause();}};
 });}
async function submit(page,kind,values){await page.evaluate(async({kind,values})=>window.qaSubmit(kind,values),{kind,values});}
async function select(page,p){await page.evaluate(p=>window.qaSelect(p.id,p.symbol),p);}
async function read(page){return page.evaluate(async()=>{const {storageGet}=await import('/storage.js');return storageGet('state');});}
async function calculation(page,id){return page.evaluate(async id=>{const {storageGet}=await import('/storage.js'),{createPortfolioEngine}=await import('/modules/portfolio.js'),{projectRecovery,dividendPlanStatus}=await import('/modules/dividend-plan.js');const s=await storageGet('state'),c=createPortfolioEngine(()=>s,()=>id).computeProject(id);return {shares:c.shares,income:c.dividendsTotal,available:c.dividendAvailable,reinvest:c.reinvestAmount,direct:c.directBuyCost,min:c.minDividendBalance,milestones:c.milestoneDates,reached:c.targetReachedDate,recovery:projectRecovery(c),plan:dividendPlanStatus(c),project:c.project};},id);}
function assertCalc(c,e){expect(c.shares).toBe(e.shares);expect(c.income).toBeCloseTo(e.income/100,5);expect(c.available).toBeCloseTo((e.income-e.reinvest-e.use)/100,5);expect(c.reinvest).toBe(e.reinvest/100);expect(c.direct).toBe(2000);expect(c.min).toBeGreaterThanOrEqual(0);expect(c.recovery.basis).toBe(2000);expect(c.recovery.total).toBe(e.use/100);expect(c.recovery.remaining).toBe(Math.max(0,2000-e.use/100));expect(c.recovery.profit).toBe(Math.max(0,e.use/100-2000));expect((c.project.dividendPlan?.mode||'reinvest')).toBe(e.mode);expect((c.project.dividendPlan?.history||[])).toHaveLength(e.transitions);for(const [pct,date] of Object.entries(e.milestones))expect(c.milestones[pct]).toBe(date);if(e.reached)expect(c.reached).toBe(e.reached);}

test('9개 플러스 전환 경로를 30년 개별 입력: 250·500·452·무작위 주수·1000 달성 후 회수',async({page},info)=>{
 test.skip(process.env.QA_SWITCHING_LIFETIME_UI!=='1','Explicit 30-year switching UI QA');test.setTimeout(120*60_000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/modules/cloud-api.js',r=>r.fulfill({contentType:'application/javascript',body:cloud}));await page.clock.setFixedTime(new Date('2026-01-28T00:00:00Z'));await page.goto('/');await expect(page.locator('#splashScreen')).toBeHidden();await page.locator('#usdBtn').click();await page.locator('[data-page="projects"]').first().click();await page.locator('[data-project-settings]').click();await page.locator('#projectForm [name="targetUnits"]').fill('1000');await page.locator('#projectForm button[type="submit"]').click();await expect(page.locator('#projectForm')).toBeHidden();
 for(const threshold of thresholds.slice(1)){await page.locator('[data-add-project]').click();await page.locator('#projectForm [name="symbol"]').fill('P'+threshold);await page.locator('#projectForm [name="category"]').selectOption('highYield');await page.locator('#projectForm [name="targetUnits"]').fill('1000');await page.locator('#projectForm button[type="submit"]').click();await expect(page.locator('#projectForm')).toBeHidden();}
 const projects=(await read(page)).projects,models=new Map(projects.map((p,i)=>[p.id,{threshold:thresholds[i],shares:20,income:0,reinvest:0,use:0,mode:'reinvest',transitions:0,firstPlus:'',firstPlusMonth:null,reached:'',milestones:{},payments:0,buys:1,uses:0,recoverySteps:[],events:[]}]));await installDriver(page);
 for(const p of projects){await select(page,p);await submit(page,'trade',{type:'buy',buyType:'direct',date:'2026-01-01',shares:20,price:100});}
 let operationCount=projects.length,maxMonthMs=0;
 for(let index=0;index<360;index++){
  const year=2026+Math.floor(index/12),month=index%12+1,prefix=`${year}-${String(month).padStart(2,'0')}-`;await page.clock.setFixedTime(new Date(prefix+'28T00:00:00Z'));const began=Date.now();
  for(let i=0;i<projects.length;i++){
   const p=projects[i],e=models.get(p.id);await select(page,p);
   const cents=200000+e.shares*123+(index%11)*101+i*70000;await submit(page,'dividend',{date:prefix+'15',currency:'USD',amountUSD:(cents/100).toFixed(2),sharesAtPayment:e.shares});operationCount++;e.income+=cents;e.payments++;
   // Before the first plus checkpoint, accumulate only by reinvesting actual
   // earlier income. Once reached, two outside months alternate with four
   // negative/reinvest months. Purchases are never inserted as a final lump.
   let desired=e.reached?'outside':e.firstPlusMonth===null?'reinvest':(index-e.firstPlusMonth)%6<2?'outside':'reinvest';
   if(desired==='reinvest'&&e.mode==='outside'){
    await submit(page,'price',{price:80});operationCount++;
    await expect(page.locator('#page-projects .dividend-plan-notice')).toContainText('마이너스');
    const saved=await read(page);await page.evaluate(async({id,mode})=>window.qaMode(id,mode),{id:p.id,mode:'reinvest'});operationCount++;e.mode='reinvest';e.transitions++;
    const after=await read(page);expect(after.trades).toEqual(saved.trades);expect(after.cashAdjustments).toEqual(saved.cashAdjustments);e.events.push({date:prefix+'20',type:'mode',mode:'reinvest',shares:e.shares,recoveredUSD:e.use/100});
   }
   if(desired==='reinvest'&&e.shares<1000){
    const stops=[250,500,750,1000,e.threshold].filter(n=>n>e.shares).sort((a,b)=>a-b),quantity=Math.min(7+(index*17+i*23)%13,stops[0]-e.shares);await submit(page,'trade',{type:'buy',buyType:'reinvest',date:prefix+'20',shares:quantity,price:100});operationCount++;e.shares+=quantity;e.reinvest+=quantity*10000;e.buys++;
    for(const [level,target] of [[25,250],[50,500],[75,750],[100,1000]])if(e.shares===target&&!e.milestones[level]){e.milestones[level]=prefix+'20';e.events.push({date:prefix+'20',type:'milestone',shares:target});const text=await page.locator(`#page-goal [data-goal-project="${p.id}"] > summary`).innerText();expect(text).toContain(target===1000?'1,000주 달성':`${target===250?'500':target===500?'750':'1,000'}주 목표`);console.log(p.symbol,target,'주 달성 UI PASS',prefix+'20');}
    if(e.shares===e.threshold&&e.firstPlusMonth===null){e.firstPlusMonth=index;e.firstPlus=prefix+'20';desired='outside';e.events.push({date:prefix+'20',type:'first-plus',shares:e.shares});}
    if(e.shares===1000){e.reached=prefix+'20';desired='outside';if(e.threshold===1000){const c=await calculation(page,p.id);expect(c.recovery.total).toBe(0);expect(c.recovery.remaining).toBe(2000);expect(c.reinvest).toBe(98000);e.events.push({date:prefix+'20',type:'1000-before-recovery',remaining:2000,reinvest:98000});}}
   }
   const price=desired==='reinvest'?80:e.reached&&e.reached!==prefix+'20'&&index%9===0?80:120;await submit(page,'price',{price});operationCount++;
   // Price changes propose a direction but must not place transactions or
   // silently change the user's confirmed mode.
   const before=await calculation(page,p.id);expect((before.project.dividendPlan?.mode||'reinvest')).toBe(e.mode);
   if(desired!==e.mode){await expect(page.locator('#page-projects .dividend-plan-notice')).toContainText(desired==='outside'?'플러스':'마이너스');const usesBefore=await read(page);await page.evaluate(async({id,mode})=>window.qaMode(id,mode),{id:p.id,mode:desired});operationCount++;e.mode=desired;e.transitions++;const usesAfter=await read(page);expect(usesAfter.cashAdjustments).toEqual(usesBefore.cashAdjustments);expect(usesAfter.trades).toEqual(usesBefore.trades);e.events.push({date:prefix+'28',type:'mode',mode:desired,shares:e.shares,recoveredUSD:e.use/100});}
   if(desired==='outside'){
    const was=e.use;await submit(page,'withdrawal',{date:prefix+'25',amountUSD:400,destination:['isa','otherDividend','living','other'][i%4],note:p.symbol+' '+prefix+' 실제 외부 사용'});operationCount++;e.use+=40000;e.uses++;
    if(was<200000&&e.use<=200000){e.recoverySteps.push({date:prefix+'25',pct:e.use/2000,shares:e.shares});if(e.threshold===1000)console.log(p.symbol,'1000 달성 후 회수',e.use/2000+'%',prefix+'25');}
   }
   const calc=await calculation(page,p.id);assertCalc(calc,e);
   if(e.firstPlus===prefix+'20')console.log(p.symbol,'첫 플러스',e.shares,'주','회수액',e.use/100,'USD PASS');
   if(e.reached){await expect(page.locator('#page-projects .recovery-hero')).toContainText('남은 회수 원금');const goal=page.locator(`#page-goal [data-goal-project="${p.id}"] > summary`);await expect(goal).toContainText(e.use>=200000?'순수익 단계':'원금 회수 중');}
  }
  maxMonthMs=Math.max(maxMonthMs,Date.now()-began);
  if(month===12){const snapshot=await read(page);for(const p of projects){const e=models.get(p.id),ds=snapshot.dividends.filter(d=>d.projectId===p.id),ts=snapshot.trades.filter(t=>t.projectId===p.id),cs=snapshot.cashAdjustments.filter(c=>c.projectId===p.id);expect(ds).toHaveLength(e.payments);expect(ds.reduce((a,d)=>a+Math.round(d.amountUSD*100),0)).toBe(e.income);expect(ts).toHaveLength(e.buys);expect(cs).toHaveLength(e.uses);expect(ts.filter(t=>t.buyType==='direct')).toHaveLength(1);}
   console.log(year,'9경로 연간 저장 대조 PASS',projects.map(p=>`${p.symbol}:${models.get(p.id).shares}주/${models.get(p.id).use/100}회수`).join(' '));
   if([2030,2040,2055].includes(year)){await page.reload();await expect(page.locator('#splashScreen')).toBeHidden();await installDriver(page);const restarted=await read(page);expect(restarted.trades).toEqual(snapshot.trades);expect(restarted.dividends).toEqual(snapshot.dividends);expect(restarted.cashAdjustments).toEqual(snapshot.cashAdjustments);expect(restarted.projects.map(p=>p.dividendPlan)).toEqual(snapshot.projects.map(p=>p.dividendPlan));}
  }
 }
 const original=await read(page);for(const p of projects){const e=models.get(p.id);expect(e.shares).toBe(1000);expect(e.firstPlus).not.toBe('');expect(e.reached).not.toBe('');expect(e.payments).toBe(360);expect(e.recoverySteps.map(r=>r.pct)).toEqual([20,40,60,80,100]);await select(page,p);assertCalc(await calculation(page,p.id),e);expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
 await page.locator('[data-page="settings"]').first().click();const section=page.locator('.settings-section').filter({has:page.locator('[data-backup]')});if(await section.getAttribute('open')===null)await section.locator(':scope > summary').click();await page.locator('[data-backup]').click();const downloadEvent=page.waitForEvent('download');await page.locator('[data-backup-download]').click();const backupPath=info.outputPath('30-year-switching.zip');await(await downloadEvent).saveAs(backupPath);await page.locator('[data-close-modal]').first().click();await select(page,projects[0]);await submit(page,'dividend',{date:'2055-12-26',amountUSD:12345.67});await page.locator('#restoreInput').setInputFiles(backupPath);await page.locator('#confirmRestore').click();await expect(page.locator('#confirmRestore')).toBeHidden();const restored=await read(page);for(const key of ['projects','trades','dividends','cashAdjustments'])expect(restored[key]).toEqual(original[key]);expect(errors).toEqual([]);
 const evidence={scope:'Actual UI form submissions, no seeded app state; simulated monthly clock 2026–2055',years:30,projects:9,operationCount,maxMonthMs,trades:original.trades.length,dividends:original.dividends.length,withdrawals:original.cashAdjustments.length,evidence:projects.map(p=>({symbol:p.symbol,...models.get(p.id)})),pageErrors:errors};await info.attach('30-year-switching-evidence',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});await writeFile(info.outputPath('30-year-switching-ledger.json'),JSON.stringify(original));await page.screenshot({path:info.outputPath('1000-recovery.png')});
});
