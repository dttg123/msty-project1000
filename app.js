import { initGoogleAuth, logoutGoogle } from './auth.js';
import { openStorage, storageGet, storageSet, storageDelete, readLegacyState } from './storage.js';
import { getCloudDocument, getLegacyCloudDocument, saveCloudDocument, subscribeCloudDocument } from './cloud.js';
import { APP_VERSION, buildPortableBackup, readStateFromBackupFile } from './backup.js';
import { PAGES, PROJECT_COLORS, SAFETY_KEY, STATE_KEY } from './modules/constants.js';
import { blankProject, blankState, migrate, migrateLegacy } from './modules/state.js';
import { createPortfolioEngine } from './modules/portfolio.js';
import { createFormatters } from './modules/format.js';
import { createViews } from './modules/views.js';
import { clamp, clone, esc, isDate, n, round, todayISO, uid } from './modules/utils.js';

(() => {
  'use strict';

  const bootAt = performance.now();

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

  const views = createViews({
    getState:() => state, getSelectedProjectId:() => selectedProjectId, setSelectedProjectId:value => { selectedProjectId=value; },
    getChartMode:() => chartMode, getRecordsExpanded:() => recordsExpanded, getCurrentUser:() => currentUser,
    activeProjects, projectById, projectRows, computeProject, recoveryStats, totals,
    displayCurrency, fmtMoney, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors
  });
  const { renderHome, renderProjects, renderGoals, renderSettings } = views;
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
      <div><label class="input-label">세후 배당 USD</label><input class="input" name="amountUSD" type="number" min="0.01" step="0.01" required value="${n(record?.amountUSD)}"></div>
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
      if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js?v=0.9-r1').catch(console.warn);
    }catch(error){console.error(error);document.getElementById('page-home').innerHTML='<article class="card danger"><div class="card-title">저장소를 열 수 없습니다.</div><p class="tiny">일반 브라우저 모드에서 다시 열어 주세요.</p></article>';setSaveStatus('오류','cloud-error');hideSplash();}
  }

  init();
})();
