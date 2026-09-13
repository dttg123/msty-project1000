import { initGoogleAuth, logoutGoogle } from './auth.js';
import { openStorage, storageGet, storageSet, storageDelete, readLegacyState } from './storage.js?v=0.9.6-r23';
import { getCloudDocument, getLegacyCloudDocument, saveCloudDocument, subscribeCloudDocument } from './cloud.js';
import { APP_VERSION, buildPortableBackup, readStateFromBackupFile } from './backup.js';
import { PAGES, PROJECT_COLORS, SAFETY_KEY, STATE_KEY } from './modules/constants.js';
import { blankProject, blankState, migrate, migrateLegacy } from './modules/state.js';
import { createPortfolioEngine } from './modules/portfolio.js';
import { createFormatters } from './modules/format.js';
import { createViews } from './modules/views.js?v=0.9.6-r23';
import { buildMigrationAudit } from './modules/migration.js';
import { buildTossSync, mergeTossCandidates, normalizeTossOrder, tossCandidateToTrade } from './modules/toss.js';
import { clearTossLocalConfig, fetchCurrentPublicIp, fetchTossSnapshot, getTossConnectionMode, getTossLocalConfig, getTossSettingsUrl, isTossBridgeConfigured, saveTossLocalConfig, testTossDirectConnection } from './toss-client.js?v=0.9.6-r23';
import { clamp, clone, esc, isDate, n, round, todayISO, uid } from './modules/utils.js';

(() => {
  'use strict';

  const bootAt = performance.now();

  let state;
  let currentPage = 'home';
  let selectedProjectId = '';
  let chartMode = 'month';
  let recordsExpanded = false;
  let portfolioCategory = 'highYield';
  let currentUser = null;
  let cloudUnsubscribe = null;
  let applyingCloudState = false;
  let saveTimer = null;
  let cloudTimer = null;
  let toastTimer = null;
  let legacyMigrationSource = null;
  let tossSyncRunning = false;
  let tossSetup = { ip:'', busy:'', message:'' };
  let localOnlySession = sessionStorage.getItem('dividend-os-local-mode') === '1';

  const portfolio = createPortfolioEngine(() => state, () => selectedProjectId);
  const { activeProjects, projectById, projectRows, computeProject, recoveryStats, totals } = portfolio;
  const formatters = createFormatters(() => state);
  const { displayCurrency, fmtMoney, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors } = formatters;
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
  function toast(message,{haptic=false}={}) {
    const el=document.getElementById('toast'); clearTimeout(toastTimer); el.textContent=message; el.classList.add('show');
    if(haptic)try{navigator.vibrate?.(18)}catch(_){} toastTimer=setTimeout(()=>el.classList.remove('show'),2300);
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
      await storageSet(STATE_KEY,state); setSaveStatus('','cloud-ok');
    } catch(error) { console.error(error); setSaveStatus('클라우드 오류','cloud-error'); toast('기기에는 저장됐지만 클라우드 저장에 실패했습니다.',{haptic:true}); }
  }
  async function saveState(immediate=false) {
    state.meta.updatedAt=new Date().toISOString(); clearTimeout(saveTimer); clearTimeout(cloudTimer); setSaveStatus('저장 중','cloud-busy');
    const run=async()=>{state.meta.lastLocalSaveAt=new Date().toISOString();await storageSet(STATE_KEY,state);setSaveStatus('');if(currentUser){if(immediate)await pushCloudState();else cloudTimer=setTimeout(pushCloudState,1400);}};
    if(immediate)await run();else saveTimer=setTimeout(()=>run().catch(console.error),120);
  }

  const views = createViews({
    getState:() => state, getSelectedProjectId:() => selectedProjectId, setSelectedProjectId:value => { selectedProjectId=value; },
    getChartMode:() => chartMode, getRecordsExpanded:() => recordsExpanded, getPortfolioCategory:() => portfolioCategory, setPortfolioCategory:value => { portfolioCategory=value; }, getCurrentUser:() => currentUser, isTossBridgeConfigured,
    getTossConnectionMode, getTossLocalConfig, getTossSetup:() => tossSetup,
    activeProjects, projectById, projectRows, computeProject, recoveryStats, totals,
    displayCurrency, fmtMoney, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors
  });
  const { renderHome, renderProjects, renderGoals, renderSettings } = views;
  function auditLegacyAgainstState(raw,targetState) {
    const project=targetState.projects.find(item=>item.symbol==='MSTY')||targetState.projects[0];
    if(!project)return null;
    const engine=createPortfolioEngine(()=>targetState,()=>project.id),calc=engine.computeProject(project);
    return buildMigrationAudit(raw,targetState,calc);
  }
  function prepareLegacyMigration(raw) {
    const candidate=migrateLegacy(raw),audit=auditLegacyAgainstState(raw,candidate);
    candidate.meta.migrationAudit=audit;candidate.meta.legacyMigrationAvailable=false;
    return {candidate,audit};
  }
  function migrationCheckRows(audit) {
    const labels={tradeCount:'거래 건수',dividendCount:'배당 건수',splitCount:'분할 건수',shares:'보유주수',costBasis:'남은 취득원가',marketValue:'평가금액',dividendsTotal:'누적배당',reinvestAmount:'재투자 사용액',dividendAvailable:'사용 가능 배당',currentTarget:'현재 목표주수',recoveryBasis:'원금회수 기준'};
    return audit.checks.filter(check=>labels[check.key]).map(check=>`<div class="list-row"><div><div class="row-title">${labels[check.key]}</div><div class="row-sub">V3 ${typeof check.source==='number'?round(check.source,4):check.source} → V4 ${typeof check.target==='number'?round(check.target,4):check.target}</div></div><div class="row-value ${check.passed?'positive':'negative'}">${check.passed?'일치':'불일치'}</div></div>`).join('');
  }
  async function previewLegacyMigration() {
    legacyMigrationSource=legacyMigrationSource||await readLegacyState();
    if(!legacyMigrationSource){toast('이 기기에서 V3.2.1 데이터를 찾지 못했습니다.');return;}
    const preview=prepareLegacyMigration(legacyMigrationSource),audit=preview.audit;
    openModal(`<h3 class="modal-title">V3.2.1 → V4 이전 점검</h3><p class="modal-desc">V3 원본은 읽기만 합니다. 아래 값이 모두 일치할 때 V4 전용 저장소에 복사합니다.</p><div class="list">${migrationCheckRows(audit)}</div><div class="modal-actions"><button class="btn soft" data-close-modal>취소</button><button class="btn primary" id="confirmLegacyMigration" ${audit.passed?'':'disabled'}>일치 확인 후 복사</button></div>`);
    const confirm=document.getElementById('confirmLegacyMigration');if(confirm)confirm.onclick=async()=>{await storageSet(SAFETY_KEY,clone(state));state=preview.candidate;selectedProjectId=state.projects[0]?.id||'';await saveState(true);closeModal();renderAll();showPage('settings');toast('V3.2.1 데이터를 V4에 복사했습니다.');};
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
  function closeModal() { document.getElementById('modalBackdrop').classList.remove('show');document.getElementById('modal').innerHTML=''; }
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
      <div class="form-grid two"><div><label class="input-label">분류</label><select class="input select" name="category"><option value="highYield" ${project?.category!=='dividend'?'selected':''}>고배당주</option><option value="dividend" ${project?.category==='dividend'?'selected':''}>배당주</option></select></div><div><label class="input-label">카드 색상</label><select class="input select" name="colorIndex">${PROJECT_COLORS.map((_,index)=>`<option value="${index}" ${n(project?.colorIndex)===index?'selected':''}>색상 ${index+1}</option>`).join('')}</select></div></div>
      <div><label class="input-label">목표 주수</label><input class="input" name="targetUnits" type="number" min="0.0001" step="0.0001" required value="${n(project?.targetUnits)||500}"></div>
      <details class="form-advanced"><summary>추가 계산 설정 <span>월 계획 · 현재가 · 배당 주기</span></summary><div class="form-grid">
        <div><label class="input-label">월 매수계획 주수</label><input class="input" name="monthlyPlanShares" type="number" min="0" step="0.0001" value="${n(project?.monthlyPlanShares)}"></div>
        <div class="form-grid two"><div><label class="input-label">현재가 USD</label><input class="input" name="currentPrice" type="number" min="0" step="0.0001" value="${n(project?.currentPrice)}"></div><div><label class="input-label">배당 주기</label><select class="input select" name="distributionFrequency"><option value="weekly" ${project?.distributionFrequency==='weekly'?'selected':''}>주배당</option><option value="monthly" ${project?.distributionFrequency!=='weekly'?'selected':''}>월배당</option></select></div></div>
        <div><label class="input-label">프로젝트 시작일</label><input class="input" name="projectStart" type="date" value="${project?.projectStart||todayISO()}"></div>
        <div class="form-grid two"><div><label class="input-label">이전 배당 잔액 USD</label><input class="input" name="initialDividendBalance" type="number" min="0" step="0.01" value="${n(project?.initialDividendBalance)}"></div><div><label class="input-label">잔액 기준일</label><input class="input" name="initialDividendBalanceDate" type="date" value="${project?.initialDividendBalanceDate||''}"></div></div>
      </div></details>
      <div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">${edit?'수정 저장':'추가'}</button></div>
      ${edit&&activeProjects().length>1?'<button class="btn soft" type="button" id="archiveProject">프로젝트 보관</button>':''}
    </form>`);
    document.getElementById('projectForm').onsubmit=async event=>{
      event.preventDefault();const form=new FormData(event.currentTarget),symbol=String(form.get('symbol')).trim().toUpperCase();
      if(!/^[A-Z0-9.-]{1,16}$/.test(symbol)){toast('티커는 영문·숫자·점·하이픈만 입력해 주세요.');return;}
      if(state.projects.some(x=>x.id!==project?.id&&x.symbol===symbol&&!x.archived)){toast('이미 등록된 티커입니다.');return;}
      const target=project||blankProject(symbol,String(form.get('name')).trim()||symbol);
      const oldSymbol=target.symbol,currentPrice=Math.max(0,n(form.get('currentPrice')));
      Object.assign(target,{symbol,name:String(form.get('name')).trim()||symbol,tag:String(form.get('tag')).trim()||'배당 프로젝트',category:form.get('category')==='dividend'?'dividend':'highYield',colorIndex:Math.max(0,Math.min(PROJECT_COLORS.length-1,Math.floor(n(form.get('colorIndex'))))),targetUnits:Math.max(.0001,n(form.get('targetUnits'))),monthlyPlanShares:Math.max(0,n(form.get('monthlyPlanShares'))),currentPrice,priceSource:'manual',priceUpdatedAt:currentPrice?new Date().toISOString():'',distributionFrequency:form.get('distributionFrequency')==='weekly'?'weekly':'monthly',projectStart:String(form.get('projectStart'))||todayISO(),initialDividendBalance:Math.max(0,n(form.get('initialDividendBalance'))),initialDividendBalanceDate:String(form.get('initialDividendBalanceDate'))||''});
      if(edit&&oldSymbol!==symbol)for(const key of ['trades','dividends','splits','cashAdjustments'])state[key].filter(row=>row.projectId===target.id).forEach(row=>{row.symbol=symbol;});
      if(!edit){target.colorIndex=state.projects.length%PROJECT_COLORS.length;state.projects.push(target);selectedProjectId=target.id;}
      await saveState(true);closeModal();renderAll();showPage('projects');toast(edit?'프로젝트를 수정했습니다.':'프로젝트를 추가했습니다.');
    };
    const archive=document.getElementById('archiveProject');if(archive)archive.onclick=()=>confirmAction('프로젝트 보관',`${project.symbol}은 전체 합산에서 숨겨집니다. 기록은 삭제하지 않습니다.`,async()=>{project.archived=true;selectedProjectId=activeProjects()[0]?.id||'';await saveState(true);renderAll();showPage('projects');toast('프로젝트를 보관했습니다.');},'보관');
  }

  function openTradeForm(record=null) {
    const project=projectById(record?.projectId||selectedProjectId),edit=!!record;
    openModal(`<h3 class="modal-title">${project.symbol} ${edit?'거래 수정':'거래 입력'}</h3><p class="modal-desc">모든 원본 금액은 USD로 저장됩니다.</p><form id="tradeForm" class="form-grid">
      <div><label class="input-label">날짜</label><input class="input" name="date" type="date" required value="${record?.date||todayISO()}"></div>
      <div class="form-grid two"><div><label class="input-label">거래</label><select class="input select" name="type"><option value="buy" ${record?.type!=='sell'?'selected':''}>매수</option><option value="sell" ${record?.type==='sell'?'selected':''}>매도</option></select></div><div data-buy-only><label class="input-label">매수 구분</label><select class="input select" name="buyType"><option value="direct" ${record?.buyType==='direct'?'selected':''}>직접매수</option><option value="reinvest" ${record?.buyType==='reinvest'?'selected':''}>배당재투자</option><option value="mixed" ${record?.buyType==='mixed'?'selected':''}>혼합매수</option><option value="opening" ${record?.buyType==='opening'?'selected':''}>초기보유</option></select></div></div>
      <div class="form-grid two"><div><label class="input-label">주수</label><input class="input" name="shares" type="number" min="0.0001" step="0.0001" required value="${n(record?.shares)||1}"></div><div><label class="input-label">단가 USD</label><input class="input" name="price" type="number" min="0" step="0.0001" required value="${record?n(record.price):n(project.currentPrice)}"></div></div>
      <div data-mixed-only><label class="input-label">혼합매수 배당 사용액 USD</label><input class="input" name="reinvestAmountUSD" type="number" min="0" step="0.01" value="${n(record?.reinvestAmountUSD)}"></div>
      <div><label class="input-label">메모</label><input class="input" name="note" value="${esc(record?.note||'')}"></div>
      <div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div></form>`);
    const tradeForm=document.getElementById('tradeForm'),typeInput=tradeForm.elements.type,buyTypeInput=tradeForm.elements.buyType;
    const syncTradeFields=()=>{const selling=typeInput.value==='sell';tradeForm.querySelector('[data-buy-only]').hidden=selling;tradeForm.querySelector('[data-mixed-only]').hidden=selling||buyTypeInput.value!=='mixed';};
    typeInput.onchange=syncTradeFields;buyTypeInput.onchange=syncTradeFields;syncTradeFields();
    tradeForm.onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget),date=String(form.get('date')),type=form.get('type'),shares=n(form.get('shares')),price=n(form.get('price')),buyType=type==='sell'?'':String(form.get('buyType')),reinvestAmountUSD=buyType==='mixed'?n(form.get('reinvestAmountUSD')):0;if(!isDate(date)||shares<=0||price<0){toast('날짜·주수·단가를 확인해 주세요.');return;}if(reinvestAmountUSD>shares*price+.0001){toast('배당 사용액이 총 매수액보다 큽니다.');return;}const row=record||{id:uid('t'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()},before=record?clone(record):null;Object.assign(row,{date,type,buyType,shares,price,reinvestAmountUSD,note:String(form.get('note')).trim()});if(!edit)state.trades.push(row);const invalid=computeProject(project).oversells.length;if(invalid){if(edit)Object.assign(row,before);else state.trades=state.trades.filter(item=>item!==row);toast('이 거래를 반영하면 해당 날짜의 보유주수보다 많이 매도하게 됩니다.');return;}await saveState(true);closeModal();renderAll();showPage('projects');toast(edit?'거래를 수정했습니다.':'거래를 저장했습니다.');};
  }

  function openDividendForm(record=null) {
    const project=projectById(record?.projectId||selectedProjectId),edit=!!record,calc=computeProject(project),returnPage=currentPage==='dividend'?'dividend':'projects';
    openModal(`<h3 class="modal-title">${project.symbol} ${edit?'배당 수정':'배당 입력'}</h3><p class="modal-desc">실제로 입금된 세후 배당금을 기록합니다.</p><form id="dividendForm" class="form-grid">
      <div><label class="input-label">지급일</label><input class="input" name="date" type="date" required value="${record?.date||todayISO()}"></div>
      <div><label class="input-label">세후 배당 USD</label><input class="input" name="amountUSD" type="number" min="0.01" step="0.01" required value="${n(record?.amountUSD)}"></div>
      <div class="form-grid two"><div><label class="input-label">지급 기준 주수</label><input class="input" name="sharesAtPayment" type="number" min="0" step="0.0001" value="${record?n(record.sharesAtPayment):round(calc.shares,4)}"></div><div><label class="input-label">기준 주가 USD</label><input class="input" name="referencePrice" type="number" min="0" step="0.0001" value="${record?n(record.referencePrice):n(project.currentPrice)}"></div></div>
      <div><label class="input-label">메모</label><input class="input" name="note" value="${esc(record?.note||'')}"></div>
      <div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div></form>`);
    document.getElementById('dividendForm').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget),date=String(form.get('date')),amountUSD=n(form.get('amountUSD'));if(!isDate(date)||amountUSD<=0){toast('지급일과 배당금을 확인해 주세요.');return;}const row=record||{id:uid('d'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()};Object.assign(row,{date,amountUSD,sharesAtPayment:Math.max(0,n(form.get('sharesAtPayment'))),referencePrice:Math.max(0,n(form.get('referencePrice'))),note:String(form.get('note')).trim()});if(!edit)state.dividends.push(row);await saveState(true);closeModal();renderAll();showPage(returnPage);toast(edit?'배당을 수정했습니다.':'배당을 저장했습니다.');};
  }

  function openCashForm(record=null) {
    const project=projectById(record?.projectId||selectedProjectId),edit=!!record;
    openModal(`<h3 class="modal-title">${project.symbol} 잔액 ${edit?'수정':'보정'}</h3><p class="modal-desc">실제 사용 가능 배당과 앱 잔액이 다를 때만 더하거나 뺍니다.</p><form id="cashForm" class="form-grid"><div><label class="input-label">날짜</label><input class="input" name="date" type="date" value="${record?.date||todayISO()}" required></div><div><label class="input-label">보정액 USD (+/−)</label><input class="input" name="amountUSD" type="number" step="0.01" value="${n(record?.amountUSD)}" required></div><div><label class="input-label">사유</label><input class="input" name="label" value="${esc(record?.label||'잔액 보정')}" required></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div></form>`);
    document.getElementById('cashForm').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget),date=String(form.get('date')),amountUSD=n(form.get('amountUSD'));if(!isDate(date)||!amountUSD){toast('날짜와 0이 아닌 보정액을 입력해 주세요.');return;}const row=record||{id:uid('c'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()};Object.assign(row,{date,amountUSD,label:String(form.get('label')).trim()||'잔액 보정'});if(!edit)state.cashAdjustments.push(row);await saveState(true);closeModal();renderAll();showPage('projects');toast('잔액 보정을 저장했습니다.');};
  }

  function openSplitForm(record=null) {
    const project=projectById(record?.projectId||selectedProjectId),edit=!!record;
    openModal(`<h3 class="modal-title">${project.symbol} 분할·역분할</h3><p class="modal-desc">예: 2주가 1주가 되면 2 → 1입니다. 보유·평균단가·목표가 함께 조정됩니다.</p><form id="splitForm" class="form-grid"><div><label class="input-label">기준일</label><input class="input" name="date" type="date" value="${record?.date||todayISO()}" required></div><div class="form-grid two"><div><label class="input-label">기존 주수</label><input class="input" name="from" type="number" min="0.0001" step="0.0001" value="${n(record?.from)||2}" required></div><div><label class="input-label">변경 주수</label><input class="input" name="to" type="number" min="0.0001" step="0.0001" value="${n(record?.to)||1}" required></div></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">적용</button></div></form>`);
    document.getElementById('splitForm').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget),date=String(form.get('date')),from=n(form.get('from')),to=n(form.get('to'));if(!isDate(date)||from<=0||to<=0){toast('분할 날짜와 비율을 확인해 주세요.');return;}const row=record||{id:uid('s'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()},before=record?clone(record):null;Object.assign(row,{date,from,to,type:to<from?'reverse':'forward'});if(!edit)state.splits.push(row);if(computeProject(project).oversells.length){if(edit)Object.assign(row,before);else state.splits=state.splits.filter(item=>item!==row);toast('이 분할을 반영하면 이후 매도 기록이 보유주수를 초과합니다.');return;}await saveState(true);closeModal();renderAll();showPage('projects');toast('분할 비율을 반영했습니다.');};
  }

  function recordByToken(token) {
    const [kind,id]=String(token).split(':');const key={trade:'trades',dividend:'dividends',split:'splits',cash:'cashAdjustments'}[kind];return {kind,key,row:key?state[key].find(x=>String(x.id)===id):null};
  }
  function editRecord(token) { const {kind,row}=recordByToken(token);if(!row)return;if(kind==='trade')openTradeForm(row);if(kind==='dividend')openDividendForm(row);if(kind==='cash')openCashForm(row);if(kind==='split')openSplitForm(row); }
  function deleteRecord(token) { const {key,row}=recordByToken(token);if(!row)return;confirmAction('기록 삭제',`${fmtDate(row.date)} 기록을 삭제합니다.`,async()=>{await storageSet(SAFETY_KEY,clone(state));const previous=state[key];state[key]=state[key].filter(x=>x.id!==row.id);if((key==='trades'||key==='splits')&&computeProject(row.projectId).oversells.length){state[key]=previous;toast('이 기록을 삭제하면 이후 매도가 보유주수를 초과하므로 삭제하지 않았습니다.');return;}await saveState(true);renderAll();showPage('projects');toast('기록을 삭제했습니다.');},'삭제'); }

  function projectIssues(projectId=null) {
    const projects=projectId?[projectById(projectId)]:state.projects, issues=[];
    for(const project of projects.filter(Boolean)){
      const calc=computeProject(project),prefix=`${project.symbol}: `;
      if(calc.oversells.length)issues.push(`${prefix}보유량 초과 매도 ${calc.oversells.length}건`);
      if(calc.cashDeficitEvents.length)issues.push(`${prefix}날짜순 배당 원장에서 잔액 부족 ${calc.cashDeficitEvents.length}건 · 최대 ${fmtMoney(Math.abs(calc.minDividendBalance))}`);
      if(!calc.priceAvailable&&calc.shares>0)issues.push(`${prefix}현재가 미입력으로 평가금액·총손익 계산 대기`);
      const futureCount=['trades','dividends','splits','cashAdjustments'].reduce((count,key)=>count+projectRows(key,project.id).filter(row=>String(row.date)>todayISO()).length,0);if(futureCount)issues.push(`${prefix}현재 계산에서 제외된 미래 날짜 기록 ${futureCount}건`);
      const badTrade=calc.trades.filter(x=>!isDate(x.date)||n(x.shares)<=0||n(x.price)<0);if(badTrade.length)issues.push(`${prefix}잘못된 거래 ${badTrade.length}건`);
      const badDividend=calc.dividends.filter(x=>!isDate(x.date)||n(x.amountUSD)<=0);if(badDividend.length)issues.push(`${prefix}잘못된 배당 ${badDividend.length}건`);
      const badSplit=projectRows('splits',project.id).filter(x=>!isDate(x.date)||n(x.from)<=0||n(x.to)<=0);if(badSplit.length)issues.push(`${prefix}잘못된 분할 ${badSplit.length}건`);
      const tradeKeys=new Set();let duplicates=0;calc.trades.forEach(x=>{const key=[x.date,x.type,x.buyType,n(x.shares).toFixed(8),n(x.price).toFixed(8)].join('|');if(tradeKeys.has(key))duplicates++;tradeKeys.add(key);});if(duplicates)issues.push(`${prefix}중복 가능 거래 ${duplicates}건`);
      const dividendKeys=new Set();let duplicateDividends=0;calc.dividends.forEach(x=>{const key=[x.date,n(x.amountUSD).toFixed(2),n(x.sharesAtPayment).toFixed(4)].join('|');if(dividendKeys.has(key))duplicateDividends++;dividendKeys.add(key);});if(duplicateDividends)issues.push(`${prefix}중복 가능 배당 ${duplicateDividends}건`);
    }
    return issues;
  }
  function showIssues(projectId=null) { const issues=projectIssues(projectId);openModal(`<h3 class="modal-title">${projectId?'프로젝트':'전체'} 점검</h3>${issues.length?`<div class="check-list">${issues.map(x=>`<div class="check-item">${esc(x)}</div>`).join('')}</div>`:'<div class="check-ok">오류가 발견되지 않았습니다.</div>'}<button class="btn primary" style="width:100%;margin-top:14px" data-close-modal>확인</button>`); }

  function lockRecovery(projectId,editing=false) {
    const calc=computeProject(projectId),project=calc.project;
    const basis=editing&&project.recovery?.locked?n(project.recovery.basis):calc.targetBasisSuggestion,startDate=editing&&project.recovery?.locked?project.recovery.startDate:(calc.targetReachedDate||todayISO());
    openModal(`<h3 class="modal-title">${project.symbol} 원금회수 기준 ${editing?'수정':'확정'}</h3><p class="modal-desc">직접매수 원금에서 목표 달성 전 매도 회수액을 뺀 제안값입니다. 확정 뒤 기록을 바꾸어도 기준은 자동 변경되지 않습니다.</p><form id="recoveryForm" class="form-grid"><div><label class="input-label">기준원금 USD</label><input class="input" name="basis" type="number" min="0.01" step="0.01" required value="${round(basis,2)}"></div><div><label class="input-label">회수 시작일</label><input class="input" name="startDate" type="date" required value="${startDate}"></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">${editing?'수정 저장':'확정'}</button></div></form>`);
    document.getElementById('recoveryForm').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.currentTarget),nextBasis=n(form.get('basis')),nextStartDate=String(form.get('startDate'));if(nextBasis<=0||!isDate(nextStartDate)){toast('기준원금과 시작일을 확인해 주세요.');return;}project.recovery={locked:true,basis:nextBasis,startDate:nextStartDate,targetReachedDate:calc.targetReachedDate||project.recovery?.targetReachedDate||nextStartDate,calculatedBasisAtLock:calc.targetBasisSuggestion,confirmedAt:new Date().toISOString()};await saveState(true);closeModal();renderAll();showPage('goal');toast(editing?'원금회수 기준을 수정했습니다.':'원금회수 기준을 확정했습니다.');};
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
      if(!cloudState){const legacy=await getLegacyCloudDocument(user.uid);if(legacy?.state){legacyMigrationSource=legacy.state;cloudState=prepareLegacyMigration(legacy.state).candidate;usingLegacyCloud=true;}}
      else if(!cloudState.meta?.migrationAudit){const legacy=await getLegacyCloudDocument(user.uid);if(legacy?.state){legacyMigrationSource=legacy.state;const audit=auditLegacyAgainstState(legacy.state,cloudState);if(audit?.passed)cloudState.meta.migrationAudit=audit;else cloudState.meta.legacyMigrationAvailable=true;}}
      const choice=await chooseInitialSync(cloudState);
      if(choice==='cloud'&&cloudState){applyingCloudState=true;state=cloudState;await storageSet(STATE_KEY,state);applyingCloudState=false;if(usingLegacyCloud)await pushCloudState();}else await pushCloudState();
      selectedProjectId=activeProjects()[0]?.id||'';renderAll();showPage(currentPage);document.getElementById('authGate')?.classList.add('hidden');
      cloudUnsubscribe?.();cloudUnsubscribe=subscribeCloudDocument(user.uid,data=>{if(!data?.state||applyingCloudState)return;const remote=migrate(data.state),remoteTime=new Date(remote.meta?.updatedAt||0).getTime(),localTime=new Date(state.meta?.updatedAt||0).getTime();if(remoteTime>localTime+1000){applyingCloudState=true;state=remote;storageSet(STATE_KEY,state).then(()=>{renderAll();showPage(currentPage);applyingCloudState=false;setSaveStatus('','cloud-ok');});}},error=>{console.error(error);setSaveStatus('동기화 오류','cloud-error');});
      setSaveStatus('','cloud-ok');
    }catch(error){console.error(error);setSaveStatus('연결 오류','cloud-error');document.getElementById('authGate')?.classList.add('hidden');toast('클라우드 연결에 실패했습니다. 기기 저장으로 사용할 수 있습니다.');}
  }
  async function initAuth(){await initGoogleAuth({loginButtonId:'googleLoginBtn',statusElementId:'authGateStatus',onSignedIn:connectCloudForUser,onSignedOut:()=>{currentUser=null;cloudUnsubscribe?.();cloudUnsubscribe=null;setSaveStatus(localOnlySession?'':'로그인 필요');document.getElementById('authGate')?.classList.toggle('hidden',localOnlySession);},onError:message=>toast(message,{haptic:true})});}

  function refreshTossComparisons() {
    const toss=state.integrations.toss;
    toss.comparisons=(toss.comparisons||[]).map(row=>{
      const project=state.projects.find(item=>item.symbol===row.symbol&&!item.archived);
      const appShares=project?computeProject(project).shares:0;
      return {...row,appShares,difference:n(row.shares)-appShares};
    });
  }

  async function showCurrentTossIp() {
    if(tossSetup.busy)return;
    tossSetup={...tossSetup,busy:'ip',message:''};renderSettings();showPage('settings');
    try{tossSetup={ip:await fetchCurrentPublicIp(),busy:'',message:'이 IP를 토스 허용 IP에 등록해 주세요.'};}
    catch(error){tossSetup={...tossSetup,busy:'',message:error?.message||'현재 IP 확인에 실패했습니다.'};}
    renderSettings();showPage('settings');
  }

  async function copyTossIp() {
    if(!tossSetup.ip){await showCurrentTossIp();if(!tossSetup.ip)return;}
    try{await navigator.clipboard.writeText(tossSetup.ip);toast('현재 IP를 복사했습니다.');}
    catch(_){openModal(`<h3 class="modal-title">현재 IP</h3><p class="modal-desc">길게 눌러 복사한 뒤 토스 허용 IP에 붙여넣으세요.</p><input class="input" readonly value="${esc(tossSetup.ip)}" onclick="this.select()"><button class="btn primary" style="width:100%;margin-top:12px" data-close-modal>확인</button>`);}
  }

  async function testTossBrowser() {
    if(tossSetup.busy)return;
    tossSetup={...tossSetup,busy:'test',message:'토스 브라우저 연결을 확인하고 있습니다.'};renderSettings();showPage('settings');
    try{
      const result=await testTossDirectConnection();
      tossSetup={...tossSetup,busy:'',message:`직접 연결 성공 · 계좌 ${result.accountCount}개 확인`};
      state.integrations.toss.status='not_connected';state.integrations.toss.lastError='';
      toast('토스 직접 연결에 성공했습니다.');
    }catch(error){
      tossSetup={...tossSetup,busy:'',message:error?.message||'토스 연결 시험에 실패했습니다.'};
      state.integrations.toss.status='error';state.integrations.toss.lastError=tossSetup.message;
      toast(tossSetup.message);
    }
    renderSettings();showPage('settings');
  }

  async function syncTossReadOnly() {
    if(tossSyncRunning)return;
    tossSyncRunning=true;
    const toss=state.integrations.toss;
    toss.status='syncing';toss.lastError='';renderSettings();showPage('settings');
    try{
      const snapshot=await fetchTossSnapshot({symbols:activeProjects().map(project=>project.symbol)});
      const appPositions=activeProjects().map(project=>({symbol:project.symbol,shares:computeProject(project).shares}));
      const result=buildTossSync(snapshot,{existingTrades:state.trades,appPositions});
      Object.assign(toss,{status:'connected',lastSyncAt:result.fetchedAt,lastError:'',accountLabel:result.accountLabel,holdings:result.holdings,comparisons:result.comparisons,ignoredCount:result.ignoredCount,matchedExistingCount:result.matchedExistingCount,unsupportedCurrencyCount:result.unsupportedCurrencyCount,historyTruncated:result.historyTruncated,candidates:mergeTossCandidates(toss.candidates,result.candidates)});
      for(const price of result.prices||[]){
        if(price.currency!=='USD')continue;
        const project=state.projects.find(item=>item.symbol===price.symbol&&!item.archived);
        if(project){project.currentPrice=price.lastPrice;project.priceSource='toss';project.priceUpdatedAt=price.timestamp||new Date().toISOString();}
      }
      await saveState(true);renderAll();showPage('settings');toast(result.candidates.length?`토스 신규 체결 ${result.candidates.length}건을 찾았습니다.`:'토스 계좌와 대조했습니다. 신규 체결은 없습니다.');
    }catch(error){
      console.error('Toss read-only sync error',error);toss.status='error';toss.lastError=error?.message||'토스 조회에 실패했습니다.';await saveState();renderSettings();showPage('settings');toast(toss.lastError);
    }finally{tossSyncRunning=false;if(state.integrations.toss.status==='syncing')state.integrations.toss.status='not_connected';renderSettings();showPage('settings');}
  }

  function reviewTossCandidates() {
    const candidates=mergeTossCandidates(state.integrations.toss.candidates||[],[]);state.integrations.toss.candidates=candidates;
    if(!candidates.length){toast('검토할 신규 거래가 없습니다.');return;}
    openModal(`<h3 class="modal-title">토스 신규 거래 검토</h3><p class="modal-desc">선택한 거래만 저장합니다. 자동으로 기존 기록을 덮어쓰지 않습니다.</p><form id="tossReviewForm" class="form-grid"><div class="list">${candidates.map((row,index)=>`<label class="list-row"><div><div class="row-title">${esc(row.symbol)} · ${row.type==='sell'?'매도':'매수'} ${fmtShares(row.shares)}주</div><div class="row-sub">${fmtDate(row.date)} · 단가 ${fmtMoney(row.price)}</div></div><input type="checkbox" name="candidate" value="${index}" checked></label>`).join('')}</div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">선택 거래 저장</button></div></form>`);
    document.getElementById('tossReviewForm').onsubmit=async event=>{
      event.preventDefault();const selected=new Set(new FormData(event.currentTarget).getAll('candidate').map(Number));
      if(!selected.size){toast('저장할 거래를 선택해 주세요.');return;}
      const projectsBefore=clone(state.projects),tradesBefore=clone(state.trades),importedIds=new Set(),affectedProjectIds=new Set();let imported=0;
      candidates.forEach((row,index)=>{
        if(!selected.has(index))return;
        const normalized=normalizeTossOrder(row);if(!normalized||normalized.currency!=='USD')return;
        let project=state.projects.find(p=>p.symbol===normalized.symbol);
        if(!project){project=blankProject(normalized.symbol,normalized.name);project.colorIndex=state.projects.length%PROJECT_COLORS.length;state.projects.push(project);}
        const externalId=normalized.externalId;
        if(externalId&&state.trades.some(t=>t.source?.provider==='toss'&&t.source.externalId===externalId))return;
        const trade=tossCandidateToTrade(normalized,{projectId:project.id,id:uid('t')});if(trade){state.trades.push(trade);importedIds.add(externalId);affectedProjectIds.add(project.id);imported++;}
      });
      const invalid=[...affectedProjectIds].some(projectId=>computeProject(projectId).oversells.length);
      if(invalid){state.projects=projectsBefore;state.trades=tradesBefore;toast('선택한 거래 조합은 과매도를 만들 수 있어 저장하지 않았습니다. 매수 기록도 함께 선택해 주세요.');return;}
      if(!imported){state.projects=projectsBefore;state.trades=tradesBefore;toast('저장 가능한 신규 거래가 없습니다.');return;}
      state.integrations.toss.candidates=candidates.filter(row=>!importedIds.has(String(row?.externalId||'')));state.integrations.toss.lastSyncAt=new Date().toISOString();refreshTossComparisons();await saveState(true);closeModal();renderAll();showPage('settings');toast(`${imported}건을 승인 저장했습니다.`);
    };
  }

  function handleClick(event) {
    const button=event.target.closest('button,[data-open-project],[data-goal-detail]');if(!button)return;
    if(button.dataset.page){showPage(button.dataset.page);return;}
    if(button.dataset.currency){if(state.settings.displayCurrency===button.dataset.currency)return;state.settings.displayCurrency=button.dataset.currency;saveState();renderAll();showPage(currentPage);return;}
    if(button.dataset.chartMode){chartMode=button.dataset.chartMode;renderHome();renderProjects();return;}
    if(button.dataset.portfolioCategory){portfolioCategory=button.dataset.portfolioCategory;const first=activeProjects().find(project=>project.category===portfolioCategory);if(first)selectedProjectId=first.id;recordsExpanded=false;renderProjects();return;}
    if(button.dataset.goalDetail){selectedProjectId=button.dataset.goalDetail;renderGoals();showPage('goal');return;}
    if(button.dataset.settingsProject){selectedProjectId=button.dataset.settingsProject;openProjectForm(projectById(selectedProjectId));return;}
    if(button.dataset.openProject){selectedProjectId=button.dataset.openProject;recordsExpanded=false;renderProjects();showPage('projects');return;}
    if(button.dataset.selectProject){selectedProjectId=button.dataset.selectProject;recordsExpanded=false;renderProjects();return;}
    if('addProject'in button.dataset){openProjectForm();return;}
    if('projectSettings'in button.dataset){openProjectForm(projectById());return;}
    if('addTrade'in button.dataset){openTradeForm();return;}
    if('addDividend'in button.dataset){openDividendForm();return;}
    if(button.dataset.addDividendFor){selectedProjectId=button.dataset.addDividendFor;openDividendForm();return;}
    if('addCash'in button.dataset){openCashForm();return;}
    if('addSplit'in button.dataset){openSplitForm();return;}
    if(button.dataset.editRecord){editRecord(button.dataset.editRecord);return;}
    if(button.dataset.deleteRecord){deleteRecord(button.dataset.deleteRecord);return;}
    if('toggleRecords'in button.dataset){recordsExpanded=!recordsExpanded;renderProjects();return;}
    if('projectCheck'in button.dataset){showIssues(selectedProjectId);return;}
    if('allCheck'in button.dataset){showIssues();return;}
    if(button.dataset.goalMode){const [id,mode]=button.dataset.goalMode.split(':');const project=projectById(id);if(!project||project.afterGoalMode===mode)return;project.afterGoalMode=mode;saveState(true).then(()=>{renderAll();showPage('goal');toast('목표 달성 후 운용 방식을 저장했습니다.');});return;}
    if(button.dataset.lockRecovery){lockRecovery(button.dataset.lockRecovery);return;}
    if(button.dataset.editRecovery){lockRecovery(button.dataset.editRecovery,true);return;}
    if(button.dataset.restoreProject){const project=projectById(button.dataset.restoreProject);if(project){project.archived=false;selectedProjectId=project.id;saveState(true).then(()=>{renderAll();showPage('projects');toast('프로젝트를 복원했습니다.');});}return;}
    if('localMode'in button.dataset){localOnlySession=true;sessionStorage.setItem('dividend-os-local-mode','1');document.getElementById('authGate')?.classList.add('hidden');setSaveStatus('');return;}
    if('showLogin'in button.dataset){localOnlySession=false;sessionStorage.removeItem('dividend-os-local-mode');document.getElementById('authGate')?.classList.remove('hidden');return;}
    if('backup'in button.dataset){downloadBackup();return;}
    if('restore'in button.dataset){document.getElementById('restoreInput').click();return;}
    if('csv'in button.dataset){exportCSV();return;}
    if('checkTossIp'in button.dataset){showCurrentTossIp();return;}
    if('copyTossIp'in button.dataset){copyTossIp();return;}
    if('openTossSettings'in button.dataset){window.open(getTossSettingsUrl(),'_blank','noopener,noreferrer');return;}
    if('testTossDirect'in button.dataset){testTossBrowser();return;}
    if('clearTossDirect'in button.dataset){confirmAction('토스 연결정보 삭제','이 기기에 저장된 Client ID와 Secret만 삭제합니다.',async()=>{clearTossLocalConfig();tossSetup={ip:tossSetup.ip,busy:'',message:'이 기기의 토스 연결정보를 삭제했습니다.'};state.integrations.toss.status='not_connected';state.integrations.toss.lastError='';renderSettings();showPage('settings');toast('토스 연결정보를 삭제했습니다.');},'삭제');return;}
    if('syncToss'in button.dataset){syncTossReadOnly();return;}
    if('reviewToss'in button.dataset){reviewTossCandidates();return;}
    if('migrateV3'in button.dataset){previewLegacyMigration();return;}
    if('logout'in button.dataset){localOnlySession=false;sessionStorage.removeItem('dividend-os-local-mode');logoutGoogle();return;}
    if('reset'in button.dataset){confirmAction('V4 전체 초기화','V4 거래·배당·프로젝트를 초기화합니다. V3.2.1 원본은 유지됩니다.',async()=>{await storageSet(SAFETY_KEY,clone(state));await storageDelete(STATE_KEY);state=blankState();selectedProjectId=state.projects[0].id;await saveState(true);renderAll();showPage('home');toast('V4 데이터를 초기화했습니다.');},'초기화');return;}
    if('closeModal'in button.dataset){closeModal();return;}
  }

  function bindStaticEvents() {
    document.addEventListener('submit',event=>{
      const form=event.target;if(!(form instanceof HTMLFormElement))return;
      const futureDate=[...form.querySelectorAll('input[type="date"]')].find(input=>input.value&&input.value>todayISO());
      if(futureDate){event.preventDefault();event.stopImmediatePropagation();futureDate.setCustomValidity('미래 날짜는 실제 기록으로 저장할 수 없습니다.');futureDate.reportValidity();setTimeout(()=>futureDate.setCustomValidity(''),1200);return;}
      if(form.dataset.submitting==='true'){event.preventDefault();event.stopImmediatePropagation();return;}
      form.dataset.submitting='true';
      setTimeout(()=>{if(!form.isConnected)return;delete form.dataset.submitting;},800);
    },true);
    document.addEventListener('click',handleClick);
    document.getElementById('modalBackdrop').addEventListener('click',event=>{if(event.target.id==='modalBackdrop')closeModal();});
    document.addEventListener('keydown',event=>{const card=event.target.closest?.('[data-open-project],[data-goal-detail]');if(card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();card.click();return;}if(event.key==='Escape')closeModal();});
    document.getElementById('restoreInput').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)restoreFromFile(file);event.target.value='';});
    document.addEventListener('submit',event=>{if(event.target.id!=='globalSettingsForm')return;event.preventDefault();const form=new FormData(event.target),thresholdKRW=Math.max(1,n(form.get('thresholdKRW'))),warningKRW=Math.min(thresholdKRW,Math.max(0,n(form.get('warningKRW')))),next={exchangeRate:Math.max(0,n(form.get('exchangeRate'))),exchangeRateMode:form.get('exchangeRateMode')==='auto'?'auto':'manual',targetMonthlyDividend:Math.max(0,n(form.get('targetMonthlyDividend'))),warningKRW,thresholdKRW,appearance:String(form.get('appearance'))};if(Object.keys(next).every(key=>state.settings[key]===next[key])){toast('바뀐 설정이 없습니다.');return;}Object.assign(state.settings,next);applyTheme(state.settings.appearance);saveState(true).then(()=>{renderAll();showPage('settings');toast('전체 설정을 저장했습니다.');});});
    document.addEventListener('submit',event=>{if(event.target.id!=='tossDirectForm')return;event.preventDefault();try{const form=new FormData(event.target);saveTossLocalConfig({clientId:form.get('clientId'),clientSecret:form.get('clientSecret')});tossSetup={...tossSetup,message:'이 기기에만 저장했습니다. 현재 IP 등록 후 연결 시험을 눌러 주세요.'};state.integrations.toss.status='not_connected';state.integrations.toss.lastError='';renderSettings();showPage('settings');toast('토스 연결정보를 기기에 저장했습니다.');}catch(error){toast(error?.message||'토스 연결정보를 저장하지 못했습니다.');}});
    matchMedia('(prefers-color-scheme:dark)').addEventListener?.('change',()=>{if(state.settings.appearance==='system')applyTheme('system');});
    window.addEventListener('online',()=>{if(currentUser)pushCloudState();});window.addEventListener('offline',()=>setSaveStatus('오프라인','cloud-error'));
  }

  async function init() {
    try{
      await openStorage();
      const existing=await storageGet(STATE_KEY);
      legacyMigrationSource=await readLegacyState();
      if(existing){state=migrate(existing);if(legacyMigrationSource&&!state.meta.migrationAudit){const audit=auditLegacyAgainstState(legacyMigrationSource,state);if(audit?.passed)state.meta.migrationAudit=audit;else state.meta.legacyMigrationAvailable=true;}}
      else if(legacyMigrationSource)state=prepareLegacyMigration(legacyMigrationSource).candidate;
      else state=blankState();
      selectedProjectId=activeProjects()[0]?.id||'';applyTheme(state.settings.appearance);await storageSet(STATE_KEY,state);
      renderAll();bindStaticEvents();showPage('home');await initAuth();hideSplash();
      if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js?v=0.9.6-r23').catch(console.warn);
    }catch(error){console.error(error);document.getElementById('page-home').innerHTML='<article class="card danger"><div class="card-title">저장소를 열 수 없습니다.</div><p class="tiny">일반 브라우저 모드에서 다시 열어 주세요.</p></article>';setSaveStatus('오류','cloud-error');hideSplash();}
  }

  init();
})();
