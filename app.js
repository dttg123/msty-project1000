import { initGoogleAuth, logoutGoogle } from './auth.js';
import { openStorage, storageGet, storageSet, storageDelete, readLegacyState } from './storage.js';
import { getCloudDocument, getLegacyCloudDocument, saveCloudDocument, subscribeCloudDocument } from './cloud.js';
import { APP_VERSION, buildPortableBackup, readStateFromBackupFile } from './backup.js';

(() => {
  'use strict';

  const STATE_KEY = 'state';
  const SAFETY_KEY = 'safetyBackup';
  const PAGES = ['home','projects','goal','settings'];
  const PROJECT_COLORS = [
    ['#6858f5','#9a84ff'], ['#f06d38','#ff9b68'], ['#2f7cf4','#65a8ff'],
    ['#159a6c','#43c394'], ['#db5570','#f58aa0'], ['#b17816','#e6ac47']
  ];
  const bootAt = performance.now();
  const n = value => Number(value) || 0;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, digits = 8) => Number(n(value).toFixed(digits));
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const todayISO = () => {
    const date = new Date();
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

  function blankRecovery() {
    return { locked:false, basis:0, startDate:'', targetReachedDate:'', calculatedBasisAtLock:0, confirmedAt:'' };
  }

  function blankProject(symbol = 'MSTY', name = 'YieldMax MSTR Option Income') {
    return {
      id: `p-${symbol.toLowerCase()}-${Date.now()}`,
      symbol: symbol.toUpperCase(), name, tag: symbol === 'MSTY' ? 'PROJECT1000' : '배당 프로젝트',
      targetUnits: symbol === 'MSTY' ? 1000 : 500, monthlyPlanShares:0, projectStart:todayISO(),
      currentPrice:0, distributionFrequency:symbol === 'MSTY' ? 'weekly' : 'monthly',
      initialDividendBalance:0, initialDividendBalanceDate:'', afterGoalMode:'cashflow',
      recovery:blankRecovery(), colorIndex:0, archived:false
    };
  }

  function blankState() {
    const project = blankProject();
    return {
      version:4,
      settings:{ exchangeRate:1370, displayCurrency:'USD', targetMonthlyDividend:500, warningKRW:18000000, thresholdKRW:20000000, appearance:'system' },
      projects:[project], trades:[], dividends:[], splits:[], cashAdjustments:[],
      integrations:{ toss:{ status:'not_connected', lastSyncAt:'', candidates:[] } },
      meta:{ createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), lastBackupAt:'', lastLocalSaveAt:'', lastCloudSaveAt:'', migratedFrom:'', migrationCheckedAt:'', celebratedMilestones:[] }
    };
  }

  function repairLegacy(raw) {
    if (!raw || raw.meta?.ledgerRepairV321) return raw;
    const dividends = Array.isArray(raw.dividends) ? raw.dividends : [];
    const trades = Array.isArray(raw.trades) ? raw.trades : [];
    const near = (a,b) => Math.abs(n(a)-n(b)) <= .011;
    const hasDividend = (date, amount) => dividends.some(d => d.date===date && near(d.amountUSD,amount));
    const t1 = trades.find(t => t.type==='buy' && t.date==='2026-07-25' && t.buyType==='mixed' && near(t.reinvestAmountUSD,40.77) && near(n(t.shares)*n(t.price),49.32));
    const t2 = trades.find(t => t.type==='buy' && t.date==='2026-08-05' && t.buyType==='reinvest' && near(n(t.shares)*n(t.price),38.49));
    const t3 = trades.find(t => t.type==='buy' && t.date==='2026-08-13' && t.buyType==='reinvest' && near(n(t.shares)*n(t.price),36.51));
    if (!(hasDividend('2026-07-24',40.77) && hasDividend('2026-07-31',41.36) && hasDividend('2026-08-07',39.30) && t1 && t2 && t3)) return raw;
    raw.settings = raw.settings || {};
    raw.settings.initialDividendBalance = 10.78;
    raw.settings.initialDividendBalanceDate = '2026-07-23';
    Object.assign(t1,{date:'2026-07-28',buyType:'reinvest',shares:4,price:12.3475,reinvestAmountUSD:0});
    Object.assign(t2,{date:'2026-08-07',buyType:'reinvest',shares:3,price:12.84,reinvestAmountUSD:0});
    Object.assign(t3,{date:'2026-08-17',buyType:'reinvest',shares:3,price:12.19,reinvestAmountUSD:0});
    raw.meta = {...(raw.meta || {}), ledgerRepairV321:new Date().toISOString()};
    return raw;
  }

  function migrateLegacy(input) {
    const raw = repairLegacy(clone(input));
    const state = blankState();
    const project = state.projects[0];
    project.id = 'p-msty';
    project.targetUnits = Math.max(.000001,n(raw.settings?.targetUnits) || 1000);
    project.monthlyPlanShares = Math.max(0,n(raw.settings?.monthlyPlanShares));
    project.projectStart = raw.settings?.projectStart || todayISO();
    project.currentPrice = Math.max(0,n(raw.settings?.currentPrice));
    project.initialDividendBalance = Math.max(0,n(raw.settings?.initialDividendBalance));
    project.initialDividendBalanceDate = raw.settings?.initialDividendBalanceDate || '';
    project.recovery = {...blankRecovery(), ...(raw.recovery || {})};
    state.settings.exchangeRate = Math.max(0,n(raw.settings?.exchangeRate) || 1370);
    state.settings.warningKRW = Math.max(0,n(raw.settings?.warningKRW) || 18000000);
    state.settings.thresholdKRW = Math.max(1,n(raw.settings?.thresholdKRW) || 20000000);
    state.settings.appearance = raw.settings?.appearance || 'system';
    state.trades = (raw.trades || []).map(x => ({...x, projectId:project.id, symbol:'MSTY'}));
    state.dividends = (raw.dividends || []).map(x => ({...x, projectId:project.id, symbol:'MSTY'}));
    state.splits = (raw.splits || []).map(x => ({...x, projectId:project.id, symbol:'MSTY'}));
    state.meta = {...state.meta, ...(raw.meta || {}), migratedFrom:'MSTY PROJECT1000 V3.2.1', migrationCheckedAt:new Date().toISOString()};
    state.version = 4;
    return state;
  }

  function normalizeV4(raw) {
    const base = blankState();
    const result = {...base, ...raw};
    result.version = 4;
    result.settings = {...base.settings, ...(raw.settings || {})};
    result.projects = Array.isArray(raw.projects) ? raw.projects.map((p,index) => ({
      ...blankProject(p.symbol || `ASSET${index+1}`,p.name || p.symbol || '배당 종목'), ...p,
      id:p.id || uid('p'), symbol:String(p.symbol || `ASSET${index+1}`).toUpperCase(),
      recovery:{...blankRecovery(), ...(p.recovery || {})}, colorIndex:Number.isInteger(p.colorIndex) ? p.colorIndex : index % PROJECT_COLORS.length
    })) : base.projects;
    for (const key of ['trades','dividends','splits','cashAdjustments']) result[key] = Array.isArray(raw[key]) ? raw[key] : [];
    result.integrations = {toss:{...base.integrations.toss, ...(raw.integrations?.toss || {})}};
    result.meta = {...base.meta, ...(raw.meta || {})};
    return result;
  }

  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return blankState();
    if (Array.isArray(raw.projects) || n(raw.version) >= 4) return normalizeV4(raw);
    if (Array.isArray(raw.trades) && Array.isArray(raw.dividends)) return migrateLegacy(raw);
    return blankState();
  }

  let state;
  let currentPage = 'home';
  let selectedProjectId = '';
  let chartMode = 'month';
  let recordsExpanded = false;
  let currentUser = null;
  let cloudUnsubscribe = null;
  let applyingCloudState = false;
  let saveTimer = null;
  let cloudTimer = null;
  let toastTimer = null;

  function activeProjects() { return state.projects.filter(p => !p.archived); }
  function projectById(id = selectedProjectId) { return state.projects.find(p => p.id === id) || activeProjects()[0] || state.projects[0]; }
  function projectRows(key, projectId) { return state[key].filter(row => row.projectId === projectId || (!row.projectId && projectById(projectId)?.symbol === 'MSTY')); }

  function sortedEvents(projectId) {
    const trades = projectRows('trades',projectId).map(x => ({...x,eventType:'trade'}));
    const splits = projectRows('splits',projectId).map(x => ({...x,eventType:'split'}));
    return [...trades,...splits].sort((a,b) => {
      const byDate=String(a.date).localeCompare(String(b.date));
      if(byDate)return byDate;
      const byType=(a.eventType==='split'?0:1)-(b.eventType==='split'?0:1);
      if(byType)return byType;
      return String(a.createdAt||a.id).localeCompare(String(b.createdAt||b.id));
    });
  }

  function computeProject(projectOrId) {
    const project = typeof projectOrId === 'string' ? projectById(projectOrId) : projectOrId;
    if (!project) return null;
    const trades = projectRows('trades',project.id);
    const dividends = projectRows('dividends',project.id);
    const adjustments = projectRows('cashAdjustments',project.id);
    const targetUnits = Math.max(.000001,n(project.targetUnits));
    let factor=1, shares=0, normalizedShares=0, costBasis=0, realized=0, directBuyCost=0, sellProceeds=0;
    let reinvestNormalized=0, reinvestAmount=0, reinvestCount=0, targetReachedDate='', targetBasisSuggestion=0;
    const milestoneDates={25:'',50:'',75:'',100:''}, oversells=[];
    for (const event of sortedEvents(project.id)) {
      if (event.eventType === 'split') {
        const ratio=n(event.to)/n(event.from);
        if (ratio>0 && Number.isFinite(ratio)) { shares*=ratio; factor*=ratio; }
      } else if (event.type === 'buy') {
        const quantity=Math.max(0,n(event.shares)), price=Math.max(0,n(event.price)), amount=quantity*price;
        shares+=quantity; normalizedShares+=quantity/factor; costBasis+=amount;
        if (event.buyType==='direct' || event.buyType==='opening') directBuyCost+=amount;
        if (event.buyType==='reinvest') { reinvestNormalized+=quantity/factor; reinvestAmount+=amount; reinvestCount++; }
        if (event.buyType==='mixed') {
          const dividendPart=clamp(n(event.reinvestAmountUSD),0,amount);
          reinvestNormalized+=amount>0?(quantity*dividendPart/amount)/factor:0;
          reinvestAmount+=dividendPart; directBuyCost+=Math.max(0,amount-dividendPart);
          if (dividendPart>0) reinvestCount++;
        }
      } else if (event.type === 'sell') {
        const quantity=Math.max(0,n(event.shares)), price=Math.max(0,n(event.price));
        if (quantity>shares+1e-8) oversells.push(event);
        const safeQuantity=Math.min(quantity,Math.max(0,shares));
        const avg=shares>0?costBasis/shares:0;
        realized+=safeQuantity*(price-avg); costBasis-=safeQuantity*avg; shares-=safeQuantity;
        normalizedShares-=safeQuantity/factor; sellProceeds+=safeQuantity*price;
      }
      const progress=normalizedShares/targetUnits;
      for (const pct of [25,50,75,100]) if (!milestoneDates[pct] && progress+1e-10>=pct/100) milestoneDates[pct]=event.date;
      if (!targetReachedDate && progress+1e-10>=1) { targetReachedDate=event.date; targetBasisSuggestion=Math.max(0,directBuyCost-sellProceeds); }
    }
    shares=Math.abs(shares)<1e-9?0:shares; costBasis=Math.max(0,Math.abs(costBasis)<1e-7?0:costBasis);
    const currentPrice=Math.max(0,n(project.currentPrice)), marketValue=shares*currentPrice;
    const unrealized=marketValue-costBasis, avgCost=shares>0?costBasis/shares:0, currentTarget=targetUnits*factor;
    const dividendsTotal=dividends.reduce((sum,row)=>sum+n(row.amountUSD),0);
    const currentYear=String(new Date().getFullYear());
    const yearDividends=dividends.filter(row=>String(row.date).startsWith(currentYear)).reduce((sum,row)=>sum+n(row.amountUSD),0);
    const recentDividend=[...dividends].sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0] || null;
    const recentCount=project.distributionFrequency==='weekly'?4:3;
    const recent=[...dividends].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,recentCount);
    const monthlyEstimate=recent.length ? recent.reduce((sum,row)=>sum+n(row.amountUSD),0)/recent.length*(project.distributionFrequency==='weekly'?4.33:1) : 0;
    const adjustmentTotal=adjustments.reduce((sum,row)=>sum+n(row.amountUSD),0);
    const dividendAvailable=Math.max(0,n(project.initialDividendBalance))+dividendsTotal+adjustmentTotal-reinvestAmount;
    return {
      project,trades,dividends,adjustments,factor,shares,normalizedShares,costBasis,realized,directBuyCost,sellProceeds,
      reinvestAmount,reinvestCount,reinvestShares:reinvestNormalized*factor,currentPrice,marketValue,unrealized,avgCost,
      currentTarget,progress:currentTarget>0?shares/currentTarget:0,dividendsTotal,yearDividends,recentDividend,monthlyEstimate,
      dividendAvailable,totalReturn:unrealized+realized+dividendsTotal,targetReachedDate,targetBasisSuggestion,milestoneDates,oversells
    };
  }

  function recoveryStats(calc) {
    const recovery=calc.project.recovery || blankRecovery();
    if (!recovery.locked) return {dividendRecovery:0,sellRecovery:0,total:0,remaining:0,pct:0};
    const dividendRecovery=calc.dividends.filter(x=>x.date>=recovery.startDate).reduce((sum,x)=>sum+n(x.amountUSD),0);
    const sellRecovery=calc.trades.filter(x=>x.type==='sell'&&x.date>=recovery.startDate).reduce((sum,x)=>sum+n(x.shares)*n(x.price),0);
    const total=dividendRecovery+sellRecovery, basis=Math.max(0,n(recovery.basis));
    return {dividendRecovery,sellRecovery,total,remaining:Math.max(0,basis-total),pct:basis>0?total/basis*100:0};
  }

  function totals() {
    const rows=activeProjects().map(computeProject).filter(Boolean);
    return {
      rows, marketValue:rows.reduce((s,x)=>s+x.marketValue,0), costBasis:rows.reduce((s,x)=>s+x.costBasis,0),
      unrealized:rows.reduce((s,x)=>s+x.unrealized,0), totalReturn:rows.reduce((s,x)=>s+x.totalReturn,0),
      dividendsTotal:rows.reduce((s,x)=>s+x.dividendsTotal,0), yearDividends:rows.reduce((s,x)=>s+x.yearDividends,0),
      monthlyEstimate:rows.reduce((s,x)=>s+x.monthlyEstimate,0), dividendAvailable:rows.reduce((s,x)=>s+x.dividendAvailable,0)
    };
  }

  function displayCurrency() { return state.settings.displayCurrency==='KRW'?'KRW':'USD'; }
  function fmtMoney(usd, digits=2) {
    if (displayCurrency()==='KRW') return `${Math.round(n(usd)*Math.max(0,n(state.settings.exchangeRate))).toLocaleString('ko-KR')}원`;
    return `${n(usd)<0?'-':''}$${Math.abs(n(usd)).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits})}`;
  }
  function fmtSignedMoney(usd) { return `${n(usd)>=0?'+':'-'}${fmtMoney(Math.abs(n(usd)))}`; }
  function fmtShares(value) { return n(value).toLocaleString('en-US',{maximumFractionDigits:4}); }
  function fmtPct(value) { return `${n(value).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`; }
  function fmtDate(value) { if(!value)return '-'; const [y,m,d]=String(value).slice(0,10).split('-'); return `${y}.${m}.${d}`; }
  function signClass(value) { return n(value)>0?'positive':n(value)<0?'negative':''; }
  function projectColors(project) { return PROJECT_COLORS[n(project?.colorIndex)%PROJECT_COLORS.length] || PROJECT_COLORS[0]; }

  function applyTheme(pref=state?.settings?.appearance || 'system') {
    const dark=pref==='dark'||(pref==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);
    document.documentElement.dataset.theme=dark?'dark':'light';
    localStorage.setItem('dividend-os-theme',pref);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#0f1117':'#f4f5f9');
  }
  function hideSplash() {
    const splash=document.getElementById('splashScreen'); if(!splash)return;
    setTimeout(()=>{splash.classList.add('hide');setTimeout(()=>splash.remove(),240);},Math.max(0,330-(performance.now()-bootAt)));
  }
  function toast(message) {
    const el=document.getElementById('toast'); clearTimeout(toastTimer); el.textContent=message; el.classList.add('show');
    try{navigator.vibrate?.(7)}catch(_){} toastTimer=setTimeout(()=>el.classList.remove('show'),2300);
  }
  function setSaveStatus(text,kind='') { const el=document.getElementById('saveStatus'); if(el){el.textContent=text;el.className=`save-pill ${kind}`;} }
  function hasMeaningfulData(value=state) { return !!(value&&(value.trades?.length||value.dividends?.length||value.splits?.length||value.cashAdjustments?.length||value.projects?.some(p=>n(p.currentPrice)||n(p.monthlyPlanShares)||n(p.initialDividendBalance)))); }

  async function pushCloudState() {
    if(!currentUser||applyingCloudState)return;
    if(!navigator.onLine){setSaveStatus('오프라인','cloud-error');return;}
    try {
      setSaveStatus('동기화 중','cloud-busy');
      const now=new Date().toISOString(); state.meta.lastCloudSaveAt=now;
      await saveCloudDocument(currentUser.uid,{state:clone(state),clientUpdatedAt:state.meta.updatedAt,appVersion:APP_VERSION});
      await storageSet(STATE_KEY,state); setSaveStatus('클라우드 저장','cloud-ok');
    } catch(error) { console.error(error); setSaveStatus('클라우드 오류','cloud-error'); toast('기기에는 저장됐지만 클라우드 저장에 실패했습니다.'); }
  }
  async function saveState(immediate=false) {
    state.meta.updatedAt=new Date().toISOString(); clearTimeout(saveTimer); clearTimeout(cloudTimer); setSaveStatus('저장 중','cloud-busy');
    const run=async()=>{state.meta.lastLocalSaveAt=new Date().toISOString();await storageSet(STATE_KEY,state);setSaveStatus(currentUser?'동기화 대기':'기기 저장');if(currentUser){if(immediate)await pushCloudState();else cloudTimer=setTimeout(pushCloudState,450);}};
    if(immediate)await run();else saveTimer=setTimeout(()=>run().catch(console.error),120);
  }

  function sectionTitle(title,note='') { return `<div class="section-title-row"><h2 class="section-title">${esc(title)}</h2>${note?`<span class="section-note">${esc(note)}</span>`:''}</div>`; }
  function progress(value,color='') { return `<div class="progress-track"><div class="progress-fill" style="width:${clamp(value,0,100)}%;${color?`background:${color}`:''}"></div></div>`; }

  function periodKey(dateString,mode) {
    const date=new Date(`${dateString}T12:00:00`); if(Number.isNaN(date.getTime()))return '';
    if(mode==='year')return String(date.getFullYear());
    if(mode==='month')return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    const day=(date.getDay()+6)%7; date.setDate(date.getDate()-day);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function chartSeries(projectId=null) {
    const rows=projectId?projectRows('dividends',projectId):state.dividends;
    const grouped=new Map(); rows.forEach(row=>{const key=periodKey(row.date,chartMode);if(key)grouped.set(key,(grouped.get(key)||0)+n(row.amountUSD));});
    const count=chartMode==='year'?5:6;
    return [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-count).map(([key,value])=>({key,label:chartMode==='year'?key:chartMode==='month'?`${Number(key.slice(5))}월`:`${Number(key.slice(5,7))}/${Number(key.slice(8))}`,value}));
  }
  function chartHTML(projectId=null) {
    const series=chartSeries(projectId), max=Math.max(1,...series.map(x=>x.value));
    if(!series.length)return '<div class="empty">배당을 입력하면 실제 흐름이 표시됩니다.</div>';
    return `<div class="column-chart compact-chart">${series.map(x=>`<div class="column-item"><div class="column-value">${fmtMoney(x.value,0)}</div><div class="column-track"><div class="column-fill" style="height:${Math.max(7,x.value/max*126)}px"></div></div><div class="column-label">${esc(x.label)}</div></div>`).join('')}</div>`;
  }

  function renderHome() {
    const total=totals(), monthlyTarget=Math.max(.01,n(state.settings.targetMonthlyDividend)), monthlyPct=total.monthlyEstimate/monthlyTarget*100;
    const annualKRW=total.yearDividends*n(state.settings.exchangeRate), threshold=Math.max(1,n(state.settings.thresholdKRW)), annualPct=annualKRW/threshold*100;
    const overallTarget=total.rows.reduce((sum,x)=>sum+x.currentTarget,0), overallShares=total.rows.reduce((sum,x)=>sum+x.shares,0), overallPct=overallTarget?overallShares/overallTarget*100:0;
    document.getElementById('page-home').innerHTML=`
      <div class="stack">
        <article class="card accent">
          <div class="card-head"><div class="card-title">전체 이번 달 예상 세후배당</div><span class="tag-pill">${total.rows.length}개 프로젝트</span></div>
          <div class="big-number">${fmtMoney(total.monthlyEstimate)}</div>
          <div class="metric-grid three">
            <div class="metric"><div class="metric-label">평가금액</div><div class="metric-value">${fmtMoney(total.marketValue,0)}</div></div>
            <div class="metric"><div class="metric-label">누적배당</div><div class="metric-value">${fmtMoney(total.dividendsTotal,0)}</div></div>
            <div class="metric"><div class="metric-label">목표달성</div><div class="metric-value">${fmtPct(overallPct)}</div></div>
          </div>
          <div class="progress-wrap"><div class="progress-meta"><span>월배당 목표 ${fmtMoney(monthlyTarget)}</span><span>${fmtPct(monthlyPct)}</span></div>${progress(monthlyPct)}</div>
        </article>
        ${sectionTitle('전체 배당 흐름','세후 실입금 합산')}
        <article class="card">
          <div class="card-head"><div><div class="card-title">배당 추세</div><div class="sub-number">더미값 없이 입력 기록만 반영</div></div>${periodButtons()}</div>
          <div id="homeChart">${chartHTML()}</div>
        </article>
        ${sectionTitle('프로젝트','종목별 현황')}
        <div>${total.rows.map(projectSummaryCard).join('')||'<article class="card empty-project">프로젝트를 추가해 주세요.</article>'}</div>
        ${sectionTitle('전체 상태','자동 합산')}
        <article class="card compact">
          <div class="list-row"><div><div class="row-title">투입원금</div><div class="row-sub">현재 남은 취득원가</div></div><div class="row-value">${fmtMoney(total.costBasis)}</div></div>
          <div class="list-row"><div><div class="row-title">사용 가능 배당</div><div class="row-sub">배당 + 보정 − 재투자</div></div><div class="row-value positive">${fmtMoney(total.dividendAvailable)}</div></div>
          <div class="list-row"><div><div class="row-title">올해 배당 관리</div><div class="row-sub">${Math.round(annualKRW).toLocaleString('ko-KR')}원 / ${Math.round(threshold).toLocaleString('ko-KR')}원</div></div><div class="row-value ${annualPct>=100?'negative':''}">${fmtPct(annualPct)}</div></div>
        </article>
      </div>`;
  }

  function periodButtons() {
    return `<div class="chart-period">${[['week','주'],['month','월'],['year','년']].map(([mode,label])=>`<button type="button" data-chart-mode="${mode}" class="${chartMode===mode?'active':''}">${label}</button>`).join('')}</div>`;
  }
  function projectSummaryCard(calc) {
    const colors=projectColors(calc.project), pct=calc.progress*100;
    return `<article class="card compact project-list-card" data-open-project="${calc.project.id}" style="border-left:4px solid ${colors[0]}">
      <div class="card-head"><div><div class="row-title">${esc(calc.project.symbol)} · ${esc(calc.project.tag)}</div><div class="row-sub">${fmtShares(calc.shares)} / ${fmtShares(calc.currentTarget)}주</div></div><span class="status-pill">${fmtPct(pct)}</span></div>
      ${progress(pct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}
      <div class="summary-grid" style="margin-top:12px"><div class="summary-chip"><div class="label">월 예상</div><div class="value">${fmtMoney(calc.monthlyEstimate,0)}</div></div><div class="summary-chip"><div class="label">총손익</div><div class="value ${signClass(calc.totalReturn)}">${fmtMoney(calc.totalReturn,0)}</div></div></div>
    </article>`;
  }

  function combinedRecords(calc) {
    return [
      ...calc.trades.map(row=>({...row,kind:'trade'})),
      ...calc.dividends.map(row=>({...row,kind:'dividend'})),
      ...projectRows('splits',calc.project.id).map(row=>({...row,kind:'split'})),
      ...calc.adjustments.map(row=>({...row,kind:'cash'}))
    ].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt||b.id).localeCompare(String(a.createdAt||a.id)));
  }
  function recordRow(row) {
    let title='',sub='',value='',cls='';
    if(row.kind==='trade'){title=row.type==='sell'?'매도':row.buyType==='reinvest'?'배당재투자':row.buyType==='mixed'?'혼합매수':row.buyType==='opening'?'초기보유':'직접매수';sub=`${fmtDate(row.date)} · ${fmtShares(row.shares)}주 · 단가 ${fmtMoney(row.price)}`;value=`${row.type==='sell'?'+':'-'}${fmtMoney(n(row.shares)*n(row.price))}`;cls=row.type==='sell'?'positive':'';}
    if(row.kind==='dividend'){title='세후배당';sub=`${fmtDate(row.date)}${row.note?` · ${esc(row.note)}`:''}`;value=`+${fmtMoney(row.amountUSD)}`;cls='positive';}
    if(row.kind==='split'){title=row.type==='reverse'?'역분할':'주식분할';sub=`${fmtDate(row.date)} · ${row.from}:${row.to}`;value='비율 반영';}
    if(row.kind==='cash'){title=row.label||'배당 잔액 보정';sub=fmtDate(row.date);value=fmtSignedMoney(row.amountUSD);cls=n(row.amountUSD)>=0?'positive':'negative';}
    return `<div class="list-row"><div><div class="row-title">${title}</div><div class="row-sub">${sub}</div></div><div><div class="row-value ${cls}">${value}</div><div class="row-actions"><button class="mini-icon" data-edit-record="${row.kind}:${row.id}">수정</button><button class="mini-icon delete" data-delete-record="${row.kind}:${row.id}">삭제</button></div></div></div>`;
  }

  function renderProjects() {
    const projects=activeProjects(); if(!selectedProjectId||!projectById(selectedProjectId))selectedProjectId=projects[0]?.id||'';
    const calc=computeProject(selectedProjectId), page=document.getElementById('page-projects');
    if(!calc){page.innerHTML=`${sectionTitle('프로젝트')}<article class="card empty-project"><p>등록된 프로젝트가 없습니다.</p><button class="btn primary" data-add-project>프로젝트 추가</button></article>`;return;}
    const p=calc.project, colors=projectColors(p), rec=recoveryStats(calc), pct=calc.progress*100, rows=combinedRecords(calc), shown=recordsExpanded?rows:rows.slice(0,5);
    page.innerHTML=`
      <div class="section-title-row"><h2 class="section-title">프로젝트</h2><button class="btn soft small" data-add-project>＋ 종목</button></div>
      <div class="project-tabs">${projects.map(x=>`<button class="project-tab ${x.id===p.id?'active':''}" data-select-project="${x.id}">${esc(x.symbol)}</button>`).join('')}</div>
      <div class="stack">
        <article class="card project-hero" style="--project-a:${colors[0]};--project-b:${colors[1]}">
          <div class="card-head"><div><div class="project-symbol">${esc(p.symbol)}</div><div class="project-name">${esc(p.name)}</div></div><span class="tag-pill">${esc(p.tag)}</span></div>
          <div class="big-number">${fmtMoney(calc.marketValue)}</div><div class="sub-number">평가손익 ${fmtSignedMoney(calc.unrealized)}</div>
          <div class="metric-grid"><div class="metric"><div class="metric-label">보유주수</div><div class="metric-value">${fmtShares(calc.shares)}주</div></div><div class="metric"><div class="metric-label">평균단가</div><div class="metric-value">${fmtMoney(calc.avgCost)}</div></div></div>
        </article>
        <article class="card">
          <div class="card-head"><div class="card-title">배당 · 현금흐름</div><span class="status-pill">세후</span></div>
          <div class="metric-grid three"><div class="metric"><div class="metric-label">월 예상</div><div class="metric-value">${fmtMoney(calc.monthlyEstimate)}</div></div><div class="metric"><div class="metric-label">누적배당</div><div class="metric-value">${fmtMoney(calc.dividendsTotal)}</div></div><div class="metric"><div class="metric-label">사용 가능</div><div class="metric-value positive">${fmtMoney(calc.dividendAvailable)}</div></div></div>
          <div class="quick-grid"><button class="btn primary" data-add-trade>거래</button><button class="btn secondary" data-add-dividend>배당</button><button class="btn soft" data-add-cash>잔액</button></div>
        </article>
        <article class="card">
          <div class="card-head"><div><div class="card-title">목표</div><div class="sub-number">${fmtShares(calc.shares)} / ${fmtShares(calc.currentTarget)}주</div></div><strong>${fmtPct(pct)}</strong></div>
          ${progress(pct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}
          <div class="metric-grid three"><div class="metric"><div class="metric-label">남은 주수</div><div class="metric-value">${fmtShares(Math.max(0,calc.currentTarget-calc.shares))}주</div></div><div class="metric"><div class="metric-label">재투자 주수</div><div class="metric-value">${fmtShares(calc.reinvestShares)}주</div></div><div class="metric"><div class="metric-label">원금회수</div><div class="metric-value">${fmtPct(rec.pct)}</div></div></div>
        </article>
        <article class="card"><div class="card-head"><div><div class="card-title">배당 흐름</div><div class="sub-number">${esc(p.symbol)} 실제 입력 기록</div></div>${periodButtons()}</div><div id="projectChart">${chartHTML(p.id)}</div></article>
        <article class="card">
          <div class="card-head"><div class="card-title">최근 기록</div><button class="mini-icon" data-project-settings>설정</button></div>
          <div class="list">${shown.map(recordRow).join('')||'<div class="empty">아직 기록이 없습니다.</div>'}</div>
          ${rows.length>5?`<button class="btn soft" style="width:100%;margin-top:10px" data-toggle-records>${recordsExpanded?'최근 5건만':'전체 기록 보기'}</button>`:''}
          <div class="quick-grid"><button class="btn soft" data-add-split>분할·역분할</button><button class="btn soft" data-project-settings>프로젝트 설정</button><button class="btn soft" data-project-check>점검</button></div>
        </article>
      </div>`;
  }

  function estimatedDate(calc) {
    const plan=Math.max(0,n(calc.project.monthlyPlanShares)), remaining=Math.max(0,calc.currentTarget-calc.shares);
    if(remaining<=0)return '달성 완료'; if(plan<=0)return '월 매수계획 필요';
    const date=new Date(); date.setMonth(date.getMonth()+Math.ceil(remaining/plan));
    return `${date.getFullYear()}년 ${date.getMonth()+1}월 예상`;
  }
  function renderGoals() {
    const total=totals(), monthlyTarget=Math.max(.01,n(state.settings.targetMonthlyDividend)), pct=total.monthlyEstimate/monthlyTarget*100;
    document.getElementById('page-goal').innerHTML=`${sectionTitle('목표','전체 + 종목별')}
      <div class="stack"><article class="card"><div class="card-head"><div><div class="card-title">전체 월배당 목표</div><div class="sub-number">세후 실입금 추정 합산</div></div><span class="status-pill">${fmtPct(pct)}</span></div><div class="big-number">${fmtMoney(total.monthlyEstimate)}</div><div class="sub-number">목표 ${fmtMoney(monthlyTarget)}</div><div class="progress-wrap">${progress(pct)}</div></article>
      ${total.rows.map(calc=>{const p=calc.project,colors=projectColors(p),goalPct=calc.progress*100,rec=recoveryStats(calc);return `<article class="card">
        <div class="card-head"><div><div class="row-title">${esc(p.symbol)} · ${esc(p.tag)}</div><div class="row-sub">${fmtShares(calc.shares)} / ${fmtShares(calc.currentTarget)}주</div></div><span class="status-pill">${fmtPct(goalPct)}</span></div>
        ${progress(goalPct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}
        <div class="metric-grid"><div class="metric"><div class="metric-label">예상 달성</div><div class="metric-value small">${estimatedDate(calc)}</div></div><div class="metric"><div class="metric-label">원금 회수</div><div class="metric-value">${fmtPct(rec.pct)}</div></div></div>
        <div class="sub-number">목표 달성 후 운용</div><div class="goal-choice"><button data-goal-mode="${p.id}:cashflow" class="${p.afterGoalMode==='cashflow'?'active':''}">현금흐름 전환</button><button data-goal-mode="${p.id}:reinvest" class="${p.afterGoalMode==='reinvest'?'active':''}">계속 재투자</button></div>
        ${goalPct>=100&&!p.recovery.locked?`<button class="btn primary" style="width:100%;margin-top:11px" data-lock-recovery="${p.id}">원금회수 기준 확정</button>`:''}
      </article>`}).join('')}</div>`;
  }

  function renderSettings() {
    const toss=state.integrations.toss;
    document.getElementById('page-settings').innerHTML=`${sectionTitle('설정','표시 · 데이터 · 연동')}
      <div class="stack">
        <article class="card"><div class="card-title">전체 표시 설정</div><form id="globalSettingsForm" class="form-grid" style="margin-top:14px">
          <div><label class="input-label">참고 환율 (1달러)</label><input class="input" name="exchangeRate" type="number" min="0" step="1" value="${n(state.settings.exchangeRate)}"></div>
          <div><label class="input-label">전체 월배당 목표 USD</label><input class="input" name="targetMonthlyDividend" type="number" min="0" step="1" value="${n(state.settings.targetMonthlyDividend)}"></div>
          <div><label class="input-label">연 배당 경고금액 (원)</label><input class="input" name="warningKRW" type="number" min="0" step="10000" value="${n(state.settings.warningKRW)}"></div>
          <div><label class="input-label">연 배당 관리기준 (원)</label><input class="input" name="thresholdKRW" type="number" min="1" step="10000" value="${n(state.settings.thresholdKRW)}"></div>
          <div><label class="input-label">화면 테마</label><select class="input select" name="appearance"><option value="system" ${state.settings.appearance==='system'?'selected':''}>기기 설정</option><option value="light" ${state.settings.appearance==='light'?'selected':''}>라이트</option><option value="dark" ${state.settings.appearance==='dark'?'selected':''}>다크</option></select></div>
          <button class="btn primary" type="submit">설정 저장</button>
        </form></article>
        <article class="card"><div class="card-head"><div><div class="card-title">토스 읽기 전용</div><div class="sub-number">신규 거래 발견 → 확인 → 승인 저장</div></div><span class="status-pill">${toss.status==='connected'?'연결됨':'미연결'}</span></div>
          <p class="tiny muted">자동 덮어쓰기는 하지 않습니다. 현재는 공식 개인 투자내역 API 연결값이 없어 실제 동기화는 비활성 상태입니다.</p>
          <button class="btn soft" style="width:100%" data-review-toss ${toss.candidates?.length?'':'disabled'}>${toss.candidates?.length?`거래 후보 ${toss.candidates.length}건 검토`:'검토할 거래 없음'}</button>
        </article>
        <article class="card"><div class="card-title">클라우드</div><div class="sync-line" style="margin-top:13px"><span class="sync-dot" id="syncDot"></span><div><div class="row-title" id="syncStatusText">${currentUser?'연결됨':'로그인 필요'}</div><div class="row-sub">V4 전용 저장공간 · V3 원본 보존</div></div></div>${currentUser?'<button class="btn soft" style="width:100%;margin-top:12px" data-logout>로그아웃</button>':''}</article>
        <article class="card"><div class="card-title">백업 · 내보내기</div><div class="action-row" style="margin-top:13px"><button class="btn primary" data-backup>ZIP 백업</button><button class="btn secondary" data-restore>ZIP 복원</button></div><div class="action-row" style="margin-top:9px"><button class="btn soft" data-csv>CSV 내보내기</button><button class="btn soft" data-all-check>전체 점검</button></div></article>
        <article class="card danger"><div class="card-title">초기화</div><p class="tiny muted">V4 데이터만 지웁니다. V3.2.1 저장소는 삭제하지 않습니다.</p><button class="btn soft" style="width:100%" data-reset>V4 전체 초기화</button></article>
      </div><div class="app-version">DividendOS ${APP_VERSION}${state.meta.migratedFrom?` · ${esc(state.meta.migratedFrom)}에서 이전`:''}</div>`;
  }

  function renderAll() {
    if(!selectedProjectId)selectedProjectId=activeProjects()[0]?.id||'';
    document.getElementById('usdBtn')?.classList.toggle('active',displayCurrency()==='USD');
    document.getElementById('krwBtn')?.classList.toggle('active',displayCurrency()==='KRW');
    renderHome();renderProjects();renderGoals();renderSettings();
  }
  function showPage(page) {
    if(!PAGES.includes(page))page='home'; currentPage=page;
    document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${page}`));
    document.querySelectorAll('.nav-btn').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
    window.scrollTo({top:0,behavior:'instant'});
  }
  function openModal(html) { const modal=document.getElementById('modal');modal.innerHTML=`<div class="modal-handle"></div>${html}`;document.getElementById('modalBackdrop').classList.add('show'); }
  function closeModal() { document.getElementById('modalBackdrop').classList.remove('show'); }
  function confirmAction(title,message,action,confirmText='확인') {
    openModal(`<h3 class="modal-title">${esc(title)}</h3><p class="modal-desc">${esc(message)}</p><div class="modal-actions"><button class="btn soft" data-close-modal>취소</button><button class="btn danger" id="modalConfirm">${esc(confirmText)}</button></div>`);
    document.getElementById('modalConfirm').onclick=async()=>{await action();closeModal();};
  }

  function openProjectForm(project=null) {
    const edit=!!project;
    openModal(`<h3 class="modal-title">${edit?'프로젝트 설정':'프로젝트 추가'}</h3><p class="modal-desc">종목마다 PROJECT1000급으로 거래·배당·목표를 따로 관리합니다.</p><form id="projectForm" class="form-grid">
      <div><label class="input-label">티커</label><input class="input" name="symbol" maxlength="12" required value="${esc(project?.symbol||'')}"></div>
      <div><label class="input-label">종목명</label><input class="input" name="name" required value="${esc(project?.name||'')}"></div>
      <div><label class="input-label">프로젝트 이름</label><input class="input" name="tag" value="${esc(project?.tag||'배당 프로젝트')}"></div>
      <div class="form-grid two"><div><label class="input-label">목표 주수</label><input class="input" name="targetUnits" type="number" min="0.0001" step="0.0001" required value="${n(project?.targetUnits)||500}"></div><div><label class="input-label">월 매수계획 주수</label><input class="input" name="monthlyPlanShares" type="number" min="0" step="0.0001" value="${n(project?.monthlyPlanShares)}"></div></div>
      <div class="form-grid two"><div><label class="input-label">현재가 USD</label><input class="input" name="currentPrice" type="number" min="0" step="0.0001" value="${n(project?.currentPrice)}"></div><div><label class="input-label">배당 주기</label><select class="input select" name="distributionFrequency"><option value="weekly" ${project?.distributionFrequency==='weekly'?'selected':''}>주배당</option><option value="monthly" ${project?.distributionFrequency!=='weekly'?'selected':''}>월배당</option></select></div></div>
      <div><label class="input-label">프로젝트 시작일</label><input class="input" name="projectStart" type="date" value="${project?.projectStart||todayISO()}"></div>
      <div class="form-grid two"><div><label class="input-label">이전 배당 잔액 USD</label><input class="input" name="initialDividendBalance" type="number" min="0" step="0.01" value="${n(project?.initialDividendBalance)}"></div><div><label class="input-label">잔액 기준일</label><input class="input" name="initialDividendBalanceDate" type="date" value="${project?.initialDividendBalanceDate||''}"></div></div>
      <div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">${edit?'수정 저장':'추가'}</button></div>
      ${edit&&activeProjects().length>1?'<button class="btn soft" type="button" id="archiveProject">프로젝트 보관</button>':''}
    </form>`);
    document.getElementById('projectForm').onsubmit=async event=>{
      event.preventDefault();const form=new FormData(event.currentTarget),symbol=String(form.get('symbol')).trim().toUpperCase();
      if(!symbol){toast('티커를 입력해 주세요.');return;}
      if(!edit&&state.projects.some(x=>x.symbol===symbol&&!x.archived)){toast('이미 등록된 티커입니다.');return;}
      const target=project||blankProject(symbol,String(form.get('name')).trim()||symbol);
      Object.assign(target,{symbol,name:String(form.get('name')).trim()||symbol,tag:String(form.get('tag')).trim()||'배당 프로젝트',targetUnits:Math.max(.0001,n(form.get('targetUnits'))),monthlyPlanShares:Math.max(0,n(form.get('monthlyPlanShares'))),currentPrice:Math.max(0,n(form.get('currentPrice'))),distributionFrequency:form.get('distributionFrequency')==='weekly'?'weekly':'monthly',projectStart:String(form.get('projectStart'))||todayISO(),initialDividendBalance:Math.max(0,n(form.get('initialDividendBalance'))),initialDividendBalanceDate:String(form.get('initialDividendBalanceDate'))||''});
      if(!edit){target.colorIndex=state.projects.length%PROJECT_COLORS.length;state.projects.push(target);selectedProjectId=target.id;}
      await saveState(true);closeModal();renderAll();showPage('projects');toast(edit?'프로젝트를 수정했습니다.':'프로젝트를 추가했습니다.');
    };
    const archive=document.getElementById('archiveProject');if(archive)archive.onclick=()=>confirmAction('프로젝트 보관',`${project.symbol}은 전체 합산에서 숨겨집니다. 기록은 삭제하지 않습니다.`,async()=>{project.archived=true;selectedProjectId=activeProjects()[0]?.id||'';await saveState(true);renderAll();showPage('projects');toast('프로젝트를 보관했습니다.');},'보관');
  }

  function openTradeForm(record=null) {
    const project=projectById(record?.projectId||selectedProjectId),edit=!!record;
    openModal(`<h3 class="modal-title">${project.symbol} ${edit?'거래 수정':'거래 입력'}</h3><p class="modal-desc">모든 원본 금액은 USD로 저장됩니다.</p><form id="tradeForm" class="form-grid">
      <div><label class="input-label">날짜</label><input class="input" name="date" type="date" required value="${record?.date||todayISO()}"></div>
      <div class="form-grid two"><div><label class="input-label">거래</label><select class="input select" name="type"><option value="buy" ${record?.type!=='sell'?'selected':''}>매수</option><option value="sell" ${record?.type==='sell'?'selected':''}>매도</option></select></div><div><label class="input-label">매수 구분</label><select class="input select" name="buyType"><option value="direct" ${record?.buyType==='direct'?'selected':''}>직접매수</option><option value="reinvest" ${record?.buyType==='reinvest'?'selected':''}>배당재투자</option><option value="mixed" ${record?.buyType==='mixed'?'selected':''}>혼합매수</option><option value="opening" ${record?.buyType==='opening'?'selected':''}>초기보유</option></select></div></div>
      <div class="form-grid two"><div><label class="input-label">주수</label><input class="input" name="shares" type="number" min="0.0001" step="0.0001" required value="${n(record?.shares)||1}"></div><div><label class="input-label">단가 USD</label><input class="input" name="price" type="number" min="0" step="0.0001" required value="${record?n(record.price):n(project.currentPrice)}"></div></div>
      <div><label class="input-label">혼합매수 배당 사용액 USD</label><input class="input" name="reinvestAmountUSD" type="number" min="0" step="0.01" value="${n(record?.reinvestAmountUSD)}"></div>
      <div><label class="input-label">메모</label><input class="input" name="note" value="${esc(record?.note||'')}"></div>
      <div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div></form>`);
    document.getElementById('tradeForm').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget),type=form.get('type'),shares=n(form.get('shares')),price=n(form.get('price')),buyType=type==='sell'?'':String(form.get('buyType')),reinvestAmountUSD=buyType==='mixed'?n(form.get('reinvestAmountUSD')):0;if(shares<=0||price<0){toast('주수와 단가를 확인해 주세요.');return;}if(reinvestAmountUSD>shares*price+.0001){toast('배당 사용액이 총 매수액보다 큽니다.');return;}const row=record||{id:uid('t'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()};Object.assign(row,{date:String(form.get('date')),type,buyType,shares,price,reinvestAmountUSD,note:String(form.get('note')).trim()});if(!edit)state.trades.push(row);await saveState(true);closeModal();renderAll();showPage('projects');toast(edit?'거래를 수정했습니다.':'거래를 저장했습니다.');};
  }

  function openDividendForm(record=null) {
    const project=projectById(record?.projectId||selectedProjectId),edit=!!record,calc=computeProject(project);
    openModal(`<h3 class="modal-title">${project.symbol} ${edit?'배당 수정':'배당 입력'}</h3><p class="modal-desc">실제로 입금된 세후 배당금을 기록합니다.</p><form id="dividendForm" class="form-grid">
      <div><label class="input-label">지급일</label><input class="input" name="date" type="date" required value="${record?.date||todayISO()}"></div>
      <div><label class="input-label">세후 배당 USD</label><input class="input" name="amountUSD" type="number" min="0.0001" step="0.01" required value="${n(record?.amountUSD)}"></div>
      <div class="form-grid two"><div><label class="input-label">지급 기준 주수</label><input class="input" name="sharesAtPayment" type="number" min="0" step="0.0001" value="${record?n(record.sharesAtPayment):round(calc.shares,4)}"></div><div><label class="input-label">기준 주가 USD</label><input class="input" name="referencePrice" type="number" min="0" step="0.0001" value="${record?n(record.referencePrice):n(project.currentPrice)}"></div></div>
      <div><label class="input-label">메모</label><input class="input" name="note" value="${esc(record?.note||'')}"></div>
      <div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div></form>`);
    document.getElementById('dividendForm').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget),amountUSD=n(form.get('amountUSD'));if(amountUSD<=0){toast('배당금은 0보다 커야 합니다.');return;}const row=record||{id:uid('d'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()};Object.assign(row,{date:String(form.get('date')),amountUSD,sharesAtPayment:Math.max(0,n(form.get('sharesAtPayment'))),referencePrice:Math.max(0,n(form.get('referencePrice'))),note:String(form.get('note')).trim()});if(!edit)state.dividends.push(row);await saveState(true);closeModal();renderAll();showPage('projects');toast(edit?'배당을 수정했습니다.':'배당을 저장했습니다.');};
  }

  function openCashForm(record=null) {
    const project=projectById(record?.projectId||selectedProjectId),edit=!!record;
    openModal(`<h3 class="modal-title">${project.symbol} 잔액 ${edit?'수정':'보정'}</h3><p class="modal-desc">실제 사용 가능 배당과 앱 잔액이 다를 때만 더하거나 뺍니다.</p><form id="cashForm" class="form-grid"><div><label class="input-label">날짜</label><input class="input" name="date" type="date" value="${record?.date||todayISO()}" required></div><div><label class="input-label">보정액 USD (+/−)</label><input class="input" name="amountUSD" type="number" step="0.01" value="${n(record?.amountUSD)}" required></div><div><label class="input-label">사유</label><input class="input" name="label" value="${esc(record?.label||'잔액 보정')}" required></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div></form>`);
    document.getElementById('cashForm').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget),amountUSD=n(form.get('amountUSD'));if(!amountUSD){toast('0이 아닌 보정액을 입력해 주세요.');return;}const row=record||{id:uid('c'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()};Object.assign(row,{date:String(form.get('date')),amountUSD,label:String(form.get('label')).trim()||'잔액 보정'});if(!edit)state.cashAdjustments.push(row);await saveState(true);closeModal();renderAll();showPage('projects');toast('잔액 보정을 저장했습니다.');};
  }

  function openSplitForm(record=null) {
    const project=projectById(record?.projectId||selectedProjectId),edit=!!record;
    openModal(`<h3 class="modal-title">${project.symbol} 분할·역분할</h3><p class="modal-desc">예: 2주가 1주가 되면 2 → 1입니다. 보유·평균단가·목표가 함께 조정됩니다.</p><form id="splitForm" class="form-grid"><div><label class="input-label">기준일</label><input class="input" name="date" type="date" value="${record?.date||todayISO()}" required></div><div class="form-grid two"><div><label class="input-label">기존 주수</label><input class="input" name="from" type="number" min="0.0001" step="0.0001" value="${n(record?.from)||2}" required></div><div><label class="input-label">변경 주수</label><input class="input" name="to" type="number" min="0.0001" step="0.0001" value="${n(record?.to)||1}" required></div></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">적용</button></div></form>`);
    document.getElementById('splitForm').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget),from=n(form.get('from')),to=n(form.get('to'));if(from<=0||to<=0){toast('분할 비율을 확인해 주세요.');return;}const row=record||{id:uid('s'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()};Object.assign(row,{date:String(form.get('date')),from,to,type:to<from?'reverse':'forward'});if(!edit)state.splits.push(row);await saveState(true);closeModal();renderAll();showPage('projects');toast('분할 비율을 반영했습니다.');};
  }

  function recordByToken(token) {
    const [kind,id]=String(token).split(':');const key={trade:'trades',dividend:'dividends',split:'splits',cash:'cashAdjustments'}[kind];return {kind,key,row:key?state[key].find(x=>String(x.id)===id):null};
  }
  function editRecord(token) { const {kind,row}=recordByToken(token);if(!row)return;if(kind==='trade')openTradeForm(row);if(kind==='dividend')openDividendForm(row);if(kind==='cash')openCashForm(row);if(kind==='split')openSplitForm(row); }
  function deleteRecord(token) { const {key,row}=recordByToken(token);if(!row)return;confirmAction('기록 삭제',`${fmtDate(row.date)} 기록을 삭제합니다.`,async()=>{state[key]=state[key].filter(x=>x.id!==row.id);await saveState(true);renderAll();showPage('projects');toast('기록을 삭제했습니다.');},'삭제'); }

  function projectIssues(projectId=null) {
    const projects=projectId?[projectById(projectId)]:state.projects, issues=[];
    for(const project of projects.filter(Boolean)){
      const calc=computeProject(project),prefix=`${project.symbol}: `;
      if(calc.oversells.length)issues.push(`${prefix}보유량 초과 매도 ${calc.oversells.length}건`);
      if(calc.dividendAvailable<-.0001)issues.push(`${prefix}배당 사용액이 잔액보다 ${fmtMoney(Math.abs(calc.dividendAvailable))} 많음`);
      const badTrade=calc.trades.filter(x=>!isDate(x.date)||n(x.shares)<=0||n(x.price)<0);if(badTrade.length)issues.push(`${prefix}잘못된 거래 ${badTrade.length}건`);
      const badDividend=calc.dividends.filter(x=>!isDate(x.date)||n(x.amountUSD)<=0);if(badDividend.length)issues.push(`${prefix}잘못된 배당 ${badDividend.length}건`);
      const badSplit=projectRows('splits',project.id).filter(x=>!isDate(x.date)||n(x.from)<=0||n(x.to)<=0);if(badSplit.length)issues.push(`${prefix}잘못된 분할 ${badSplit.length}건`);
      const tradeKeys=new Set();let duplicates=0;calc.trades.forEach(x=>{const key=[x.date,x.type,x.buyType,n(x.shares).toFixed(8),n(x.price).toFixed(8)].join('|');if(tradeKeys.has(key))duplicates++;tradeKeys.add(key);});if(duplicates)issues.push(`${prefix}중복 가능 거래 ${duplicates}건`);
    }
    return issues;
  }
  function showIssues(projectId=null) { const issues=projectIssues(projectId);openModal(`<h3 class="modal-title">${projectId?'프로젝트':'전체'} 점검</h3>${issues.length?`<div class="check-list">${issues.map(x=>`<div class="check-item">${esc(x)}</div>`).join('')}</div>`:'<div class="check-ok">오류가 발견되지 않았습니다.</div>'}<button class="btn primary" style="width:100%;margin-top:14px" data-close-modal>확인</button>`); }

  function lockRecovery(projectId) {
    const calc=computeProject(projectId),project=calc.project;
    openModal(`<h3 class="modal-title">${project.symbol} 원금회수 기준</h3><p class="modal-desc">목표 달성 전 직접매수금액에서 매도대금을 뺀 자동 제안값입니다. 확정 후에는 자동으로 바뀌지 않습니다.</p><form id="recoveryForm" class="form-grid"><div><label class="input-label">기준원금 USD</label><input class="input" name="basis" type="number" min="0" step="0.01" value="${round(calc.targetBasisSuggestion,2)}"></div><div><label class="input-label">회수 시작일</label><input class="input" name="startDate" type="date" value="${calc.targetReachedDate||todayISO()}"></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">확정</button></div></form>`);
    document.getElementById('recoveryForm').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget);project.recovery={locked:true,basis:Math.max(0,n(form.get('basis'))),startDate:String(form.get('startDate')),targetReachedDate:calc.targetReachedDate,calculatedBasisAtLock:calc.targetBasisSuggestion,confirmedAt:new Date().toISOString()};await saveState(true);closeModal();renderAll();showPage('goal');toast('원금회수 기준을 확정했습니다.');};
  }

  function downloadFile(filename,content,type='application/octet-stream') { const blob=content instanceof Blob?content:new Blob([content],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500); }
  async function downloadBackup() { try{state.meta.lastBackupAt=new Date().toISOString();await saveState(true);const zip=await buildPortableBackup(clone(state));const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z').replace('T','_');downloadFile(`DividendOS_v${APP_VERSION}_${stamp}.zip`,zip,'application/zip');renderSettings();toast('V4 앱과 데이터를 ZIP으로 저장했습니다.');}catch(error){console.error(error);toast('ZIP 백업 생성에 실패했습니다.');} }
  async function restoreFromFile(file) { try{const parsed=await readStateFromBackupFile(file);const restored=migrate(parsed);if(!restored.projects?.length)throw new Error('invalid');await storageSet(SAFETY_KEY,clone(state));state=restored;selectedProjectId=activeProjects()[0]?.id||'';await saveState(true);renderAll();showPage('home');toast(n(parsed.version)<4?'V3 백업을 V4로 변환해 복원했습니다.':'백업을 복원했습니다.');}catch(error){console.error(error);toast('지원되는 PROJECT1000/DividendOS ZIP이 아닙니다.');} }
  function csvCell(value){const text=String(value??'');return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;}
  function exportCSV(){const rows=[['프로젝트','티커','구분','ID','날짜','유형','세부유형','주수','단가USD','금액USD','메모']];for(const p of state.projects){projectRows('trades',p.id).forEach(x=>rows.push([p.id,p.symbol,'거래',x.id,x.date,x.type,x.buyType,x.shares,x.price,n(x.shares)*n(x.price),x.note]));projectRows('dividends',p.id).forEach(x=>rows.push([p.id,p.symbol,'배당',x.id,x.date,'dividend','','','',x.amountUSD,x.note]));projectRows('splits',p.id).forEach(x=>rows.push([p.id,p.symbol,'분할',x.id,x.date,x.type,'',x.from,x.to,'','']));projectRows('cashAdjustments',p.id).forEach(x=>rows.push([p.id,p.symbol,'잔액보정',x.id,x.date,'cash','','','',x.amountUSD,x.label]));}downloadFile(`DividendOS_${todayISO().replaceAll('-','')}.csv`,'\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\n'),'text/csv;charset=utf-8');toast('CSV를 저장했습니다.');}

  async function chooseInitialSync(cloudState) {
    const localHas=hasMeaningfulData(state),cloudHas=hasMeaningfulData(cloudState);
    if(cloudHas){const localTime=new Date(state.meta?.updatedAt||0).getTime(),cloudTime=new Date(cloudState.meta?.updatedAt||0).getTime();if(localHas&&localTime>cloudTime+3000)return await new Promise(resolve=>{openModal('<h3 class="modal-title">동기화할 데이터 선택</h3><p class="modal-desc">이 기기의 V4 기록이 클라우드보다 새롭습니다.</p><div class="form-grid"><button class="btn primary" id="useLocal">기기 기록 저장</button><button class="btn secondary" id="useCloud">클라우드 불러오기</button></div>');document.getElementById('useLocal').onclick=()=>{closeModal();resolve('local')};document.getElementById('useCloud').onclick=()=>{closeModal();resolve('cloud')};});return 'cloud';}
    return localHas?'local':'blank';
  }
  async function connectCloudForUser(user) {
    currentUser=user;setSaveStatus('동기화 확인','cloud-busy');
    try{
      let cloudData=await getCloudDocument(user.uid),cloudState=cloudData?.state?migrate(cloudData.state):null,usingLegacyCloud=false;
      if(!cloudState){const legacy=await getLegacyCloudDocument(user.uid);if(legacy?.state){cloudState=migrateLegacy(legacy.state);usingLegacyCloud=true;}}
      const choice=await chooseInitialSync(cloudState);
      if(choice==='cloud'&&cloudState){applyingCloudState=true;state=cloudState;await storageSet(STATE_KEY,state);applyingCloudState=false;if(usingLegacyCloud)await pushCloudState();}else await pushCloudState();
      selectedProjectId=activeProjects()[0]?.id||'';renderAll();showPage(currentPage);document.getElementById('authGate')?.classList.add('hidden');
      cloudUnsubscribe?.();cloudUnsubscribe=subscribeCloudDocument(user.uid,data=>{if(!data?.state||applyingCloudState)return;const remote=migrate(data.state),remoteTime=new Date(remote.meta?.updatedAt||0).getTime(),localTime=new Date(state.meta?.updatedAt||0).getTime();if(remoteTime>localTime+1000){applyingCloudState=true;state=remote;storageSet(STATE_KEY,state).then(()=>{renderAll();showPage(currentPage);applyingCloudState=false;setSaveStatus('클라우드 저장','cloud-ok');});}},error=>{console.error(error);setSaveStatus('동기화 오류','cloud-error');});
      setSaveStatus('클라우드 저장','cloud-ok');
    }catch(error){console.error(error);setSaveStatus('연결 오류','cloud-error');document.getElementById('authGate')?.classList.add('hidden');toast('클라우드 연결에 실패했습니다. 기기 저장으로 사용할 수 있습니다.');}
  }
  async function initAuth(){await initGoogleAuth({loginButtonId:'googleLoginBtn',statusElementId:'authGateStatus',onSignedIn:connectCloudForUser,onSignedOut:()=>{currentUser=null;cloudUnsubscribe?.();cloudUnsubscribe=null;setSaveStatus('로그인 필요');document.getElementById('authGate')?.classList.remove('hidden');},onError:message=>toast(message)});}

  function reviewTossCandidates() {
    const candidates=state.integrations.toss.candidates||[];
    if(!candidates.length){toast('검토할 신규 거래가 없습니다.');return;}
    openModal(`<h3 class="modal-title">토스 신규 거래 검토</h3><p class="modal-desc">선택한 거래만 저장합니다. 자동으로 기존 기록을 덮어쓰지 않습니다.</p><form id="tossReviewForm" class="form-grid"><div class="list">${candidates.map((row,index)=>`<label class="list-row"><div><div class="row-title">${esc(row.symbol)} · ${row.type==='sell'?'매도':'매수'} ${fmtShares(row.shares)}주</div><div class="row-sub">${fmtDate(row.date)} · 단가 ${fmtMoney(row.price)}</div></div><input type="checkbox" name="candidate" value="${index}" checked></label>`).join('')}</div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">선택 거래 저장</button></div></form>`);
    document.getElementById('tossReviewForm').onsubmit=async event=>{
      event.preventDefault();const selected=new Set(new FormData(event.currentTarget).getAll('candidate').map(Number));let imported=0;
      candidates.forEach((row,index)=>{
        if(!selected.has(index))return;
        let project=state.projects.find(p=>p.symbol===String(row.symbol).toUpperCase());
        if(!project){project=blankProject(String(row.symbol).toUpperCase(),row.name||row.symbol);project.colorIndex=state.projects.length%PROJECT_COLORS.length;state.projects.push(project);}
        const externalId=String(row.externalId||row.id||'');
        if(externalId&&state.trades.some(t=>t.source?.provider==='toss'&&t.source.externalId===externalId))return;
        state.trades.push({id:uid('t'),projectId:project.id,symbol:project.symbol,date:row.date,type:row.type==='sell'?'sell':'buy',buyType:row.type==='sell'?'':row.buyType||'direct',shares:Math.max(0,n(row.shares)),price:Math.max(0,n(row.price)),reinvestAmountUSD:Math.max(0,n(row.reinvestAmountUSD)),note:row.note||'토스 승인 가져오기',createdAt:new Date().toISOString(),source:{provider:'toss',externalId}});imported++;
      });
      state.integrations.toss.candidates=candidates.filter((_,index)=>!selected.has(index));state.integrations.toss.lastSyncAt=new Date().toISOString();await saveState(true);closeModal();renderAll();toast(`${imported}건을 승인 저장했습니다.`);
    };
  }

  function handleClick(event) {
    const button=event.target.closest('button,[data-open-project]');if(!button)return;
    if(button.dataset.page){showPage(button.dataset.page);return;}
    if(button.dataset.currency){state.settings.displayCurrency=button.dataset.currency;saveState();renderAll();showPage(currentPage);return;}
    if(button.dataset.chartMode){chartMode=button.dataset.chartMode;renderHome();renderProjects();return;}
    if(button.dataset.openProject){selectedProjectId=button.dataset.openProject;recordsExpanded=false;renderProjects();showPage('projects');return;}
    if(button.dataset.selectProject){selectedProjectId=button.dataset.selectProject;recordsExpanded=false;renderProjects();return;}
    if('addProject'in button.dataset){openProjectForm();return;}
    if('projectSettings'in button.dataset){openProjectForm(projectById());return;}
    if('addTrade'in button.dataset){openTradeForm();return;}
    if('addDividend'in button.dataset){openDividendForm();return;}
    if('addCash'in button.dataset){openCashForm();return;}
    if('addSplit'in button.dataset){openSplitForm();return;}
    if(button.dataset.editRecord){editRecord(button.dataset.editRecord);return;}
    if(button.dataset.deleteRecord){deleteRecord(button.dataset.deleteRecord);return;}
    if('toggleRecords'in button.dataset){recordsExpanded=!recordsExpanded;renderProjects();return;}
    if('projectCheck'in button.dataset){showIssues(selectedProjectId);return;}
    if('allCheck'in button.dataset){showIssues();return;}
    if(button.dataset.goalMode){const [id,mode]=button.dataset.goalMode.split(':');const project=projectById(id);if(project){project.afterGoalMode=mode;saveState(true).then(()=>{renderAll();showPage('goal');toast('목표 달성 후 운용 방식을 저장했습니다.');});}return;}
    if(button.dataset.lockRecovery){lockRecovery(button.dataset.lockRecovery);return;}
    if('backup'in button.dataset){downloadBackup();return;}
    if('restore'in button.dataset){document.getElementById('restoreInput').click();return;}
    if('csv'in button.dataset){exportCSV();return;}
    if('reviewToss'in button.dataset){reviewTossCandidates();return;}
    if('logout'in button.dataset){logoutGoogle();return;}
    if('reset'in button.dataset){confirmAction('V4 전체 초기화','V4 거래·배당·프로젝트를 초기화합니다. V3.2.1 원본은 유지됩니다.',async()=>{await storageSet(SAFETY_KEY,clone(state));await storageDelete(STATE_KEY);state=blankState();selectedProjectId=state.projects[0].id;await saveState(true);renderAll();showPage('home');toast('V4 데이터를 초기화했습니다.');},'초기화');return;}
    if('closeModal'in button.dataset){closeModal();return;}
  }

  function bindStaticEvents() {
    document.addEventListener('click',handleClick);
    document.getElementById('modalBackdrop').addEventListener('click',event=>{if(event.target.id==='modalBackdrop')closeModal();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeModal();});
    document.getElementById('restoreInput').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)restoreFromFile(file);event.target.value='';});
    document.addEventListener('submit',event=>{if(event.target.id!=='globalSettingsForm')return;event.preventDefault();const form=new FormData(event.target);Object.assign(state.settings,{exchangeRate:Math.max(0,n(form.get('exchangeRate'))),targetMonthlyDividend:Math.max(0,n(form.get('targetMonthlyDividend'))),warningKRW:Math.max(0,n(form.get('warningKRW'))),thresholdKRW:Math.max(1,n(form.get('thresholdKRW'))),appearance:String(form.get('appearance'))});applyTheme(state.settings.appearance);saveState(true).then(()=>{renderAll();showPage('settings');toast('전체 설정을 저장했습니다.');});});
    matchMedia('(prefers-color-scheme:dark)').addEventListener?.('change',()=>{if(state.settings.appearance==='system')applyTheme('system');});
    window.addEventListener('online',()=>{if(currentUser)pushCloudState();});window.addEventListener('offline',()=>setSaveStatus('오프라인','cloud-error'));
  }

  async function init() {
    try{
      await openStorage();
      const existing=await storageGet(STATE_KEY);
      if(existing)state=migrate(existing);else{const legacy=await readLegacyState();state=legacy?migrateLegacy(legacy):blankState();}
      selectedProjectId=activeProjects()[0]?.id||'';applyTheme(state.settings.appearance);await storageSet(STATE_KEY,state);
      renderAll();bindStaticEvents();showPage('home');await initAuth();hideSplash();
      if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(console.warn);
    }catch(error){console.error(error);document.getElementById('page-home').innerHTML='<article class="card danger"><div class="card-title">저장소를 열 수 없습니다.</div><p class="tiny">일반 브라우저 모드에서 다시 열어 주세요.</p></article>';setSaveStatus('오류','cloud-error');hideSplash();}
  }

  init();
})();
