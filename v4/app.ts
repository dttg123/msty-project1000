import type {User} from 'firebase/auth';
import type {OfficialDistributionFeed} from './modules/finance.js';
import {chooseCloudSync, syncSignature} from './modules/cloud-contract.js';
import { OFFICIAL_DISTRIBUTIONS_URL, parseOfficialDistributionFeed, parseDividendReplacement, reportingDividends, isPostedDividend, fetchReferenceExchangeRate } from './modules/finance.js';
import { monthActivity } from './modules/activity.js';
import { initGoogleAuth, logoutGoogle } from './modules/cloud-api.js';
import { openStorage, storageGet, storageSet, storageDelete, readLegacyState, storageStatus } from './storage.js';
import { getCloudDocument, getLegacyCloudDocument, saveCloudDocument, subscribeCloudDocument } from './modules/cloud-api.js';
import { APP_VERSION, DATA_SCHEMA_VERSION, buildCsvExportZip, buildPortableBackup, readStateFromBackupFile } from './backup.js';
import { PAGES, PROJECT_CATEGORIES, PROJECT_COLORS, PROJECT_COLOR_NAMES, SAFETY_KEY, STATE_KEY } from './modules/constants.js';
import { blankProject, blankState, migrate, migrateLegacy } from './modules/state.js';
import { createPortfolioEngine } from './modules/portfolio.js';
import { createFormatters } from './modules/format.js';
import { createViews } from './modules/views.js';
import { buildMigrationAudit } from './modules/migration.js';
import { TOSS_EXCEPTION_FIELDS, tossExceptionKey, dismissTossExceptions, filterDismissedTossExceptions, accountScopeChanged, automaticTossDividendAdoptions, automaticTossImportPlan, buildTossSync, disconnectedTossState, mergeTossCandidates, mergeTossCorrectionCandidates, mergeTossDividendCandidates, mergeTossSourceLedger, nextTossSyncFrom, normalizeTossOrder, rebuildProjectFromTossSource, refreshTossCandidateConflicts, tossCandidateToTrade, tossCandidateToDividend, tossSyncProgress } from './modules/toss.js';
import { fetchTossSnapshot, isTossBridgeConfigured, readTossSnapshotFile, removeLegacyTossBrowserCredentials } from './toss-client.js';
import { clearNativeTossCredentials, fetchNativeTossSnapshot, isNativeTossAvailable, markNativeTossPublicIp, nativePublicIp, nativeTossCredentialStatus, openTossIpManagement, saveNativeTossCredentials } from './toss-native.js';
import { validateLedger } from './modules/validation.js';
import { demoState } from './modules/demo.js';
import { FREQUENCIES } from './modules/income.js';
import { clone, esc, isDate, isRecord, n, round, todayISO, uid } from './modules/utils.js';
import { listAutoBackups, readAutoBackup, rotateAutoBackups } from './modules/backup-history.js';
import { tickerChange } from './modules/corporate-actions.js';
import { confirmHotUpdateReady, hotUpdateStatus as fetchHotUpdateStatus, installHotUpdate, isHotUpdateAvailable } from './hot-update.js';

(() => {
  'use strict';

  const errorMessage=(error: unknown): string=>error instanceof Error?error.message:isRecord(error)&&typeof error.message==='string'?error.message:'';
  function submittedFormData(event: Event): FormData {
    const form=event.currentTarget instanceof HTMLFormElement?event.currentTarget:event.target;
    if(!(form instanceof HTMLFormElement))throw new Error('입력 양식을 찾을 수 없습니다.');
    return new FormData(form);
  }
  function formControl(form: HTMLFormElement,name: string): HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement {
    const input=form.elements.namedItem(name);
    if(!(input instanceof HTMLInputElement||input instanceof HTMLSelectElement||input instanceof HTMLTextAreaElement))throw new Error(`입력 항목을 찾을 수 없습니다: ${name}`);
    return input;
  }
  const bootAt = performance.now();
  const demoMode=new URLSearchParams(location.search).get('demo')==='1';

  let state: any;
  let currentPage = 'home';
  let selectedProjectId = '';
  let chartMode = 'month';
  let chartSelection = '';
  let homeCashflowMode = 'month';
  let homeYearRange = '6';
  let historyFilter: any={},chartMonth='',chartYear='';
  let historyLimit=10, modalDirty=false, modalSaving=false, modalFocus: HTMLElement|null=null, modalScroll=0;
  let cashflowMonthKey = '';
  let portfolioGroup = 'highYield';
  const viewKey=`dividend-os-view-v2:${demoMode?'demo':'local'}`;
  function rememberView(): void{try{localStorage.setItem(viewKey,JSON.stringify({page:currentPage==='settings'?'home':currentPage,selectedProjectId,portfolioGroup,chartMode,chartMonth,chartYear,homeCashflowMode,homeYearRange}));}catch (_: unknown){}}
  function restoreView(): void{try{const saved: any=JSON.parse(localStorage.getItem(viewKey)||'null');if(!saved)return;const project: any=activeProjects().find((p: any)=>p.id===saved.selectedProjectId);if(project)selectedProjectId=project.id;const savedGroup: any=saved.portfolioGroup||(saved.portfolioCategory==='highYield'?'highYield':saved.portfolioCategory?'dividend':'');if(['highYield','dividend'].includes(savedGroup))portfolioGroup=savedGroup;if(['home','projects','goal'].includes(saved.page))currentPage=saved.page;if(['week','month','year','monthWeeks'].includes(saved.chartMode))chartMode=saved.chartMode;if(['month','year'].includes(saved.homeCashflowMode))homeCashflowMode=saved.homeCashflowMode;if(['6','10','all'].includes(saved.homeYearRange))homeYearRange=saved.homeYearRange;if(/^\d{4}-\d{2}$/.test(saved.chartMonth||''))chartMonth=saved.chartMonth;if(/^\d{4}$/.test(saved.chartYear||''))chartYear=saved.chartYear;}catch (_: unknown){}}
  let currentUser: User|null = null;
  let cloudReady = false, pendingCloudState: any = null, cloudChoiceResolve: any = null;
  let cloudBaseSignature: string | null = null;
  let cloudConnectGeneration=0;
  let cloudUnsubscribe: (()=>void)|null = null;
  let applyingCloudState = false;
  let saveTimer: ReturnType<typeof setTimeout>|undefined;
  let cloudTimer: ReturnType<typeof setTimeout>|undefined;
  let cloudRevision = 0;
  let cloudWritePending = false;
  let cloudPushQueued=false;
  let toastTimer: ReturnType<typeof setTimeout>|undefined;
  let legacyMigrationSource: any = null;
  let tossSyncRunning = false;
  let nativeTossStatus={available:isNativeTossAvailable(),configured:false,publicIp:'',lastPublicIp:'',checking:false};
  let appUpdateStatus={available:isHotUpdateAvailable(),checking:false,currentVersion:APP_VERSION,latestVersion:APP_VERSION,updateAvailable:false,nativeUpdateRequired:false,error:''};
  let exchangeRateBusy=false,exchangeRateError='',lastExchangeRateAttempt=0;
  let officialFeed: OfficialDistributionFeed | null=null,officialBusy=false,officialError='',officialAttempt=0;
  async function refreshOfficialDistributions(manual=false):Promise<void>{
    if(officialBusy||(!manual&&(demoMode||Date.now()-officialAttempt<6*3600000)))return;
    if(!activeProjects().some((p: any)=>p.symbol==='MSTY'))return;
    officialAttempt=Date.now();officialBusy=true;officialError='';renderProjects();
    try{
      if(!navigator.onLine)throw new Error('offline');
      const response=await fetch(OFFICIAL_DISTRIBUTIONS_URL,{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('http');const text=await response.text();if(text.length>20000)throw new Error('size');
      const next=parseOfficialDistributionFeed(JSON.parse(text));
      if(Date.parse(next.retrievedAt)>Date.now()+300000||officialFeed&&next.retrievedAt<officialFeed.retrievedAt)throw new Error('stale');
      await storageSet('officialDistributionFeed',next);officialFeed=next;if(manual)toast('운용사 공시 자료를 확인했습니다.');
    }catch{officialError='공시 갱신 실패 · 마지막 확인 자료 유지';if(manual)toast(officialError);}
    finally{officialBusy=false;renderProjects();}
  }
  let pendingTossIp: any='';
  function readLocalMode(): boolean {try{return sessionStorage.getItem('dividend-os-local-mode')==='1';}catch{return false;}}
  function persistLocalMode(enabled: boolean): void {try{if(enabled)sessionStorage.setItem('dividend-os-local-mode','1');else sessionStorage.removeItem('dividend-os-local-mode');}catch{}}
  let localOnlySession: any = readLocalMode();
  let autoBackupStatus={count:0,lastAt:'',error:''},autoBackupPromise: any=null;

  const portfolio: any = createPortfolioEngine(() => state, () => selectedProjectId);
  const { activeProjects, projectById, projectRows, sharesAtDate, computeProject, recoveryStats, totals } = portfolio;
  const formatters: any = createFormatters(() => state);
  const { displayCurrency, fmtMoney, fmtDividend, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors } = formatters;
  function applyTheme(pref: any =state?.settings?.appearance || 'system'): any {
    const dark: any=pref==='dark'||(pref==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);
    document.documentElement.dataset.theme=dark?'dark':'light';
    try{localStorage.setItem('dividend-os-theme',pref);}catch{}
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#0f1117':'#f4f5f9');
  }
  function hideSplash(): void {
    const splash=document.getElementById('splashScreen'); if(!splash)return;
    setTimeout(()=>{splash.classList.add('hide');setTimeout(()=>splash.remove(),240);},Math.max(0,330-(performance.now()-bootAt)));
  }
  function toast(message: string,{haptic=false}: {haptic?:boolean} ={}): void {
    const el=document.getElementById('toast');if(!el)return; clearTimeout(toastTimer); el.textContent=message; el.classList.add('show');
    if(haptic)try{navigator.vibrate?.(18)}catch (_: unknown){} toastTimer=setTimeout(()=>el.classList.remove('show'),2300);
  }
  async function refreshExchangeRate(manual=false): Promise<void> {
    if(exchangeRateBusy||demoMode)return;
    if(!manual&&(state.settings.exchangeRateMode!=='auto'||Date.now()-Date.parse(state.settings.exchangeRateUpdatedAt||'')<6*3600000||Date.now()-lastExchangeRateAttempt<60000))return;
    const opened=new Set([...document.querySelectorAll('#page-settings details.settings-section[open]')].map((section: any)=>section.querySelector('.card-title')?.textContent));
    const renderRateSettings=()=>{renderSettings();document.querySelectorAll('#page-settings details.settings-section').forEach((section: any)=>{if(opened.has(section.querySelector('.card-title')?.textContent))section.open=true;});};
    if(!navigator.onLine){exchangeRateError='오프라인 · 마지막 저장 환율 유지';renderRateSettings();if(manual)toast(exchangeRateError);return;}
    exchangeRateBusy=true;exchangeRateError='';lastExchangeRateAttempt=Date.now();renderRateSettings();
    try{
      const value=await fetchReferenceExchangeRate();
      if(!manual&&state.settings.exchangeRateMode!=='auto')return;
      const before=clone(state.settings);
      Object.assign(state.settings,{exchangeRate:value.rate,exchangeRateMode:'auto',exchangeRateDate:value.date,exchangeRateUpdatedAt:new Date().toISOString(),exchangeRateSource:'Frankfurter'});
      try{await saveState(true);}catch(error){state.settings=before;throw error;}
      renderAll();if(manual)toast('참고 환율을 갱신했습니다.');
    }catch (error: unknown){exchangeRateError='환율 조회 실패 · 마지막 저장 환율 유지';if(manual)toast(exchangeRateError);}
    finally{exchangeRateBusy=false;renderRateSettings();}
  }

  function getSaveSummary(): string {if(!currentUser)return '연결 안 됨 · 기기 저장 사용';const text=document.getElementById('saveStatus')?.textContent;if(text)return String(text);if(!cloudReady)return '클라우드 확인 대기';return state.meta.lastCloudSaveAt?'저장 성공 '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(state.meta.lastCloudSaveAt)):'연결됨 · 저장 성공 기록 없음';}
  function setSaveStatus(text: string,kind: string =''): void { const el=document.getElementById('saveStatus'); if(el){el.textContent=text;el.className=`save-pill ${kind}`;}const summary=document.getElementById('cloudSaveSummary');if(summary)summary.textContent=getSaveSummary(); }
  function hasMeaningfulData(value: any =state): any { return !!(value&&(value.trades?.length||value.dividends?.length||value.splits?.length||value.cashAdjustments?.length||value.projects?.some((p: any)=>n(p.currentPrice)||n(p.monthlyPlanShares)||n(p.initialDividendBalance)))); }

  const backupStorage: any={get:storageGet,set:storageSet,remove:storageDelete};
  async function refreshAutoBackupStatus(): Promise<any>{const entries: any=await listAutoBackups(backupStorage);autoBackupStatus={count:entries.length,lastAt:entries[0]?.createdAt||'',error:''};return entries;}
  async function autoBackup(reason: any ='automatic'): Promise<any>{
    if(demoMode||!hasMeaningfulData())return;
    if(autoBackupPromise)return autoBackupPromise;
    autoBackupPromise=rotateAutoBackups(backupStorage,clone(state),{reason}).then(result=>{autoBackupStatus={count:result.entries.length,lastAt:result.entries[0]?.createdAt||'',error:''};return result;}).catch(error=>{console.error(error);autoBackupStatus={...autoBackupStatus,error:'자동 백업 실패'};return null;}).finally(()=>{autoBackupPromise=null;});
    return autoBackupPromise;
  }

  async function pushCloudState(): Promise<any> {
    if(demoMode||!currentUser||!cloudReady||applyingCloudState)return;
    if(cloudWritePending){cloudPushQueued=true;return;}
    if(!navigator.onLine){setSaveStatus('오프라인','cloud-error');return;}
    const uid=currentUser.uid,generation=cloudConnectGeneration;
    const isCurrent=()=>currentUser?.uid===uid&&generation===cloudConnectGeneration;
    try {
      setSaveStatus('동기화 중','cloud-busy');
      const now=new Date().toISOString();state.meta.lastCloudAttemptAt=now;cloudWritePending=true;
      const sent=clone(state);sent.meta.lastCloudSaveAt=now;const sentSignature=syncSignature(sent);
      const saved: any=await saveCloudDocument(uid,sent,{expectedRevision:cloudRevision,appVersion:APP_VERSION});
      if(!isCurrent())return;cloudRevision=saved.revision;
      cloudWritePending=false;state.meta.lastCloudSaveAt=now;await storageSet(STATE_KEY,state);cloudBaseSignature=sentSignature;await storageSet('cloudSyncBase:'+uid,cloudBaseSignature); setSaveStatus('','cloud-ok');
    } catch (error: unknown) {
      if(!isCurrent())return;
      cloudWritePending=false;console.error(error);
      if(isRecord(error)&&error.code==='cloud-conflict'){
        const latest: any=await getCloudDocument(uid).catch(()=>null);if(!isCurrent())return;pendingCloudState=latest?.state?migrate(latest.state):null;cloudRevision=Math.max(cloudRevision,n(latest?.revision));cloudReady=false;await autoBackup('cloud-conflict');setSaveStatus('다른 기기 변경 · 확인 필요','cloud-error');toast('다른 기기 변경을 발견해 덮어쓰지 않았습니다.',{haptic:true});renderAll();return;
      }
      setSaveStatus('클라우드 오류','cloud-error');toast('기기에는 저장됐지만 클라우드 저장에 실패했습니다.',{haptic:true});
    }finally{cloudWritePending=false;if(cloudPushQueued){cloudPushQueued=false;if(currentUser&&cloudReady)cloudTimer=setTimeout(pushCloudState,0);}}
  }
  async function saveState(immediate: any =false): Promise<any> {
    state.meta.updatedAt=new Date().toISOString(); clearTimeout(saveTimer); clearTimeout(cloudTimer);
    const run: any=async()=>{state.meta.lastLocalSaveAt=new Date().toISOString();try{await storageSet(STATE_KEY,state);await autoBackup('ledger-change');}catch (error: unknown){setSaveStatus('저장 실패 · 백업 필요','cloud-error');toast('기기 저장에 실패했습니다. 앱을 닫지 말고 백업해 주세요.');throw error;}setSaveStatus(storageStatus().durable?'':'임시 저장 · 백업 필요',storageStatus().durable?'':'cloud-error');if(currentUser){if(immediate)await pushCloudState();else cloudTimer=setTimeout(pushCloudState,1400);}};
    if(immediate)await run();else saveTimer=setTimeout(()=>run().catch(console.error),120);
  }

  const views = createViews({
    getState:() => state, getSelectedProjectId:() => selectedProjectId, setSelectedProjectId:(value: any) => { selectedProjectId=value; },
    getChartMode:() => chartMode, getChartSelection:() => chartSelection, getHomeCashflowMode:() => homeCashflowMode, getHomeYearRange:() => homeYearRange, getHistoryFilter:()=>historyFilter,getChartMonth:()=>chartMonth,getChartYear:()=>chartYear, getHistoryLimit:()=>historyLimit,getCashflowMonthKey:() => cashflowMonthKey,getPortfolioGroup:() => portfolioGroup,setPortfolioGroup:(value: any) => { portfolioGroup=value; },getCurrentUser:() => currentUser,getAutoBackupStatus:()=>autoBackupStatus,getNativeTossStatus:()=>nativeTossStatus,getAppUpdateStatus:()=>appUpdateStatus,getExchangeRateStatus:()=>({busy:exchangeRateBusy,error:exchangeRateError}),getSaveSummary,getOfficialDistributionStatus:()=>({feed:officialFeed,busy:officialBusy,error:officialError}),isTossBridgeConfigured,
    activeProjects, projectById, projectRows, computeProject, recoveryStats, totals,
    displayCurrency, fmtMoney, fmtDividend, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors
  });
  const { renderHome, renderProjects, renderGoals, renderSettings } = views;
  function auditLegacyAgainstState(raw: any,targetState: any): any {
    const project: any=targetState.projects.find((item: any)=>item.symbol==='MSTY')||targetState.projects[0];
    if(!project)return null;
    const engine: any=createPortfolioEngine(()=>targetState,()=>project.id),calc=engine.computeProject(project);
    return buildMigrationAudit(raw,targetState,calc);
  }
  function prepareLegacyMigration(raw: any): any {
    const candidate: any=migrateLegacy(raw),audit=auditLegacyAgainstState(raw,candidate);
    candidate.meta.migrationAudit=audit;candidate.meta.legacyMigrationAvailable=false;
    return {candidate,audit};
  }
  function migrationCheckRows(audit: any): any {
    const labels: any={tradeCount:'거래 건수',dividendCount:'배당 건수',splitCount:'분할 건수',shares:'보유주수',costBasis:'남은 취득원가',marketValue:'평가금액',dividendsTotal:'누적배당',reinvestAmount:'재투자 사용액',dividendAvailable:'사용 가능 배당',currentTarget:'현재 목표주수',recoveryBasis:'원금회수 기준'};
    return audit.checks.filter((check: any)=>labels[check.key]).map((check: any)=>`<div class="list-row"><div><div class="row-title">${labels[check.key]}</div><div class="row-sub">V3 ${typeof check.source==='number'?round(check.source,4):check.source} → V4 ${typeof check.target==='number'?round(check.target,4):check.target}</div></div><div class="row-value ${check.passed?'positive':'negative'}">${check.passed?'일치':'불일치'}</div></div>`).join('');
  }
  async function previewLegacyMigration(): Promise<any> {
    legacyMigrationSource=legacyMigrationSource||await readLegacyState();
    if(!legacyMigrationSource){toast('이 기기에서 V3.2.1 데이터를 찾지 못했습니다.');return;}
    const preview: any=prepareLegacyMigration(legacyMigrationSource),audit=preview.audit;
    openModal(`<h3 class="modal-title">V3.2.1 → V4 이전 점검</h3><p class="modal-desc">V3 원본은 읽기만 합니다. 아래 값이 모두 일치할 때 V4 전용 저장소에 복사합니다.</p><div class="list">${migrationCheckRows(audit)}</div><div class="modal-actions"><button class="btn soft" data-close-modal>취소</button><button class="btn primary" id="confirmLegacyMigration" ${audit.passed?'':'disabled'}>일치 확인 후 복사</button></div>`);
    const confirm: any=document.getElementById('confirmLegacyMigration');if(confirm)confirm.onclick=async()=>{await storageSet(SAFETY_KEY,clone(state));state=preview.candidate;selectedProjectId=state.projects[0]?.id||'';await saveState(true);closeModal();renderAll();showPage('settings');toast('V3.2.1 데이터를 V4에 복사했습니다.');};
  }
  function renderAll(displayOnly =false): void {
    const opened: any=displayOnly?[...document.querySelectorAll<HTMLDetailsElement>('.goal-step-card[open]')].map(el=>el.dataset.goalProject):[],historyOpen=displayOnly&&document.querySelector<HTMLDetailsElement>('.record-center')?.open,scrollY=window.scrollY;
    if(!selectedProjectId)selectedProjectId=activeProjects()[0]?.id||'';
    document.getElementById('usdBtn')?.classList.toggle('active',displayCurrency()==='USD');
    document.getElementById('krwBtn')?.classList.toggle('active',displayCurrency()==='KRW');
    document.getElementById('usdBtn')?.setAttribute('aria-pressed',String(displayCurrency()==='USD'));
    document.getElementById('krwBtn')?.setAttribute('aria-pressed',String(displayCurrency()==='KRW'));
    renderHome();renderProjects();renderGoals();if(!displayOnly)renderSettings();
    if(displayOnly){document.querySelectorAll<HTMLDetailsElement>('.goal-step-card').forEach((el: any)=>{el.open=opened.includes(el.dataset.goalProject);});const history: any=document.querySelector<HTMLDetailsElement>('.record-center');if(history)history.open=!!historyOpen;window.scrollTo(0,scrollY);}
  }
  function showPage(page: any): any {
    if(!PAGES.includes(page))page='home'; currentPage=page;
    document.querySelectorAll('.page').forEach((el: any)=>el.classList.toggle('active',el.id===`page-${page}`));
    document.querySelectorAll('.nav-btn').forEach((el: any)=>el.classList.toggle('active',el.dataset.page===page));
    window.scrollTo({top:0,behavior:'instant'});
    rememberView();
  }
  function openModal(html: string): void {
    const modal: any=document.getElementById('modal'),backdrop=document.getElementById('modalBackdrop')!;
    if(!backdrop.classList.contains('show')){modalFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;modalScroll=window.scrollY;document.body.style.position='fixed';document.body.style.top=`-${modalScroll}px`;document.body.style.width='100%';}
    modalDirty=false;modal.innerHTML=`<button type="button" class="modal-close" data-close-modal aria-label="닫기">×</button><div class="modal-handle"></div>${html}`;
    modal.querySelectorAll('input,select,textarea').forEach((input: any,index: any)=>{const label: any=input.closest('div')?.querySelector('label');if(label){input.id='modal-field-'+index;label.htmlFor=input.id;}});
    backdrop.classList.add('show');modal.scrollTop=0;
    document.querySelectorAll('main,.bottom-nav').forEach((el: any)=>{el.inert=true;});
    modal.setAttribute('aria-label',modal.querySelector('h3')?.textContent||'입력 창');
    requestAnimationFrame(()=>modal.querySelector('button')?.focus());
  }
  function requestCloseModal(): void {
    if(modalSaving)return;
    if(!document.getElementById('modalBackdrop')!.classList.contains('show'))return;
    if(modalDirty){if(!document.querySelector('.modal-unsaved'))document.getElementById('modal')!.insertAdjacentHTML('beforeend','<div class="modal-unsaved" role="alert"><p>작성 중인 내용이 있습니다. 저장하지 않고 닫을까요?</p><button class="btn soft" data-keep-modal>계속 작성</button><button class="btn danger" data-discard-modal>닫기</button></div>');return;}
    closeModal();
  }
  function closeModal(): void {
    if(cloudChoiceResolve){const resolve: any=cloudChoiceResolve;cloudChoiceResolve=null;resolve('cancel');}
    document.getElementById('modalBackdrop')!.classList.remove('show');document.getElementById('modal')!.innerHTML='';
    modalDirty=false;document.body.style.position='';document.body.style.top='';document.body.style.width='';
    document.querySelectorAll('main,.bottom-nav').forEach((el: any)=>{el.inert=false;});
    window.scrollTo(0,modalScroll);modalFocus?.focus?.({preventScroll:true});
  }
  function confirmAction(title: string,message: string,action: ()=>void|Promise<void>,confirmText: string ='확인'): void {
    openModal(`<h3 class="modal-title">${esc(title)}</h3><p class="modal-desc">${esc(message)}</p><div class="modal-actions"><button class="btn soft" data-close-modal>취소</button><button class="btn danger" id="modalConfirm">${esc(confirmText)}</button></div>`);
    document.getElementById('modalConfirm')!.onclick=async()=>{await action();closeModal();};
  }

  function openProjectForm(project: any =null): any {
    const edit: any=!!project,returnPage=currentPage,defaultColor=edit?n(project.colorIndex):state.projects.length%PROJECT_COLORS.length;
    const frequencyValue: any=project?.distributionFrequencyMode==='manual'?(project.distributionFrequency||'monthly'):'auto';
    openModal(`<h3 class="modal-title">${edit?'종목 설정':'종목 추가'}</h3><p class="modal-desc">기록 방식은 같고 종목 성격에 따라 핵심 분석만 달라집니다.</p><form id="projectForm" class="form-grid">
      <div><label class="input-label">티커</label><input class="input" name="symbol" maxlength="12" required value="${esc(project?.symbol||'')}"></div>
      <div class="form-grid two"><div><label class="input-label">운용 성격 <small>분석 화면만 변경</small></label><select class="input select" name="category">${PROJECT_CATEGORIES.map(([key,label]: any)=>`<option value="${key}" ${key===(project?.category||'dividend')?'selected':''}>${label}</option>`).join('')}</select></div><div><label class="input-label">목표 주수</label><input class="input" name="targetUnits" type="number" min="0.0001" step="0.0001" required value="${n(project?.targetUnits)||500}"></div></div>
      <details class="form-advanced"><summary>추가 설정 <span>이름 · 월 계획 · 현재가 · 배당 주기</span></summary><div class="form-grid">
        <div><label class="input-label">종목명</label><input class="input" name="name" value="${esc(project?.name||'')}"></div>
        <div><label class="input-label">프로젝트 이름</label><input class="input" name="tag" value="${esc(project?.tag||'배당 프로젝트')}"></div>
        <div><label class="input-label">월 매수계획 주수</label><input class="input" name="monthlyPlanShares" type="number" min="0" step="0.0001" value="${n(project?.monthlyPlanShares)}"></div>
        <div class="form-grid two"><div><label class="input-label">현재가 USD</label><input class="input" name="currentPrice" type="number" min="0" step="0.0001" value="${n(project?.currentPrice)}"></div><div><label class="input-label">배당 주기</label><select class="input select" name="distributionFrequency"><option value="auto" ${frequencyValue==='auto'?'selected':''}>자동 감지</option>${Object.entries(FREQUENCIES).map(([key,spec]: any)=>`<option value="${key}" ${key===frequencyValue?'selected':''}>${spec.label} 고정</option>`).join('')}</select></div></div>
        <div><label class="input-label">프로젝트 시작일</label><input class="input" name="projectStart" type="date" value="${project?.projectStart||todayISO()}"></div>
        <fieldset class="color-picker"><legend>그래프 식별 색상</legend>${PROJECT_COLORS.map((colors: any,index: any)=>`<label><input type="radio" name="colorIndex" value="${index}" ${defaultColor===index?'checked':''}><span class="color-swatch" style="--swatch-a:${colors[0]};--swatch-b:${colors[1]}"></span><b>${PROJECT_COLOR_NAMES[index]}</b></label>`).join('')}</fieldset>
      </div></details>
      <div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">${edit?'수정 저장':'추가'}</button></div>
      ${edit&&activeProjects().length>1?'<button class="btn soft" type="button" id="archiveProject">프로젝트 보관</button>':''}
    </form>`);
    if(returnPage==='goal')document.querySelector<HTMLDetailsElement>('#projectForm .form-advanced')!.open=true;
    document.getElementById('projectForm')!.onsubmit=async (event: Event)=>{
      event.preventDefault();const form=submittedFormData(event),symbol=String(form.get('symbol')).trim().toUpperCase();
      if(!/^[A-Z0-9.-]{1,16}$/.test(symbol)){toast('티커는 영문·숫자·점·하이픈만 입력해 주세요.');return;}
      if(state.projects.some((x: any)=>x.id!==project?.id&&x.symbol===symbol&&!x.archived)){toast('이미 등록된 티커입니다.');return;}
      const target: any=project||blankProject(symbol,String(form.get('name')).trim()||symbol);
      const oldSymbol: any=target.symbol,currentPrice=Math.max(0,n(form.get('currentPrice')));
      const category: any=PROJECT_CATEGORIES.some(([key]: any)=>key===form.get('category'))?String(form.get('category')):'dividend';
      const frequencyChoice: any=String(form.get('distributionFrequency'));
      Object.assign(target,{symbol,name:String(form.get('name')).trim()||symbol,tag:String(form.get('tag')).trim()||'배당 프로젝트',category,colorIndex:Math.max(0,Math.min(PROJECT_COLORS.length-1,Math.floor(n(form.get('colorIndex'))))),targetUnits:Math.max(.0001,n(form.get('targetUnits'))),monthlyPlanShares:Math.max(0,n(form.get('monthlyPlanShares'))),currentPrice,priceSource:currentPrice?'manual':target.priceSource||'manual',priceUpdatedAt:currentPrice?new Date().toISOString():target.priceUpdatedAt||'',distributionFrequencyMode:frequencyChoice==='auto'?'auto':'manual',distributionFrequency:Object.hasOwn(FREQUENCIES,frequencyChoice)?frequencyChoice:(target.distributionFrequency||'monthly'),projectStart:String(form.get('projectStart'))||todayISO()});
      if(edit&&oldSymbol!==symbol){target.symbol=oldSymbol;tickerChange(target,symbol,todayISO(),uid('ca'));}
      if(!edit){historyFilter={};state.projects.push(target);selectedProjectId=target.id;}
      portfolioGroup=target.category==='highYield'?'highYield':'dividend';await saveState(true);closeModal();renderAll(true);showPage(edit?returnPage:'projects');toast(edit?'프로젝트를 수정했습니다.':'프로젝트를 추가했습니다.');
    };
    const archive: any=document.getElementById('archiveProject');if(archive)archive.onclick=()=>confirmAction('프로젝트 보관',`${project.symbol}은 전체 합산에서 숨겨집니다. 기록은 삭제하지 않습니다.`,async()=>{project.archived=true;selectedProjectId=activeProjects()[0]?.id||'';await saveState(true);renderAll();showPage('projects');toast('프로젝트를 보관했습니다.');},'보관');
  }

  function openTradeForm(record: any =null): any {
    const project: any=projectById(record?.projectId||selectedProjectId),edit=!!record;
    openModal(`<h3 class="modal-title">${project.symbol} ${edit?'거래 수정':'거래 입력'}</h3><p class="modal-desc">모든 원본 금액은 USD로 저장됩니다.</p><form id="tradeForm" class="form-grid">
      <div><label class="input-label">날짜</label><input class="input" name="date" type="date" required value="${record?.date||todayISO()}"></div>
      <div class="form-grid two"><div><label class="input-label">거래</label><select class="input select" name="type"><option value="buy" ${record?.type!=='sell'?'selected':''}>매수</option><option value="sell" ${record?.type==='sell'?'selected':''}>매도</option></select></div><div data-buy-only><label class="input-label">매수 구분</label><select class="input select" name="buyType"><option value="direct" ${record?.buyType==='direct'?'selected':''}>직접매수</option><option value="reinvest" ${record?.buyType==='reinvest'?'selected':''}>배당재투자</option><option value="mixed" ${record?.buyType==='mixed'?'selected':''}>혼합매수</option><option value="opening" ${record?.buyType==='opening'?'selected':''}>초기보유</option></select></div></div>
      <div class="form-grid two"><div><label class="input-label">주수</label><input class="input" name="shares" type="number" min="0.0001" step="0.0001" required value="${n(record?.shares)||1}"></div><div><label class="input-label">단가 USD</label><input class="input" name="price" type="number" min="0" step="0.0001" required value="${record?n(record.price):n(project.currentPrice)}"></div></div>
      <div data-mixed-only><label class="input-label">혼합매수 배당 사용액 USD</label><input class="input" name="reinvestAmountUSD" type="number" min="0" step="0.01" value="${n(record?.reinvestAmountUSD)}"></div>
      <details><summary>추가 정보 (선택)</summary><div><label class="input-label">메모</label><input class="input" name="note" value="${esc(record?.note||'')}"></div></details>
      <div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div>${edit?`<button class="record-delete-link" type="button" data-delete-from-edit="trade:${record.id}">이 거래 기록 삭제</button>`:''}</form>`);
    const tradeForm=document.querySelector<HTMLFormElement>('#tradeForm')!,typeInput=formControl(tradeForm,'type'),buyTypeInput=formControl(tradeForm,'buyType');
    const syncTradeFields: any=()=>{const selling: any=typeInput.value==='sell';tradeForm.querySelector<HTMLElement>('[data-buy-only]')!.hidden=selling;tradeForm.querySelector<HTMLElement>('[data-mixed-only]')!.hidden=selling||buyTypeInput.value!=='mixed';};
    typeInput.onchange=syncTradeFields;buyTypeInput.onchange=syncTradeFields;syncTradeFields();
    tradeForm.onsubmit=async (event: Event)=>{event.preventDefault();if(modalSaving)return;const form=submittedFormData(event),date=String(form.get('date')),type=form.get('type'),shares=n(form.get('shares')),price=n(form.get('price')),buyType=type==='sell'?'':String(form.get('buyType')),reinvestAmountUSD=buyType==='mixed'?n(form.get('reinvestAmountUSD')):0;if(!isDate(date)||shares<=0||price<0){toast('날짜·주수·단가를 확인해 주세요.');return;}if(reinvestAmountUSD>shares*price+.0001){toast('배당 사용액이 총 매수액보다 큽니다.');return;}const row: any=record||{id:uid('t'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()},before=record?clone(record):null;Object.assign(row,{date,type,buyType,shares,price,reinvestAmountUSD,note:String(form.get('note')).trim()});if(!edit)state.trades.push(row);const invalid: any=computeProject(project).oversells.length;if(invalid){if(edit)Object.assign(row,before);else state.trades=state.trades.filter((item: any)=>item!==row);toast('이 거래를 반영하면 해당 날짜의 보유주수보다 많이 매도하게 됩니다.');return;}const controls=[...tradeForm.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button')],disabled=controls.map((el)=>el.disabled);modalSaving=true;controls.forEach((el)=>el.disabled=true);try{await saveState(true);}catch{if(edit)Object.assign(row,before);else state.trades=state.trades.filter((item: any)=>item!==row);controls.forEach((el,i)=>el.disabled=disabled[i]);modalSaving=false;return;}modalSaving=false;closeModal();renderAll(true);showPage('projects');toast(edit?'거래를 수정했습니다.':'거래를 저장했습니다.');};
  }


  function openPriceForm(): any{
    const project: any=projectById();if(!project)return;
    openModal(`<h3 class="modal-title">${esc(project.symbol)} 현재가 수정</h3><p class="modal-desc">평가금액과 목표 매수금 계산에 사용할 현재가입니다.</p><form id="priceForm" class="form-grid"><div><label class="input-label">현재가 USD</label><input class="input" name="price" type="number" min="0.0001" step="0.0001" inputmode="decimal" required value="${n(project.currentPrice)||''}"></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div></form>`);
    document.getElementById('priceForm')!.onsubmit=async (event: Event)=>{event.preventDefault();const price: any=n(submittedFormData(event).get('price'));if(price<=0)return;project.currentPrice=price;project.priceSource='manual';project.priceUpdatedAt=new Date().toISOString();await saveState(true);closeModal();renderAll(true);toast('현재가를 저장했습니다.');};
  }

  function openIncomeMonth(month=todayISO().slice(0,7),projectId='',symbolFilter='') {
    if(!/^\d{4}-\d{2}$/.test(month))return;
    const date: any=new Date(month+'-01T12:00:00');
    if(!Number.isFinite(date.getTime()))return;
    const shift: any=(delta: any)=>{const d: any=new Date(date);d.setMonth(d.getMonth()+delta);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
    const allRows: any=monthActivity({...state,dividends:reportingDividends(state.dividends.filter((row: any)=>isPostedDividend(row,todayISO())),n(state.settings.exchangeRate))},[],month,todayISO()).filter((row: any)=>!row.estimated&&(!projectId||row.projectId===projectId)),allActual=allRows.reduce((sum: any,row: any)=>sum+n(row.amountUSD),0),project=projectId?projectById(projectId):null;
    const bySymbol: any=[...allRows.reduce((map: any,row: any)=>{const key: any=row.symbol||'기타',item=map.get(key)||{symbol:key,value:0,projectId:row.projectId};item.value+=n(row.amountUSD);map.set(key,item);return map;},new Map()).values()].sort((a,b)=>b.value-a.value),top=bySymbol.slice(0,4),otherSymbols=new Set(bySymbol.slice(4).map((item: any)=>item.symbol)),other=bySymbol.slice(4).reduce((sum: any,row: any)=>sum+row.value,0),composition=other?[...top,{symbol:'기타',value:other,filter:'__other__'}]:top,total=Math.max(1,allActual);
    const validFilter: any=symbolFilter&&(symbolFilter==='__other__'?otherSymbols.size:bySymbol.some((item: any)=>item.symbol===symbolFilter))?symbolFilter:'',rows=validFilter?(validFilter==='__other__'?allRows.filter((row: any)=>otherSymbols.has(row.symbol||'기타')):allRows.filter((row: any)=>(row.symbol||'기타')===validFilter)):allRows,actual=rows.reduce((sum: any,row: any)=>sum+n(row.amountUSD),0),filterLabel=validFilter==='__other__'?'기타':validFilter;
    openModal(`<h3 class="modal-title">${project?`${esc(project.symbol)} 최근 입금`:'월별 배당'}</h3><div class="month-navigation"><button class="btn soft" data-income-month="${shift(-1)}" ${projectId?`data-income-project="${esc(projectId)}"`:''} aria-label="이전 달">‹</button><strong>${month.replace('-','년 ')}월</strong><button class="btn soft" data-income-month="${shift(1)}" ${projectId?`data-income-project="${esc(projectId)}"`:''} aria-label="다음 달">›</button></div>
      <section class="month-actual-summary"><span>${filterLabel?`${esc(filterLabel)} 실제 세후 입금`:'실제 세후 입금'}</span><strong>${fmtMoney(actual,2)}</strong><small>${rows.length}회 입금</small></section>
      ${composition.length>1?`<section class="month-composition"><div class="composition-heading"><h4>종목별 구성</h4>${filterLabel?`<button type="button" data-income-month="${esc(month)}" ${projectId?`data-income-project="${esc(projectId)}"`:''}>전체 보기</button>`:'<span>색을 누르면 기록 필터</span>'}</div><div class="composition-bar interactive">${composition.map((item: any,index: any)=>{const itemProject: any=projectById(item.projectId),color=itemProject?projectColors(itemProject)[0]:`hsl(${225+index*24} 18% ${55-index*3}%)`,filter=item.filter||item.symbol;return `<button type="button" class="${filter===validFilter?'active':validFilter?'dimmed':''}" style="width:${item.value/total*100}%;--segment:${color}" data-income-month="${esc(month)}" ${projectId?`data-income-project="${esc(projectId)}"`:''} data-income-symbol="${esc(filter)}" aria-label="${esc(item.symbol)} 입금기록만 보기"></button>`;}).join('')}</div><div class="composition-legend interactive">${composition.map((item: any,index: any)=>{const itemProject: any=projectById(item.projectId),color=itemProject?projectColors(itemProject)[0]:`hsl(${225+index*24} 18% ${55-index*3}%)`,filter=item.filter||item.symbol;return `<button type="button" class="${filter===validFilter?'active':validFilter?'dimmed':''}" data-income-month="${esc(month)}" ${projectId?`data-income-project="${esc(projectId)}"`:''} data-income-symbol="${esc(filter)}"><span><i style="--dot:${color}"></i>${esc(item.symbol)}</span><b>${fmtMoney(item.value,0)}</b></button>`;}).join('')}</div></section>`:composition.length?`<p class="single-symbol-note">${esc(composition[0].symbol)} 실제 입금만 있습니다.</p>`:''}
      <div class="agenda-heading"><h4>${filterLabel?`${esc(filterLabel)} 입금 기록`:'입금 기록'}</h4><span>${rows.length}건 · 눌러서 상세 보기</span></div><div class="income-agenda">${rows.map((r: any)=>`<button type="button" class="agenda-row agenda-row-button" data-view-record="dividend:${esc(r.id)}"><div><span class="agenda-status actual">완료</span><strong>${esc(r.symbol)} <small>${fmtDate(r.date)}</small></strong></div><div><strong>${fmtDividend(r,2)}</strong><i>›</i></div></button>`).join('')||'<p class="empty">이 달의 실제 입금 기록이 없습니다.</p>'}</div><button class="btn soft" style="width:100%;margin-top:16px" data-close-modal>닫기</button>`);
  }

  async function previewDividendReplacement(file: File): Promise<void> {
    try {
      if(file.size>1024*1024)throw new Error('교체 파일이 너무 큽니다.');
      const parsed=parseDividendReplacement(JSON.parse(await file.text()),todayISO());
      const projects=activeProjects().filter((project: any)=>project.symbol===parsed.symbol);
      if(projects.length!==1)throw new Error('교체 대상 종목이 정확히 하나 있어야 합니다.');
      // Import is a local ledger operation; unresolved cloud records remain untouched.
      const project=projects[0],fingerprint=JSON.stringify({currency:parsed.currency,rows:parsed.rows}),replacementMoney=(row: any)=>parsed.currency==='KRW'?row.amountKRW.toLocaleString('ko-KR')+'원':'$'+row.amountUSD.toFixed(2);
      if(state.meta.lastDividendReplacementFingerprint===fingerprint&&state.dividends.length===parsed.rows.length&&state.dividends.every((row: any,index: number)=>row.projectId===project.id&&row.currency===parsed.currency&&row.date===parsed.rows[index].date&&(parsed.currency==='KRW'?row.amountKRW===parsed.rows[index].amountKRW:row.amountUSD===parsed.rows[index].amountUSD))){toast('이미 같은 배당 기록으로 교체되어 있습니다.');return;}
      openModal(`<h3 class="modal-title">전체 배당 교체 확인</h3><p class="modal-desc">기존 배당 ${state.dividends.length}건을 삭제하고 ${esc(parsed.symbol)} ${parsed.rows.length}건으로 교체합니다. 거래·보유주수·목표·토스 원본은 유지합니다.</p><strong>${parsed.currency==='KRW'?parsed.totalKRW.toLocaleString('ko-KR')+'원':'$'+parsed.totalUSD.toFixed(2)}</strong><div class="list">${parsed.rows.map(row=>`<div class="list-row"><span>${esc(row.date)}</span><strong>${replacementMoney(row)}</strong></div>`).join('')}</div><p class="detail-note">${parsed.currency==='KRW'?'원화 확인액만 저장합니다. 달러 금액·지급 당시 주수는 미확인이며 달러 재투자 잔액과 총손익에 임의 합산하지 않습니다.':'확인된 달러 세후 입금액을 저장합니다. 지급 당시 주수는 미확인으로 남깁니다.'} 교체 직전 기록은 안전 사본으로 남깁니다.</p><div class="modal-actions"><button class="btn soft" data-close-modal>취소</button><button class="btn primary" id="confirmDividendReplacement">기존 배당 삭제 후 교체</button></div>`);
      document.getElementById('confirmDividendReplacement')!.onclick=async()=>{
        if(modalSaving)return;
        const before=clone(state),next=clone(state);
        next.dividends=parsed.rows.map(row=>({id:uid('d'),projectId:project.id,symbol:project.symbol,date:row.date,status:'actual',currency:parsed.currency,amountKRW:row.amountKRW,amountUSD:row.amountUSD||0,sharesAtPayment:0,rocPercent:null,rocStatus:'none',note:'사용자 제공 증권앱 화면의 '+parsed.symbol+' '+parsed.currency+' 세후 금액',createdAt:new Date().toISOString()}));
        next.meta.lastDividendReplacementFingerprint=fingerprint;
        const errors=validateLedger(next);if(errors.length){toast(errors[0]);return;}
        modalSaving=true;document.querySelector<HTMLButtonElement>('#confirmDividendReplacement')!.disabled=true;
        try{await storageSet(SAFETY_KEY,before);state=next;await saveState(true);selectedProjectId=project.id;closeModal();renderAll();showPage('projects');toast(`배당 ${parsed.rows.length}건을 ${parsed.currency} 원본으로 교체했습니다.${currentUser&&!cloudReady?' 기기에 저장 · 클라우드 동기화 보류':''}`);}
        catch(error){state=before;try{await storageSet(STATE_KEY,before);}catch{}toast('교체를 저장하지 못해 기존 배당을 유지했습니다.');document.getElementById('confirmDividendReplacement')?.removeAttribute('disabled');}
        finally{modalSaving=false;}
      };
    }catch (error: unknown){toast(errorMessage(error)||'교체 파일을 읽지 못했습니다.');}
  }

  function openDividendSchedule(projectId: string): void {
    const project=projectById(projectId),announcement=project.dividendAnnouncement||{};
    openModal(`<h3 class="modal-title">${esc(project.symbol)} 공시 일정 기록</h3><p class="modal-desc">운용사·기업 공시에서 확인한 날짜를 직접 기록합니다. 자동 검증된 일정이 아니며 배당 입금 장부와 분리됩니다.</p><form id="dividendScheduleForm" class="form-grid"><label>배당락일<input class="input" name="exDate" type="date" required value="${esc(announcement.exDate||'')}"></label><label>공시 지급일<input class="input" name="payDate" type="date" required value="${esc(announcement.payDate||'')}"></label><label>공시 주소<input class="input" name="sourceURL" type="url" required value="${esc(announcement.sourceURL||'')}" placeholder="https://"></label><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div></form>`);
    document.getElementById('dividendScheduleForm')!.onsubmit=async(event: Event)=>{
      event.preventDefault();if(modalSaving)return;
      const form=submittedFormData(event),exDate=String(form.get('exDate')),payDate=String(form.get('payDate')),sourceURL=String(form.get('sourceURL'));
      if(!isDate(exDate)||!isDate(payDate)||!/^https:\/\//.test(sourceURL)){toast('날짜와 HTTPS 공시 주소를 확인해 주세요.');return;}
      const before=clone(project.dividendAnnouncement||null);modalSaving=true;
      try{project.dividendAnnouncement={exDate,payDate,sourceURL,recordedAt:new Date().toISOString(),verification:'user'};await saveState(true);closeModal();renderAll();showPage('projects');}
      catch{project.dividendAnnouncement=before;toast('일정을 저장하지 못했습니다.');}finally{modalSaving=false;}
    };
  }

  function openDividendForm(record: any =null,draft: any =null): any {
    const project: any=projectById(record?.projectId||selectedProjectId),edit=!!record,calc=computeProject(project),returnPage=currentPage;
    openModal(`<h3 class="modal-title">${project.symbol} ${edit?'배당 수정':'배당 입력'}</h3><p class="modal-desc">실제로 입금된 세후 배당금을 기록합니다.</p><form id="dividendForm" class="form-grid">
      <div><label class="input-label">지급일</label><input class="input" name="date" type="date" required value="${record?.date||draft?.date||todayISO()}"></div>
      <div><label class="input-label">입금 통화</label><select class="input select" name="currency"><option value="USD" ${record?.currency!=="KRW"?"selected":""}>달러 실입금</option><option value="KRW" ${record?.currency==="KRW"?"selected":""}>원화 확인액 (달러 미확인)</option></select></div><div><label class="input-label">세후 배당 금액</label><input class="input" name="amountUSD" type="number" min="0.01" step="0.01" required value="${record?.currency==='KRW'?n(record.amountKRW):n(record?.amountUSD)}"></div>
      <details class="dividend-extra"><summary>추가 정보 (선택)</summary><p class="tiny muted">배당을 받은 실제 주수를 확인한 경우에만 입력하세요. 입금일 보유주수만으로 배당 권리를 추정하지 않습니다.</p><div class="form-grid">
        <div class="form-grid two"><div><label class="input-label">지급 기준 주수</label><input class="input" name="sharesAtPayment" type="number" min="0" step="0.0001" value="${record?n(record.sharesAtPayment):0}"></div><div><label class="input-label">기준 주가 USD</label><input class="input" name="referencePrice" type="number" min="0" step="0.0001" value="${record?n(record.referencePrice):n(project.currentPrice)}"></div></div>
        <div class="form-grid two"><div><label class="input-label">ROC 비율 %</label><input class="input" name="rocPercent" type="number" min="0" max="100" step="0.01" value="${record?.rocPercent??''}"></div><div><label class="input-label">ROC 자료</label><select class="input" name="rocStatus"><option value="estimated" ${record?.rocStatus!=='final'?'selected':''}>운용사 추정</option><option value="final" ${record?.rocStatus==='final'?'selected':''}>확정 자료</option></select></div></div>
        <div><label class="input-label">메모</label><input class="input" name="note" value="${esc(record?.note||'')}"></div>
      </div></details>
      <div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button>${!edit?'<button class="btn soft" type="submit" name="next" value="1">저장 후 계속</button>':''}<button class="btn primary" type="submit">저장</button></div>${edit?`<button class="record-delete-link" type="button" data-delete-from-edit="dividend:${record.id}">이 배당 기록 삭제</button>`:''}</form>`);
    const dividendForm=document.querySelector<HTMLFormElement>('#dividendForm')!,preview=document.createElement('div');preview.className='dividend-preview';preview.setAttribute('aria-live','polite');dividendForm.querySelector('.modal-actions')!.before(preview);
    const updatePreview: any=()=>{const form=new FormData(dividendForm),amount=n(form.get('amountUSD')),krw=form.get('currency')==='KRW',shares=krw?0:n(form.get('sharesAtPayment'));(formControl(dividendForm,'amountUSD') as HTMLInputElement).step=krw?'1':'0.01';(formControl(dividendForm,'amountUSD') as HTMLInputElement).min=krw?'1':'0.01';if(amount<=0){preview.textContent='실제 입금액을 입력하면 주당 실수령액을 확인할 수 있습니다.';return;}preview.innerHTML=`<strong>이번 실제 입금</strong><br>${krw?Math.round(amount).toLocaleString('ko-KR')+'원':fmtMoney(amount,2)}${shares>0?` · 주당 ${fmtMoney(amount/shares,4)}`:''}<br><span class="tiny muted">월·연 예상으로 늘리지 않고 실제 입금값만 저장합니다.</span>`;};
    formControl(dividendForm,'date').addEventListener('change',updatePreview);
    dividendForm.addEventListener('input',updatePreview);updatePreview();
    dividendForm.onsubmit=async (event: Event)=>{
      event.preventDefault();if(modalSaving)return;
      const form=new FormData(dividendForm),date=String(form.get('date')),entered=n(form.get('amountUSD')),krw=form.get('currency')==='KRW',amountUSD=krw?0:entered;
      if(!isDate(date)||entered<=0||(krw&&!Number.isSafeInteger(entered))){toast('지급일과 배당금을 확인해 주세요.');return;}
      const keepEntering: any=!edit&&(event instanceof SubmitEvent?event.submitter:null)?.getAttribute('name')==='next',before=record?clone(record):null;
      const row: any=record||{id:uid('d'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()};
      Object.assign(row,{date,amountUSD,currency:krw?'KRW':'USD',amountKRW:krw?entered:undefined,rocPercent:form.get('rocPercent')===''?null:n(form.get('rocPercent')),rocStatus:form.get('rocStatus')==='final'?'final':'estimated',sharesAtPayment:krw?0:Math.max(0,n(form.get('sharesAtPayment'))),referencePrice:Math.max(0,n(form.get('referencePrice'))),note:String(form.get('note')).trim()});
      if(krw){for(const key of ['grossAmountUSD','netAmountUSD','withholdingTaxUSD','taxUSD','feeUSD','rocAmountUSD'])delete row[key];row.rocPercent=null;row.rocStatus='none';}
      else if(row.netAmountUSD!==undefined||row.grossAmountUSD!==undefined){row.netAmountUSD=entered;row.grossAmountUSD=entered+n(row.withholdingTaxUSD??row.taxUSD)+n(row.feeUSD);}
      if(!edit)state.dividends.push(row);
      const controls=[...document.getElementById('modal')!.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button')],disabled=controls.map((el)=>el.disabled);
      modalSaving=true;dividendForm.setAttribute('aria-busy','true');controls.forEach((el)=>el.disabled=true);preview.textContent='저장 중…';
      try{await saveState(true);}catch (error: unknown){
        if(edit)Object.assign(row,before);else state.dividends=state.dividends.filter((item: any)=>item!==row);
        controls.forEach((el,i)=>el.disabled=disabled[i]);dividendForm.removeAttribute('aria-busy');modalSaving=false;updatePreview();return;
      }
      modalSaving=false;
      if(keepEntering){renderAll(true);openDividendForm(null,{date});toast('저장했습니다. 다음 금액을 입력하세요.');return;}
      closeModal();renderAll(true);showPage(returnPage);toast(edit?'배당을 수정했습니다.':'배당을 저장했습니다.');
    };
    if(draft)requestAnimationFrame(()=>{(formControl(dividendForm,'amountUSD') as HTMLInputElement).focus();(formControl(dividendForm,'amountUSD') as HTMLInputElement).select();});
  }

  function openCashForm(record: any =null): any {
    const project: any=projectById(record?.projectId||selectedProjectId),edit=!!record;
    openModal(`<h3 class="modal-title">${project.symbol} 잔액 ${edit?'수정':'보정'}</h3><p class="modal-desc">실제 사용 가능 배당과 앱 잔액이 다를 때만 더하거나 뺍니다.</p><form id="cashForm" class="form-grid"><div><label class="input-label">날짜</label><input class="input" name="date" type="date" value="${record?.date||todayISO()}" required></div><div><label class="input-label">보정액 USD (+/−)</label><input class="input" name="amountUSD" type="number" step="0.01" value="${n(record?.amountUSD)}" required></div><div><label class="input-label">사유</label><input class="input" name="label" value="${esc(record?.label||'잔액 보정')}" required></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div>${edit?`<button class="record-delete-link" type="button" data-delete-from-edit="cash:${record.id}">이 보정 기록 삭제</button>`:''}</form>`);
    document.getElementById('cashForm')!.onsubmit=async (event: Event)=>{event.preventDefault();const form=submittedFormData(event),date=String(form.get('date')),amountUSD=n(form.get('amountUSD'));if(!isDate(date)||!amountUSD){toast('날짜와 0이 아닌 보정액을 입력해 주세요.');return;}const row: any=record||{id:uid('c'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()};Object.assign(row,{date,amountUSD,label:String(form.get('label')).trim()||'잔액 보정'});if(!edit)state.cashAdjustments.push(row);await saveState(true);closeModal();renderAll();showPage('projects');toast('잔액 보정을 저장했습니다.');};
  }

  function openWithdrawalForm(projectId: any =selectedProjectId,record: any =null): any {
    const project: any=projectById(record?.projectId||projectId),calc=computeProject(project),edit=!!record,recovery=project.recovery||{},available=Math.max(0,calc.dividendAvailable+(edit?Math.abs(n(record.amountUSD)):0)),returnPage=currentPage;
    if(!recovery.locked){toast('원금회수 기준을 먼저 확정해 주세요.');return;}
    openModal(`<h3 class="modal-title">${project.symbol} 배당 인출 ${edit?'수정':'기록'}</h3><p class="modal-desc">실제로 계좌 밖으로 뺀 배당금만 기록합니다. 배당 입금이나 재투자는 원금회수로 계산하지 않습니다.</p><form id="withdrawalForm" class="form-grid"><div class="record-detail-grid"><div><span>사용 가능 배당</span><strong>${fmtMoney(available,2)}</strong></div><div><span>남은 원금</span><strong>${fmtMoney(recoveryStats(calc).remaining,2)}</strong></div></div><div><label class="input-label">인출일</label><input class="input" name="date" type="date" min="${recovery.startDate}" value="${record?.date||todayISO()}" required></div><div><label class="input-label">실제 인출액 USD</label><input class="input" name="amountUSD" type="number" min="0.01" max="${Math.max(.01,round(available,2))}" step="0.01" value="${edit?Math.abs(n(record.amountUSD)):''}" required></div><div><label class="input-label">메모</label><input class="input" name="note" value="${esc(record?.note||'')}" placeholder="예: 생활비 계좌로 이체"></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div>${edit?`<button class="record-delete-link" type="button" data-delete-from-edit="cash:${record.id}">이 인출 기록 삭제</button>`:''}</form>`);
    document.getElementById('withdrawalForm')!.onsubmit=async (event: Event)=>{event.preventDefault();const form=submittedFormData(event),date=String(form.get('date')),amount=n(form.get('amountUSD'));if(!isDate(date)||date<recovery.startDate||amount<=0){toast('회수 시작일 이후의 인출 날짜와 금액을 확인해 주세요.');return;}if(amount>available+.005){toast('사용 가능한 배당금보다 많이 인출할 수 없습니다.');return;}const row: any=record||{id:uid('w'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()};Object.assign(row,{date,amountUSD:-amount,purpose:'recoveryWithdrawal',label:'배당금 인출',note:String(form.get('note')).trim()});if(!edit)state.cashAdjustments.push(row);await saveState(true);closeModal();renderAll();showPage(returnPage==='goal'?'goal':'projects');toast(edit?'인출 기록을 수정했습니다.':'실제 인출액을 원금회수에 반영했습니다.');};
  }

  function openSplitForm(record: any =null): any {
    const project: any=projectById(record?.projectId||selectedProjectId),edit=!!record;
    openModal(`<h3 class="modal-title">${project.symbol} 분할·역분할</h3><p class="modal-desc">예: 2주가 1주가 되면 2 → 1입니다. 보유·평균단가·목표가 함께 조정됩니다.</p><form id="splitForm" class="form-grid"><div><label class="input-label">기준일</label><input class="input" name="date" type="date" value="${record?.date||todayISO()}" required></div><div class="form-grid two"><div><label class="input-label">기존 주수</label><input class="input" name="from" type="number" min="0.0001" step="0.0001" value="${n(record?.from)||2}" required></div><div><label class="input-label">변경 주수</label><input class="input" name="to" type="number" min="0.0001" step="0.0001" value="${n(record?.to)||1}" required></div></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">적용</button></div>${edit?`<button class="record-delete-link" type="button" data-delete-from-edit="split:${record.id}">이 분할 기록 삭제</button>`:''}</form>`);
    document.getElementById('splitForm')!.onsubmit=async (event: Event)=>{event.preventDefault();const form=submittedFormData(event),date=String(form.get('date')),from=n(form.get('from')),to=n(form.get('to'));if(!isDate(date)||from<=0||to<=0){toast('분할 날짜와 비율을 확인해 주세요.');return;}const row: any=record||{id:uid('s'),projectId:project.id,symbol:project.symbol,createdAt:new Date().toISOString()},before=record?clone(record):null;Object.assign(row,{date,from,to,type:to<from?'reverse':'forward'});if(!edit)state.splits.push(row);if(computeProject(project).oversells.length){if(edit)Object.assign(row,before);else state.splits=state.splits.filter((item: any)=>item!==row);toast('이 분할을 반영하면 이후 매도 기록이 보유주수를 초과합니다.');return;}await saveState(true);closeModal();renderAll();showPage('projects');toast('분할 비율을 반영했습니다.');};
  }

  function recordByToken(token: any): any {
    const [kind,id]=String(token).split(':');const key: any={trade:'trades',dividend:'dividends',split:'splits',cash:'cashAdjustments'}[kind];return {kind,key,row:key?state[key].find((x: any)=>String(x.id)===id):null};
  }
  function openRecordDetail(token: any): any {
    const {kind,row}=recordByToken(token);if(!row)return;
    const project: any=projectById(row.projectId),withdrawal=kind==='cash'&&row.purpose==='recoveryWithdrawal',labels: any={trade:'거래 기록',dividend:'배당 기록',cash:withdrawal?'배당 인출 기록':'잔액 보정',split:'분할 기록'};
    const fromToss: any=row.source?.provider==='toss';
    if(kind==='dividend'){
      const sourceLabel: any=fromToss?'토스 동기화 기록':'직접 입력 기록';
      const note: any=row.note&&!/^더미\s/.test(String(row.note))?`<p class="record-note">${esc(row.note)}</p>`:'';
      const action: any=fromToss?'<p class="record-source-note">동기화 원본은 앱에서 수정하지 않습니다.</p>':`<button class="record-edit-link" type="button" data-edit-record="${esc(token)}">직접 입력값 고치기</button>`;
      openModal(`<div class="record-detail-head"><div><span>${esc(project?.symbol||row.symbol||'')} · 세후 배당</span><h3 class="modal-title">${fmtDate(row.date)} 입금</h3></div><b class="record-source-badge ${fromToss?'synced':'manual'}">${sourceLabel}</b></div><div class="record-primary-value"><span>실제 입금액</span><strong>${fmtDividend(row,2)}</strong></div><div class="record-detail-grid compact"><div><span>지급 기준 주수</span><strong>${n(row.sharesAtPayment)>0?fmtShares(row.sharesAtPayment)+'주':'기록 없음'}</strong></div></div>${note}${action}<button class="btn primary record-close" data-close-modal>닫기</button>`);
      return;
    }
    let details: any='';
    if(kind==='trade')details=`<div><span>거래</span><strong>${row.type==='sell'?'매도':'매수'} · ${fmtShares(row.shares)}주</strong></div><div><span>단가</span><strong>${fmtMoney(row.price)}</strong></div><div><span>거래금액</span><strong>${fmtMoney(n(row.shares)*n(row.price))}</strong></div>`;
    if(kind==='dividend')details=`<div><span>세후 배당</span><strong>${fmtMoney(row.amountUSD,2)}</strong></div><div><span>지급 기준 주수</span><strong>${n(row.sharesAtPayment)>0?fmtShares(row.sharesAtPayment)+'주':'기록 없음'}</strong></div>`;
    if(kind==='cash')details=withdrawal?`<div><span>실제 인출액</span><strong>${fmtMoney(Math.abs(n(row.amountUSD)),2)}</strong></div><div><span>원금회수 반영</span><strong>포함</strong></div>`:`<div><span>보정액</span><strong>${fmtSignedMoney(row.amountUSD)}</strong></div><div><span>사유</span><strong>${esc(row.label||'잔액 보정')}</strong></div>`;
    if(kind==='split')details=`<div><span>변경 비율</span><strong>${n(row.from)} → ${n(row.to)}</strong></div>`;
    const management: any=fromToss?'<p class="record-source-note">토스 원본 기록은 이 앱에서 수정하지 않습니다.</p>':`<details class="record-manage"><summary>기록 관리</summary><div><p>직접 입력한 값이 잘못된 경우에만 고치세요.</p><button class="btn soft small" data-edit-record="${esc(token)}">직접 입력값 고치기</button></div></details>`;
    openModal(`<h3 class="modal-title">${esc(project?.symbol||row.symbol||'')} ${labels[kind]||'기록'}</h3><p class="modal-desc">${fmtDate(row.date)}${fromToss?' · 토스에서 가져온 기록':''}</p><div class="record-detail-grid">${details}</div>${row.note?`<p class="record-note">${esc(row.note)}</p>`:''}${management}<button class="btn primary record-close" data-close-modal>닫기</button>`);
  }
  function editRecord(token: any): any { const {kind,row}=recordByToken(token);if(!row)return;if(row.source?.provider==='toss'){toast('토스 동기화 원본은 수정할 수 없습니다.');return;}if(kind==='trade')openTradeForm(row);if(kind==='dividend')openDividendForm(row);if(kind==='cash'&&row.purpose==='recoveryWithdrawal')openWithdrawalForm(row.projectId,row);else if(kind==='cash')openCashForm(row);if(kind==='split')openSplitForm(row); }
  function deleteRecord(token: any): any { const {key,row}=recordByToken(token);if(!row)return;if(row.source?.provider==='toss'){toast('토스 동기화 원본은 삭제할 수 없습니다.');return;}confirmAction('기록 삭제',`${fmtDate(row.date)} 기록을 삭제합니다.`,async()=>{await storageSet(SAFETY_KEY,clone(state));const previous: any=state[key];state[key]=state[key].filter((x: any)=>x.id!==row.id);if((key==='trades'||key==='splits')&&computeProject(row.projectId).oversells.length){state[key]=previous;toast('이 기록을 삭제하면 이후 매도가 보유주수를 초과하므로 삭제하지 않았습니다.');return;}await saveState(true);renderAll();showPage('projects');toast('기록을 삭제했습니다.');},'삭제'); }

  function projectIssues(projectId: any =null): any {
    const projects: any=projectId?[projectById(projectId)]:state.projects, issues=[];
    for(const project of projects.filter(Boolean)){
      const calc: any=computeProject(project),prefix=`${project.symbol}: `;
      if(calc.oversells.length)issues.push(`${prefix}보유량 초과 매도 ${calc.oversells.length}건`);
      if(calc.cashDeficitEvents.length)issues.push(`${prefix}날짜순 배당 원장에서 잔액 부족 ${calc.cashDeficitEvents.length}건 · 최대 ${fmtMoney(Math.abs(calc.minDividendBalance))}`);
      if(!calc.priceAvailable&&calc.shares>0)issues.push(`${prefix}현재가 미입력으로 평가금액·총손익 계산 대기`);
      const futureCount: any=['trades','dividends','splits','cashAdjustments'].reduce((count,key)=>count+projectRows(key,project.id).filter((row: any)=>String(row.date)>todayISO()).length,0);if(futureCount)issues.push(`${prefix}현재 계산에서 제외된 미래 날짜 기록 ${futureCount}건`);
      const badTrade: any=calc.trades.filter((x: any)=>!isDate(x.date)||n(x.shares)<=0||n(x.price)<0);if(badTrade.length)issues.push(`${prefix}잘못된 거래 ${badTrade.length}건`);
      const badDividend: any=calc.dividends.filter((x: any)=>!isDate(x.date)||n(x.amountUSD)<=0);if(badDividend.length)issues.push(`${prefix}잘못된 배당 ${badDividend.length}건`);
      const badSplit: any=projectRows('splits',project.id).filter((x: any)=>!isDate(x.date)||n(x.from)<=0||n(x.to)<=0);if(badSplit.length)issues.push(`${prefix}잘못된 분할 ${badSplit.length}건`);
      const tradeKeys: any=new Set();let duplicates: any=0;calc.trades.forEach((x: any)=>{const key: any=[x.date,x.type,x.buyType,n(x.shares).toFixed(8),n(x.price).toFixed(8)].join('|');if(tradeKeys.has(key))duplicates++;tradeKeys.add(key);});if(duplicates)issues.push(`${prefix}중복 가능 거래 ${duplicates}건`);
      const dividendKeys: any=new Set();let duplicateDividends: any=0;calc.dividends.forEach((x: any)=>{const key: any=[x.date,n(x.amountUSD).toFixed(2),n(x.sharesAtPayment).toFixed(4)].join('|');if(dividendKeys.has(key))duplicateDividends++;dividendKeys.add(key);});if(duplicateDividends)issues.push(`${prefix}중복 가능 배당 ${duplicateDividends}건`);
    }
    return issues;
  }
  function showIssues(projectId: any =null): any { const issues: any=projectIssues(projectId);openModal(`<h3 class="modal-title">${projectId?'프로젝트':'전체'} 점검</h3>${issues.length?`<div class="check-list">${issues.map((x: any)=>`<div class="check-item">${esc(x)}</div>`).join('')}</div>`:'<div class="check-ok">오류가 발견되지 않았습니다.</div>'}<button class="btn primary" style="width:100%;margin-top:14px" data-close-modal>확인</button>`); }

  function lockRecovery(projectId: any,editing: any =false): any {
    const calc: any=computeProject(projectId),project=calc.project;
    const basis: any=editing&&project.recovery?.locked?n(project.recovery.basis):calc.targetBasisSuggestion,startDate=editing&&project.recovery?.locked?project.recovery.startDate:(calc.targetReachedDate||todayISO());
    openModal(`<h3 class="modal-title">${project.symbol} 원금회수 기준 ${editing?'수정':'확정'}</h3><p class="modal-desc">목표 달성 시점까지 직접 넣은 순투입 원금을 고정합니다. 이후에는 실제로 계좌 밖으로 인출한 배당금만 회수액으로 계산합니다.</p><form id="recoveryForm" class="form-grid"><div><label class="input-label">기준원금 USD</label><input class="input" name="basis" type="number" min="0.01" step="0.01" required value="${round(basis,2)}"></div><div><label class="input-label">회수 시작일</label><input class="input" name="startDate" type="date" required value="${startDate}"></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">${editing?'수정 저장':'확정'}</button></div></form>`);
    document.getElementById('recoveryForm')!.onsubmit=async (event: Event)=>{event.preventDefault();const form=submittedFormData(event),nextBasis=n(form.get('basis')),nextStartDate=String(form.get('startDate'));if(nextBasis<=0||!isDate(nextStartDate)){toast('기준원금과 시작일을 확인해 주세요.');return;}project.recovery={locked:true,basis:nextBasis,startDate:nextStartDate,targetReachedDate:project.recovery?.targetReachedDate||calc.targetReachedDate||nextStartDate,calculatedBasisAtLock:calc.targetBasisSuggestion,confirmedAt:new Date().toISOString(),method:'withdrawnOnly'};await saveState(true);closeModal();renderAll();showPage('goal');toast(editing?'원금회수 기준을 수정했습니다.':'원금회수 단계를 시작했습니다.');};
  }

  function downloadFile(filename: any,content: any,type: any ='application/octet-stream'): any { const blob: any=content instanceof Blob?content:new Blob([content],{type});const url: any=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500); }
  let backupRunning: any=false,backupObjectUrl='',preparedBackup: any=null,preparedBackupFilename='';
  async function nativeBackupFile(download=false): Promise<boolean> {
    const native=window?.Capacitor?.Plugins?.BackupFile;
    if(!native)return false;
    const data=await preparedBackup.arrayBuffer();
    if(data.byteLength>32*1024*1024)throw new Error('백업 파일이 너무 큽니다.');
    const bytes=new Uint8Array(data);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const result=await native[download?'download':'save']({filename:preparedBackupFilename,base64:btoa(binary)});
    if(!result?.cancelled&&result?.saved){state.meta.lastBackupAt=new Date().toISOString();await saveState(true);closeModal();toast(download?'다운로드 폴더에 ZIP 백업을 저장했습니다.':'선택한 위치에 ZIP 백업을 저장했습니다.');}
    return true;
  }
  async function downloadPreparedBackup(): Promise<void> {
    if(!preparedBackup){toast('백업을 다시 준비해 주세요.');return;}
    try{
      if(await nativeBackupFile(true))return;
      if(window?.Capacitor?.isNativePlatform?.()){toast('파일 저장을 지원하는 새 APK로 업데이트해 주세요. 앱은 삭제하지 마세요.');return;}
      downloadFile(preparedBackupFilename,preparedBackup,'application/zip');toast('브라우저에 백업 다운로드를 요청했습니다. 다운로드 목록을 확인해 주세요.');
    }catch (error: unknown){toast('백업 저장에 실패했습니다. 다시 시도해 주세요.');}
  }
  async function saveBackupToChosenLocation(): Promise<any> {
    if(!preparedBackup||!preparedBackupFilename){toast('백업을 다시 준비해 주세요.');return;}
    try{
      if(await nativeBackupFile())return;
      if(window?.Capacitor?.isNativePlatform?.()){toast('저장 위치 선택은 새 APK에서 지원합니다. 앱은 삭제하지 말고 업데이트해 주세요.');return;}
      const picker: any=(window as any).showSaveFilePicker;
      if(typeof picker==='function'){
        const handle: any=await picker({suggestedName:preparedBackupFilename,types:[{description:'DividendOS ZIP 백업',accept:{'application/zip':['.zip']}}]});
        const writable: any=await handle.createWritable();await writable.write(preparedBackup);await writable.close();
        closeModal();toast('선택한 위치에 ZIP 백업을 저장했습니다.');return;
      }
      const file: any=new File([preparedBackup],preparedBackupFilename,{type:'application/zip'}),nav: any=navigator;
      if(typeof nav.share==='function'&&typeof nav.canShare==='function'&&nav.canShare({files:[file]})){
        await nav.share({files:[file],title:'DividendOS 백업'});closeModal();toast('선택한 앱으로 ZIP 백업을 전달했습니다.');return;
      }
      downloadFile(preparedBackupFilename,preparedBackup,'application/zip');toast('브라우저에 다운로드를 요청했습니다. 다운로드 목록을 확인해 주세요.');
    }catch (error: unknown){
      if(isRecord(error)&&error.name==='AbortError')return;
      console.error(error);toast('위치 선택 저장에 실패했습니다. 아래 다운로드 저장을 사용해 주세요.');
    }
  }
  async function downloadBackup(): Promise<any> {
    if(backupRunning)return;backupRunning=true;
    openModal('<h3 class="modal-title">백업 준비</h3><p class="modal-desc" role="status">앱과 기록을 ZIP으로 묶고 있습니다.</p>');
    try{
      const zip: any=await buildPortableBackup(clone(state));
      if(backupObjectUrl)URL.revokeObjectURL(backupObjectUrl);
      backupObjectUrl=URL.createObjectURL(zip);
      const stamp: any=new Date().toISOString().replace(/[-:]/g,'').replace(/\\.\\d{3}Z$/,'Z').replace('T','_'),filename=`DividendOS_v${APP_VERSION}_${stamp}.zip`;
      preparedBackup=zip;preparedBackupFilename=filename;
      openModal(`<h3 class="modal-title">백업 준비 완료</h3><p class="modal-desc">종목 ${state.projects.length}개 · 거래 ${state.trades.length}건 · 배당 ${state.dividends.length}건<br>저장 위치를 직접 선택하거나 다운로드 폴더에 바로 저장할 수 있습니다.</p><div class="form-grid"><button class="btn primary backup-download" data-backup-save>저장 위치 선택</button><button class="btn soft backup-download" data-backup-download>다운로드 폴더에 저장</button></div><p class="detail-note">설치 앱은 Android 저장 창을 사용합니다. 웹에서는 지원되는 저장 창·공유·다운로드를 사용합니다. 저장 후 파일을 확인해 주세요.</p>`);
      state.meta.lastBackupPreparedAt=new Date().toISOString();await saveState(true);
    }catch (error: unknown){console.error(error);openModal('<h3 class="modal-title">백업 준비 실패</h3><p class="modal-desc">기록은 그대로 유지됩니다. 연결 상태를 확인하고 다시 시도해 주세요.</p>');}
    finally{backupRunning=false;}
  }
  async function restoreFromFile(file: any): Promise<any> {
    try {
      const parsed: any=await readStateFromBackupFile(file);
      if(Number(parsed.schemaVersion)>=DATA_SCHEMA_VERSION){const rawIssues: any=validateLedger(parsed);if(rawIssues.length)throw new Error(rawIssues.join(' '));}
      const restored: any=migrate(parsed),issues=validateLedger(restored);
      if(issues.length)throw new Error(issues.join(' '));
      const engine: any=createPortfolioEngine(()=>restored,()=>restored.projects[0].id);
      if(engine.totals().rows.some((c: any)=>c.oversells.length))throw new Error('보유량을 초과하는 매도 기록이 있습니다.');
      openModal(`<h3 class="modal-title">백업 복원 확인</h3><p class="modal-desc">종목 ${restored.projects.length}개 · 거래 ${restored.trades.length}건 · 배당 ${restored.dividends.length}건<br>현재 V4 기록을 교체합니다. 현재 기록은 기기에 안전 복사하며 기존 MSTY 원본은 건드리지 않습니다.</p><div class="modal-actions"><button class="btn soft" data-close-modal>취소</button><button class="btn primary" id="confirmRestore">확인 후 복원</button></div>`);
      document.getElementById('confirmRestore')!.onclick=async()=>{const previousProjectId: any=selectedProjectId;await storageSet(SAFETY_KEY,clone(state));state=restored;selectedProjectId=activeProjects().some((project: any)=>project.id===previousProjectId)?previousProjectId:(activeProjects()[0]?.id||'');await saveState(true);closeModal();renderAll();showPage('home');toast('대조를 통과한 백업을 복원했습니다.');};
    }catch (error: unknown){toast(errorMessage(error)||'지원되는 DividendOS ZIP이 아닙니다.');}
  }
  async function restoreSafetyCopy(): Promise<any> {
    const previous: any=await storageGet(SAFETY_KEY);
    if(!previous){toast('되돌릴 안전 사본이 없습니다.');return;}
    const restored: any=migrate(previous),issues=validateLedger(restored);
    if(issues.length){toast('안전 사본을 확인할 수 없습니다. ZIP 백업을 사용해 주세요.');return;}
    confirmAction('직전 안전 사본 복원',`종목 ${restored.projects.length}개 · 거래 ${restored.trades.length}건 · 배당 ${restored.dividends.length}건으로 되돌립니다. 현재 기록도 안전 사본으로 보관합니다.`,async()=>{
      const previousProjectId: any=selectedProjectId;await storageSet(SAFETY_KEY,clone(state));state=restored;selectedProjectId=activeProjects().some((project: any)=>project.id===previousProjectId)?previousProjectId:(activeProjects()[0]?.id||'');await saveState(true);renderAll();showPage('home');toast('직전 안전 사본으로 복원했습니다.');
    },'되돌리기');
  }
  async function restoreLatestAutoBackup(): Promise<any>{
    const entries: any=await refreshAutoBackupStatus();if(!entries.length){toast('자동 백업이 없습니다.');return;}
    const backup: any=await readAutoBackup(backupStorage,entries[0].id),restored=migrate(backup?.state),issues=validateLedger(restored);if(!backup||issues.length){toast('자동 백업을 확인할 수 없습니다.');return;}
    confirmAction('최근 자동 백업 복원',`${entries[0].createdAt.slice(0,16).replace('T',' ')} 기록으로 되돌립니다. 현재 기록도 먼저 안전 복사합니다.`,async()=>{await storageSet(SAFETY_KEY,clone(state));state=restored;selectedProjectId=activeProjects()[0]?.id||'';await saveState(true);renderAll();showPage('home');toast('최근 자동 백업을 복원했습니다.');},'복원');
  }
  function exportCSV(): any{downloadFile(`DividendOS_CSV_${todayISO().replaceAll('-','')}.zip`,buildCsvExportZip(state));toast('종목·거래·배당·목표 CSV 4개를 저장했습니다.');}

  async function chooseInitialSync(cloudState: any,review=false): Promise<string> {
    const localHas=hasMeaningfulData(state),cloudHas=hasMeaningfulData(cloudState);
    if(!cloudHas)return localHas?'local':'blank';
    if(!localHas)return 'cloud';
    const choice=chooseCloudSync(state,cloudState,cloudBaseSignature);
    if(choice!=='review')return choice;
    if(!review)return 'cancel';
    return new Promise(resolve=>{
      openModal(`<h3 class="modal-title">클라우드 기록 확인</h3><p class="modal-desc">기기와 클라우드에 서로 다른 기록이 있습니다.<br>기기: 거래 ${state.trades.length}건 · 배당 ${state.dividends.length}건<br>클라우드: 거래 ${cloudState.trades.length}건 · 배당 ${cloudState.dividends.length}건<br>선택하지 않아도 로그인과 기기 저장은 계속 사용할 수 있습니다.</p><div class="form-grid"><button class="btn primary" id="useLocal">이 기기 기록을 클라우드에 저장</button><button class="btn secondary" id="useCloud">클라우드 기록으로 기기 교체</button></div>`);
      cloudChoiceResolve=resolve;
      for(const [id,choice] of [['useLocal','local'],['useCloud','cloud']])document.getElementById(id)!.onclick=()=>{cloudChoiceResolve=null;closeModal();resolve(choice);};
    });
  }
  async function connectCloudForUser(user: any,review=false): Promise<any> {
    const generation=++cloudConnectGeneration;
    document.getElementById('authGate')?.classList.add('hidden');
    currentUser=user;cloudReady=false;cloudUnsubscribe?.();cloudUnsubscribe=null;setSaveStatus('동기화 확인','cloud-busy');
    try{
      const baseSignature=await storageGet<string>('cloudSyncBase:'+user.uid)||null;
      if(generation!==cloudConnectGeneration||currentUser?.uid!==user.uid)return;cloudBaseSignature=baseSignature;
      let cloudData: any=await getCloudDocument(user.uid),cloudState=cloudData?.state?migrate(cloudData.state):null,usingLegacyCloud=false,usingSingleDocument=!!cloudData?.legacySingleDocument;
      if(generation!==cloudConnectGeneration||currentUser?.uid!==user.uid)return;cloudRevision=Math.max(0,n(cloudData?.revision));
      if(!cloudState){const legacy: any=await getLegacyCloudDocument(user.uid);if(legacy?.state){legacyMigrationSource=legacy.state;cloudState=prepareLegacyMigration(legacy.state).candidate;usingLegacyCloud=true;}}
      else if(!cloudState.meta?.migrationAudit){const legacy: any=await getLegacyCloudDocument(user.uid);if(legacy?.state){legacyMigrationSource=legacy.state;const audit: any=auditLegacyAgainstState(legacy.state,cloudState);if(audit?.passed)cloudState.meta.migrationAudit=audit;else cloudState.meta.legacyMigrationAvailable=true;}}
      if(generation!==cloudConnectGeneration||currentUser?.uid!==user.uid)return;
      const choice: any=await chooseInitialSync(cloudState,review);
      if(generation!==cloudConnectGeneration||currentUser?.uid!==user.uid)return;
      if(choice==='cancel'){pendingCloudState=cloudState;setSaveStatus('기기 저장 · 클라우드 확인 필요','cloud-error');renderAll();return;}
      if(cloudState){const issues: any=validateLedger(cloudState);if(issues.length)throw new Error(issues.join(' '));}
      if(review&&choice==='local'&&cloudState&&syncSignature(state)!==syncSignature(cloudState))await storageSet(SAFETY_KEY,clone(cloudState));
      pendingCloudState=null;
      if(choice==='cloud'&&cloudState){await storageSet(SAFETY_KEY,clone(state));await storageSet(STATE_KEY,cloudState);state=cloudState;cloudBaseSignature=syncSignature(state);await storageSet('cloudSyncBase:'+user.uid,cloudBaseSignature);cloudReady=true;if(usingLegacyCloud||usingSingleDocument)await pushCloudState();}else{cloudReady=true;await pushCloudState();}
      if(generation!==cloudConnectGeneration||currentUser?.uid!==user.uid)return;
      selectedProjectId=activeProjects()[0]?.id||'';renderAll();showPage(currentPage);document.getElementById('authGate')?.classList.add('hidden');
      const unsubscribe=await subscribeCloudDocument(user.uid,(data: any)=>{
        if(generation!==cloudConnectGeneration||currentUser?.uid!==user.uid||!data?.state||applyingCloudState||cloudWritePending||n(data.revision)<=cloudRevision)return;
        const remote: any=migrate(data.state);pendingCloudState=remote;cloudRevision=n(data.revision);cloudReady=false;clearTimeout(cloudTimer);autoBackup('remote-conflict');setSaveStatus('다른 기기 변경 · 확인 필요','cloud-error');toast('기록을 자동 교체하지 않았습니다. 설정에서 클라우드 기록 확인을 눌러 주세요.');renderAll();
      },(error: any)=>{if(generation!==cloudConnectGeneration||currentUser?.uid!==user.uid)return;console.error(error);cloudReady=false;setSaveStatus('동기화 오류','cloud-error');});
      if(generation!==cloudConnectGeneration||currentUser?.uid!==user.uid){unsubscribe?.();return;}cloudUnsubscribe=unsubscribe;
      setSaveStatus('','cloud-ok');
    }catch (error: unknown){if(generation!==cloudConnectGeneration||currentUser?.uid!==user.uid)return;cloudReady=false;clearTimeout(cloudTimer);console.error(error);setSaveStatus('연결 오류','cloud-error');document.getElementById('authGate')?.classList.add('hidden');toast('클라우드 연결에 실패했습니다. 기기 저장으로 사용할 수 있습니다.');}
  }
  async function initAuth(): Promise<any>{await initGoogleAuth({loginButtonId:'googleLoginBtn',statusElementId:'authGateStatus',onSignedIn:connectCloudForUser,onSignedOut:()=>{cloudConnectGeneration++;currentUser=null;cloudBaseSignature=null;pendingCloudState=null;cloudReady=false;cloudRevision=0;cloudUnsubscribe?.();cloudUnsubscribe=null;setSaveStatus('');document.getElementById('authGate')?.classList.add('hidden');},onError:(message: any)=>toast(message,{haptic:true})});}

  function refreshTossComparisons(): any {
    const toss: any=state.integrations.toss;
    toss.comparisons=(toss.comparisons||[]).map((row: any)=>{
      const project: any=findProjectForToss(row);
      const appShares: any=project?computeProject(project).shares:0;
      return {...row,appShares,difference:n(row.shares)-appShares};
    });
  }

  function adoptMatchingTossDividends(): any{
    const toss: any=state.integrations.toss,adoptedIds=new Set();let adopted: any=0;
    for(const adoption of automaticTossDividendAdoptions(toss.dividendCandidates||[])){
      const row: any=adoption.candidate;
      const dividend: any=state.dividends.find((item: any)=>item.id===adoption.manualId&&item.source?.provider!=='toss');
      if(!dividend)continue;
      dividend.source={provider:'toss',externalId:row.externalId,rawExternalId:row.rawExternalId,sourceIdKind:row.sourceIdKind,sourceFingerprint:row.sourceFingerprint,accountId:row.accountId,assetKey:row.assetKey,market:row.market,securityId:row.securityId,importedAt:new Date().toISOString(),adoptedManual:true};
      adoptedIds.add(String(row.externalId||''));adopted++;
    }
    if(adoptedIds.size)toss.dividendCandidates=(toss.dividendCandidates||[]).filter((row: any)=>!adoptedIds.has(String(row?.externalId||'')));
    return adopted;
  }

  async function tryAutomaticTossImport(): Promise<any>{
    refreshTossCandidateConflicts(state.integrations.toss,state.trades,state.dividends);
    const plan: any=automaticTossImportPlan(state.integrations.toss);
    if(!plan.eligible){
      const comparisons=(state.integrations.toss.comparisons||[]).filter((row: any)=>row.supported);
      const matches=comparisons.length>0&&comparisons.every((row: any)=>Math.abs(n(row.difference))<.0001);
      const current=['duplicate','empty'].includes(plan.reason)&&matches;
      const reason=plan.reason==='empty'&&comparisons.length>0&&!matches?'reconciliation':plan.reason;
      state.integrations.toss.lastAutoImportReason=current?'':reason;
      return {imported:0,reason:current?'current':reason};
    }
    const before: any=clone(state),importedTradeIds=new Set(),importedDividendIds=new Set(),affectedProjectIds=new Set();
    let buys: any=0,sells: any=0,dividends: any=0;
    try{
      for(const row of plan.candidates){
        const normalized: any=normalizeTossOrder(row);if(!normalized||normalized.currency!=='USD')throw new Error('invalid-candidate');
        let project: any=findProjectForToss(normalized,{attach:true});
        if(!project){project=blankProject(normalized.symbol,normalized.name);project.colorIndex=state.projects.length%PROJECT_COLORS.length;state.projects.push(project);}
        findProjectForToss(normalized,{attach:true});
        if(state.trades.some((item: any)=>item.source?.provider==='toss'&&[item.source.externalId,item.source.rawExternalId].includes(normalized.externalId)))continue;
        const trade: any=tossCandidateToTrade(normalized,{projectId:project.id,id:uid('t')} as any);if(!trade)throw new Error('invalid-trade');
        state.trades.push(trade);importedTradeIds.add(normalized.externalId);affectedProjectIds.add(project.id);trade.type==='sell'?sells++:buys++;
      }
      for(const row of plan.dividendCandidates){
        let project: any=findProjectForToss(row,{attach:true});
        if(!project){project=blankProject(row.symbol,row.name);project.colorIndex=state.projects.length%PROJECT_COLORS.length;state.projects.push(project);}
        findProjectForToss(row,{attach:true});
        if(state.dividends.some((item: any)=>item.source?.provider==='toss'&&[item.source.externalId,item.source.rawExternalId].includes(row.externalId)))continue;
        const dividend: any=tossCandidateToDividend(row,{projectId:project.id,id:uid('d'),sharesAtPayment:sharesAtDate(project.id,row.date)} as any);if(!dividend)throw new Error('invalid-dividend');
        state.dividends.push(dividend);importedDividendIds.add(row.externalId);dividends++;
      }
      if([...affectedProjectIds].some((projectId: any)=>computeProject(projectId).oversells.length))throw new Error('oversell');
      if(validateLedger(state).length)throw new Error('ledger');
      refreshTossComparisons();
      const supported: any=(state.integrations.toss.comparisons||[]).filter((row: any)=>row.supported);
      if(!supported.length||supported.some((row: any)=>Math.abs(n(row.difference))>=.0001))throw new Error('reconciliation');
      const imported: any=buys+sells+dividends;if(!imported)throw new Error('empty-import');
      state.integrations.toss.candidates=state.integrations.toss.candidates.filter((row: any)=>!importedTradeIds.has(String(row?.externalId||'')));
      state.integrations.toss.dividendCandidates=state.integrations.toss.dividendCandidates.filter((row: any)=>!importedDividendIds.has(String(row?.externalId||'')));
      state.integrations.toss.lastAutoImportReason='';
      return {imported,buys,sells,dividends,reason:''};
    }catch (error: unknown){state=before;state.integrations.toss.lastAutoImportReason=errorMessage(error)||'validation';return {imported:0,reason:errorMessage(error)||'validation'};}
  }

  async function refreshNativeTossStatus(): Promise<any>{
    if(!nativeTossStatus.available)return nativeTossStatus;
    try{nativeTossStatus={...nativeTossStatus,...await nativeTossCredentialStatus()};}
    catch (_: unknown){nativeTossStatus={...nativeTossStatus,configured:false};}
    return nativeTossStatus;
  }

  async function refreshAppUpdateStatus(): Promise<any>{
    if(!appUpdateStatus.available)return appUpdateStatus;
    appUpdateStatus={...appUpdateStatus,checking:true,error:''};
    try{appUpdateStatus={...appUpdateStatus,...await fetchHotUpdateStatus(),checking:false,error:''};}
    catch (error: unknown){appUpdateStatus={...appUpdateStatus,checking:false,error:errorMessage(error)||'업데이트 확인 실패'};}
    return appUpdateStatus;
  }

  async function applyAppUpdate(): Promise<any>{
    if(appUpdateStatus.checking)return;
    appUpdateStatus={...appUpdateStatus,checking:true,error:''};renderSettings();showPage('settings');
    try{await installHotUpdate();toast('업데이트를 적용하고 다시 시작합니다.');}
    catch (error: unknown){appUpdateStatus={...appUpdateStatus,checking:false,error:errorMessage(error)||'업데이트 실패'};renderSettings();showPage('settings');toast(appUpdateStatus.error);}
  }

  function openNativeTossSetup(): any{
    openModal(`<h3 class="modal-title">토스 최초 설정</h3><p class="modal-desc">토스 WTS에서 발급한 Client ID와 Secret을 한 번만 입력하세요. 이 기기의 Android 보안 저장소에 암호화해 보관하며 화면에 다시 표시하지 않습니다.</p><form id="tossNativeSetupForm" class="form-grid"><div><label class="input-label">Client ID</label><input class="input" name="clientId" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="256"></div><div><label class="input-label">Client Secret</label><input class="input" name="clientSecret" type="password" autocomplete="new-password" required maxlength="512"></div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">안전하게 저장</button></div></form>`);
    document.getElementById('tossNativeSetupForm')!.onsubmit=async(event: Event)=>{
      event.preventDefault();if(modalSaving)return;modalSaving=true;
      const form=submittedFormData(event);
      try{await saveNativeTossCredentials(String(form.get('clientId')||''),String(form.get('clientSecret')||''));nativeTossStatus={...nativeTossStatus,configured:true};modalDirty=false;closeModal();renderSettings();showPage('settings');toast('토스 키를 이 기기에 저장했습니다.');await syncNativeTossReadOnly();}
      catch (error: unknown){toast(errorMessage(error)||'토스 키를 저장하지 못했습니다.');}
      finally{modalSaving=false;}
    };
  }

  async function copyTossIp(ip: any=pendingTossIp||nativeTossStatus.publicIp): Promise<any>{
    if(!ip){toast('복사할 IP가 없습니다.');return;}
    try{await navigator.clipboard.writeText(ip);toast('현재 IP를 복사했습니다.');}
    catch (_: unknown){toast(`현재 IP: ${ip}`);}
  }

  function openTossIpStep(ip: any): any{
    pendingTossIp=ip;
    openModal(`<h3 class="modal-title">토스에 현재 IP 등록</h3><p class="modal-desc">휴대폰 인터넷 주소가 바뀌었습니다. 아래 IP를 복사해 토스 WTS의 설정 → Open API → 허용 IP에 등록하세요.</p><div class="list"><div class="list-row"><div><div class="row-title">현재 IP</div><div class="row-sub">${esc(ip)}</div></div><button class="btn soft small" data-toss-copy-ip>복사</button></div></div><div class="modal-actions"><button class="btn soft" data-open-toss-ip>토스 WTS 열기</button><button class="btn primary" data-confirm-toss-ip>등록 완료 · 갱신</button></div>`);
  }

  async function syncNativeTossReadOnly({ipConfirmed=false}: any={}): Promise<any>{
    if(tossSyncRunning)return;
    if(!nativeTossStatus.configured){openNativeTossSetup();return;}
    nativeTossStatus={...nativeTossStatus,checking:true};renderSettings();showPage('settings');
    let currentIp: any='';
    try{currentIp=await nativePublicIp();nativeTossStatus={...nativeTossStatus,publicIp:currentIp,checking:false};}
    catch (error: unknown){nativeTossStatus={...nativeTossStatus,checking:false};renderSettings();toast(errorMessage(error)||'현재 IP를 확인하지 못했습니다.');return;}
    if(!ipConfirmed&&nativeTossStatus.lastPublicIp!==currentIp){renderSettings();openTossIpStep(currentIp);return;}
    pendingTossIp='';
    return runTossImport(async()=>{const snapshot: any=await fetchNativeTossSnapshot({from:nextTossSyncFrom(state.integrations.toss),symbols:activeProjects().map((project: any)=>project.symbol)});await markNativeTossPublicIp(currentIp);nativeTossStatus={...nativeTossStatus,lastPublicIp:currentIp};return snapshot;},'Toss Android read-only sync error');
  }

  function tossLinkOf(row: any): any{return {provider:'toss',assetKey:String(row?.assetKey||''),market:String(row?.market||''),securityId:String(row?.securityId||''),symbol:String(row?.symbol||'').toUpperCase(),currency:String(row?.currency||'').toUpperCase()};}
  function findProjectForToss(row: any,{attach=false}: any ={}): any{
    const assetKey: any=String(row?.assetKey||''),symbol=String(row?.symbol||'').toUpperCase();
    let project: any=assetKey?state.projects.find((item: any)=>!item.archived&&(item.brokerLinks||[]).some((link: any)=>link.provider==='toss'&&link.assetKey===assetKey)):null;
    if(!project){const matches: any=state.projects.filter((item: any)=>!item.archived&&item.symbol===symbol);if(matches.length===1)project=matches[0];}
    if(project&&attach&&assetKey&&!(project.brokerLinks||[]).some((link: any)=>link.provider==='toss'&&link.assetKey===assetKey))project.brokerLinks=[...(project.brokerLinks||[]),tossLinkOf(row)];
    return project||null;
  }

  async function applyTossSnapshot(snapshot: any,attemptAt: any): Promise<any> {
    const toss: any=state.integrations.toss;
    if(accountScopeChanged(toss.accountScopeId,snapshot.accountScopeId))throw Object.assign(new Error('연결된 토스 계좌 구성이 바뀌었습니다. 기존 계정 데이터와 섞지 않도록 가져오기를 중단했습니다.'),{code:'account-scope-changed'});
    const syncProjects: any=activeProjects(),symbolCounts=new Map();for(const project of syncProjects)symbolCounts.set(project.symbol,(symbolCounts.get(project.symbol)||0)+1);
    const appPositions: any=syncProjects.flatMap((project: any)=>{const shares: any=computeProject(project).shares,links=(project.brokerLinks||[]).filter((link: any)=>link.provider==='toss').map((link: any)=>({symbol:project.symbol,assetKey:link.assetKey,shares})),symbolFallback=symbolCounts.get(project.symbol)===1?[{symbol:project.symbol,shares}]:[];return [...links,...symbolFallback];});
    const result: any=filterDismissedTossExceptions(buildTossSync(snapshot,{existingTrades:state.trades,existingDividends:state.dividends,appPositions}),toss.dismissedExceptionKeys||[]);
    const progress: any=tossSyncProgress(toss,result);
    Object.assign(toss,{status:result.syncStatus==='partial'?'partial':'connected',syncStatus:result.syncStatus,lastSyncAt:result.fetchedAt,...progress,lastAttemptAt:attemptAt,lastError:'',accountLabel:result.accountLabel,accountScopeId:result.accountScopeId,accountResults:result.accountResults,failedAccountCount:result.failedAccountCount,capabilities:result.capabilities,holdings:result.holdings,comparisons:result.comparisons,ignoredCount:result.ignoredCount,matchedExistingCount:result.matchedExistingCount,matchedExistingDividendCount:result.matchedExistingDividendCount,unsupportedCurrencyCount:result.unsupportedCurrencyCount,historyTruncated:result.historyTruncated,candidates:mergeTossCandidates(toss.candidates,result.candidates),dividendCandidates:mergeTossDividendCandidates(toss.dividendCandidates,result.dividendCandidates),correctionCandidates:mergeTossCorrectionCandidates(toss.correctionCandidates,result.correctionCandidates),dividendCorrectionCandidates:mergeTossDividendCandidates(toss.dividendCorrectionCandidates,result.dividendCorrectionCandidates),syncSequence:n(toss.syncSequence)+1,sourceLedger:mergeTossSourceLedger(toss.sourceLedger,snapshot,result.fetchedAt)});
    for(const price of result.prices||[]){
      if(price.currency!=='USD')continue;
      const project: any=findProjectForToss(price);
      if(project){project.currentPrice=price.lastPrice;project.priceSource='toss';project.priceUpdatedAt=price.timestamp||new Date().toISOString();}
    }
    const beforeAutomaticChanges: any=clone(state),adoptedDividends: any=adoptMatchingTossDividends(),automatic: any=await tryAutomaticTossImport();
    if(adoptedDividends||automatic.imported)await storageSet(SAFETY_KEY,beforeAutomaticChanges);
    await saveState(true);renderAll();showPage('settings');const found: any=result.candidates.length+result.dividendCandidates.length,changed=result.correctionCandidates.length+result.dividendCorrectionCandidates.length;
    toast(automatic.imported?`자동 확인 완료 · 매수 ${automatic.buys}건 · 매도 ${automatic.sells}건${automatic.dividends?` · 배당 ${automatic.dividends}건`:''}${adoptedDividends?` · 기존 배당 ${adoptedDividends}건 연결`:''}`:adoptedDividends?`기존 배당 ${adoptedDividends}건을 중복 없이 토스 원본에 연결했습니다.`:result.syncStatus==='partial'?`일부 계좌만 조회됐습니다. 성공한 기록 ${found}건을 보존했습니다.`:changed?`신규 ${found}건 · 원본 변경 ${changed}건을 확인했습니다.`:automatic.reason==='current'?'토스 보유주수와 일치합니다. 새로 저장할 거래는 없습니다.':automatic.reason&&automatic.reason!=='empty'?`조회 완료 · 거래 저장 보류: ${({duplicate:'기존 수동 거래와 중복 가능',correction:'기존 체결 원본 변경',reconciliation:'체결 합계와 보유주수 불일치',oversell:'중간 보유주수 초과 매도',truncated:'체결 조회 누락',partial:'일부 계좌 조회 실패',ledger:'장부 검증 실패',validation:'장부 검증 실패'} as any)[automatic.reason]||'거래 검증 필요'}`:'토스 계좌와 대조했습니다. 신규 기록은 없습니다.');
  }

  async function runTossImport(loadSnapshot: any,errorPrefix: any): Promise<any> {
    if(tossSyncRunning)return;
    tossSyncRunning=true;
    const beforeSync: any=clone(state.integrations.toss),attemptAt=new Date().toISOString();
    state.integrations.toss.status='syncing';state.integrations.toss.lastAttemptAt=attemptAt;state.integrations.toss.lastError='';renderSettings();showPage('settings');
    try{
      const snapshot: any=await loadSnapshot();
      await applyTossSnapshot(snapshot,attemptAt);
    }catch (error: unknown){
      console.error(errorPrefix,error);state.integrations.toss={...beforeSync,status:'error',lastAttemptAt:attemptAt,lastError:errorMessage(error)||'토스 조회 파일을 처리하지 못했습니다.'};await saveState();renderSettings();showPage('settings');toast(state.integrations.toss.lastError);
    }finally{tossSyncRunning=false;if(state.integrations.toss.status==='syncing')state.integrations.toss.status='not_connected';renderSettings();showPage('settings');}
  }

  async function syncTossReadOnly(): Promise<any> {
    if(nativeTossStatus.available)return syncNativeTossReadOnly();
    return runTossImport(()=>fetchTossSnapshot({from:nextTossSyncFrom(state.integrations.toss),symbols:activeProjects().map((project: any)=>project.symbol)}),'Toss read-only sync error');
  }

  async function importTossSnapshotFile(file: any): Promise<any> {
    return runTossImport(()=>readTossSnapshotFile(file),'Toss snapshot import error');
  }

  async function rebuildMstyFromToss(): Promise<any>{
    const projects: any=activeProjects().filter((project: any)=>project.symbol==='MSTY');
    if(projects.length!==1){toast(projects.length?'MSTY 프로젝트가 여러 개라 하나로 정리한 뒤 실행해 주세요.':'MSTY 프로젝트가 없습니다.');return;}
    const project: any=projects[0],toss: any=state.integrations.toss,before: any=clone(state);
    const rebuilt: any=rebuildProjectFromTossSource({project,sourceLedger:toss.sourceLedger,currentTrades:state.trades,currentDividends:state.dividends,capabilities:toss.capabilities,syncStatus:toss.syncStatus,failedAccountCount:toss.failedAccountCount,historyTruncated:toss.historyTruncated,makeId:uid,sharesAtDate:(date: any)=>sharesAtDate(project.id,date)});
    const reasonText: any={partial:'모든 토스 계좌의 전체 조회가 완료되지 않았습니다.',truncated:'토스 체결 이력이 일부 잘려 있습니다.','empty-orders':'보존된 MSTY 토스 체결 원본이 없습니다.',project:'MSTY 프로젝트를 확인하지 못했습니다.'};
    if(!rebuilt.ok){toast(reasonText[rebuilt.reason]||'MSTY 원장을 다시 만들 수 없습니다.');return;}
    state.trades=rebuilt.trades;state.dividends=rebuilt.dividends;
    if(rebuilt.dividendSourceSupported)for(const row of state.dividends.filter((item: any)=>item.projectId===project.id))row.sharesAtPayment=sharesAtDate(project.id,row.date);
    for(const row of toss.sourceLedger?.orders||[])if(String(row?.symbol||'').toUpperCase()==='MSTY')findProjectForToss(row,{attach:true});
    toss.candidates=(toss.candidates||[]).filter((row: any)=>String(row?.symbol||'').toUpperCase()!=='MSTY');
    if(rebuilt.dividendSourceSupported)toss.dividendCandidates=(toss.dividendCandidates||[]).filter((row: any)=>String(row?.symbol||'').toUpperCase()!=='MSTY');
    toss.correctionCandidates=(toss.correctionCandidates||[]).filter((row: any)=>String(row?.symbol||'').toUpperCase()!=='MSTY');
    if(rebuilt.dividendSourceSupported)toss.dividendCorrectionCandidates=(toss.dividendCorrectionCandidates||[]).filter((row: any)=>String(row?.symbol||'').toUpperCase()!=='MSTY');
    refreshTossComparisons();
    const oversold: any=computeProject(project.id).oversells.length>0,comparisons=(toss.comparisons||[]).filter((row: any)=>row.symbol==='MSTY'&&row.supported),mismatch=comparisons.length!==1||comparisons.some((row: any)=>Math.abs(n(row.difference))>=.0001);
    if(oversold||mismatch||validateLedger(state).length){state=before;toast(oversold?'토스 원본에 과매도가 있어 기존 기록을 유지했습니다.':mismatch?'토스 보유주수와 재구축 결과를 정확히 대조할 수 없어 기존 기록을 유지했습니다.':'원장 검증을 통과하지 못해 기존 기록을 유지했습니다.');return;}
    try{await storageSet(SAFETY_KEY,before);state.meta={...state.meta,lastAuthoritativeMstyImportAt:new Date().toISOString()};await saveState(true);}
    catch (error: unknown){state=before;console.error('MSTY rebuild save failed',error);renderAll();toast('재구축 기록을 저장하지 못해 기존 기록을 유지했습니다.');return;}
    renderAll();showPage('settings');
    toast(`MSTY 거래 ${rebuilt.replacedTrades}건을 토스 원본 ${rebuilt.importedTrades}건으로 다시 만들었습니다.${rebuilt.preservedDividends?` 배당 ${rebuilt.preservedDividends}건은 유지했습니다.`:''}`);
  }

  function openTossExceptionDeletion(): any {
    const toss=state.integrations.toss;
    const rows=TOSS_EXCEPTION_FIELDS.flatMap(field=>(toss[field]||[]).map((row: any)=>({field,row,key:tossExceptionKey(field,row,toss.accountScopeId||'')})));
    if(!rows.length){toast('삭제할 예외가 없습니다.');return;}
    openModal(`<h3 class="modal-title">예외 삭제</h3><p class="modal-desc">선택한 예외만 목록에서 삭제합니다. 저장된 거래·배당과 토스 원본은 유지합니다. 같은 내역은 다음 갱신에도 다시 표시하지 않으며, 토스 원본이 변경되면 다시 확인합니다.</p><form id="tossDeleteForm" class="form-grid"><button class="btn soft" type="button" id="selectAllTossExceptions">전체 선택</button><div class="list">${rows.map(({field,row},index)=>`<label class="list-row"><div><div class="row-title">${esc(row.symbol)} · ${field.includes('Correction')||field==='correctionCandidates'?'원본 변경':field==='dividendCandidates'?'배당':row.type==='sell'?'매도':'매수'}</div><div class="row-sub">${fmtDate(row.date)} · ${field.includes('dividend')?fmtMoney(row.amountUSD,2):fmtShares(row.shares)+'주'}</div></div><input type="checkbox" name="exception" value="${index}"></label>`).join('')}</div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">선택 예외 삭제</button></div></form>`);
    document.getElementById('selectAllTossExceptions')!.onclick=()=>{document.querySelectorAll('#tossDeleteForm input[name="exception"]').forEach((input: any)=>{input.checked=true;});};
    document.getElementById('tossDeleteForm')!.onsubmit=(event: Event)=>{
      event.preventDefault();const selected=submittedFormData(event).getAll('exception').map(Number).map(index=>rows[index]?.key).filter(Boolean) as string[];
      if(!selected.length){toast('삭제할 예외를 선택해 주세요.');return;}
      confirmAction('예외 삭제 확인',`${selected.length}건을 예외 목록에서 삭제합니다. 이미 저장된 거래·배당과 보유주수는 바뀌지 않습니다.`,async()=>{
        const before=clone(state);
        try{await storageSet(SAFETY_KEY,before);state.integrations.toss=dismissTossExceptions(state.integrations.toss,selected);if(!TOSS_EXCEPTION_FIELDS.some(field=>state.integrations.toss[field]?.length))state.integrations.toss.lastAutoImportReason='';await saveState(true);closeModal();renderAll();showPage('settings');toast(`${selected.length}건의 예외를 삭제했습니다.`);}
        catch (error: unknown){state=before;renderAll();toast('예외 삭제를 저장하지 못해 기존 목록을 유지했습니다.');}
      },'삭제');
    };
  }

  function reviewTossCandidates(): any {
    const candidates: any=mergeTossCandidates(state.integrations.toss.candidates||[],[]),dividendCandidates=mergeTossDividendCandidates(state.integrations.toss.dividendCandidates||[],[]);state.integrations.toss.candidates=candidates;state.integrations.toss.dividendCandidates=dividendCandidates;
    if(!candidates.length&&!dividendCandidates.length){toast('검토할 신규 기록이 없습니다.');return;}
    openModal(`<h3 class="modal-title">토스 신규 기록 검토</h3><p class="modal-desc">선택한 기록만 V4 장부에 저장합니다. 수동 기록과 유사한 후보는 중복 가능성이 있어 기본 선택하지 않습니다.</p><form id="tossReviewForm" class="form-grid"><div class="list">${candidates.map((row: any,index: any)=>`<label class="list-row"><div><div class="row-title">${esc(row.symbol)} · ${row.type==='sell'?'매도':'매수'} ${fmtShares(row.shares)}주${row.possibleManualDuplicate?' · 수동 기록 유사':''}</div><div class="row-sub">${fmtDate(row.date)} · 단가 ${fmtMoney(row.price)} · 수수료 ${fmtMoney(row.feeUSD||0,2)}${row.accountLabel?` · ${esc(row.accountLabel)}`:''}</div></div><input type="checkbox" name="tradeCandidate" value="${index}" ${row.possibleManualDuplicate?'':'checked'}></label>`).join('')}${dividendCandidates.map((row: any,index: any)=>`<label class="list-row"><div><div class="row-title">${esc(row.symbol)} · 세후배당 ${fmtMoney(row.amountUSD,2)}${row.possibleManualDuplicate?' · 수동 기록 유사':''}</div><div class="row-sub">${fmtDate(row.date)}${row.accountLabel?` · ${esc(row.accountLabel)}`:' · 토스 입금 기록'}</div></div><input type="checkbox" name="dividendCandidate" value="${index}" ${row.possibleManualDuplicate?'':'checked'}></label>`).join('')}</div><div class="modal-actions"><button class="btn soft" type="button" data-close-modal>취소</button><button class="btn primary" type="submit">선택 기록 저장</button></div></form>`);
    document.getElementById('tossReviewForm')!.onsubmit=async (event: Event)=>{
      event.preventDefault();const submitted=submittedFormData(event),selected=new Set(submitted.getAll('tradeCandidate').map(Number)),selectedDividends=new Set(submitted.getAll('dividendCandidate').map(Number));
      if(!selected.size&&!selectedDividends.size){toast('저장할 기록을 선택해 주세요.');return;}
      const projectsBefore: any=clone(state.projects),tradesBefore=clone(state.trades),dividendsBefore=clone(state.dividends),importedIds=new Set(),importedDividendIds=new Set(),affectedProjectIds=new Set();let imported: any=0;
      candidates.forEach((row: any,index: any)=>{
        if(!selected.has(index))return;
        const normalized: any=normalizeTossOrder(row);if(!normalized||normalized.currency!=='USD')return;
        let project: any=findProjectForToss(normalized,{attach:true});
        if(!project){project=blankProject(normalized.symbol,normalized.name);project.colorIndex=state.projects.length%PROJECT_COLORS.length;state.projects.push(project);}
        findProjectForToss(normalized,{attach:true});
        const externalId: any=normalized.externalId;
        if(externalId&&state.trades.some((t: any)=>t.source?.provider==='toss'&&t.source.externalId===externalId))return;
        const trade: any=tossCandidateToTrade(normalized,{projectId:project.id,id:uid('t')} as any);if(trade){state.trades.push(trade);importedIds.add(externalId);affectedProjectIds.add(project.id);imported++;}
      });
      dividendCandidates.forEach((row: any,index: any)=>{
        if(!selectedDividends.has(index))return;
        let project: any=findProjectForToss(row,{attach:true});
        if(!project){project=blankProject(row.symbol,row.name);project.colorIndex=state.projects.length%PROJECT_COLORS.length;state.projects.push(project);}
        findProjectForToss(row,{attach:true});
        if(state.dividends.some((item: any)=>item.source?.provider==='toss'&&item.source.externalId===row.externalId))return;
        const dividend: any=tossCandidateToDividend(row,{projectId:project.id,id:uid('d'),sharesAtPayment:sharesAtDate(project.id,row.date)} as any);
        if(dividend){state.dividends.push(dividend);importedDividendIds.add(row.externalId);imported++;}
      });
      const invalid: any=[...affectedProjectIds].some(projectId=>computeProject(projectId).oversells.length);
      if(invalid){state.projects=projectsBefore;state.trades=tradesBefore;state.dividends=dividendsBefore;toast('선택한 거래 조합은 과매도를 만들 수 있어 저장하지 않았습니다. 매수 기록도 함께 선택해 주세요.');return;}
      if(!imported){state.projects=projectsBefore;state.trades=tradesBefore;state.dividends=dividendsBefore;toast('저장 가능한 신규 기록이 없습니다.');return;}
      state.integrations.toss.candidates=candidates.filter((row: any)=>!importedIds.has(String(row?.externalId||'')));state.integrations.toss.dividendCandidates=dividendCandidates.filter((row: any)=>!importedDividendIds.has(String(row?.externalId||'')));state.integrations.toss.lastSyncAt=new Date().toISOString();refreshTossComparisons();await saveState(true);closeModal();renderAll();showPage('settings');toast(`${imported}건을 승인 저장했습니다.`);
    };
  }

  function handleClick(event: Event): void {
    if(!(event.target instanceof Element))return;
    const button=event.target.closest<HTMLElement>('button,[data-open-project],[data-goal-detail]');if(!button)return;
    if(button.dataset.page){showPage(button.dataset.page);return;}
    if(button.dataset.currency){if(state.settings.displayCurrency===button.dataset.currency)return;state.settings.displayCurrency=button.dataset.currency;saveState();renderAll(true);return;}
    if(button.dataset.chartKey){chartSelection=button.dataset.chartKey;renderProjects();return;}
    if(button.dataset.incomeMonth){openIncomeMonth(button.dataset.incomeMonth,button.dataset.incomeProject||'',button.dataset.incomeSymbol||'');return;}
    if('historyReset'in button.dataset){historyFilter={};historyLimit=10;renderProjects();document.querySelector<HTMLDetailsElement>('.record-center')!.open=true;return;}
    if('historyMore'in button.dataset){historyLimit+=10;renderProjects();document.querySelector<HTMLDetailsElement>('.record-center')!.open=true;return;}
    if(button.dataset.chartYearShift){const latest: any=computeProject(selectedProjectId).postedDividends.map((row: any)=>String(row.date).slice(0,4)).filter((year: any)=>/^\d{4}$/.test(year)).sort().at(-1)||todayISO().slice(0,4),base=/^\d{4}$/.test(chartYear)?Number(chartYear):Number(latest);chartYear=String(base+Number(button.dataset.chartYearShift));chartSelection='';renderProjects();return;}
    if(button.dataset.chartMode){chartMode=button.dataset.chartMode;chartSelection='';renderProjects();return;}
    if(button.dataset.homeCashflowMode){homeCashflowMode=button.dataset.homeCashflowMode;cashflowMonthKey='';rememberView();renderHome();return;}
    if(button.dataset.homeYearRange){homeYearRange=button.dataset.homeYearRange;cashflowMonthKey='';rememberView();renderHome();return;}
    if(button.dataset.cashflowPeriod){cashflowMonthKey=button.dataset.cashflowPeriod;renderHome();return;}
    if(button.dataset.portfolioGroup){historyFilter={};historyLimit=10;portfolioGroup=button.dataset.portfolioGroup==='dividend'?'dividend':'highYield';const first: any=activeProjects().find((project: any)=>(project.category==='highYield'?'highYield':'dividend')===portfolioGroup);if(first)selectedProjectId=first.id;renderProjects();return;}
    if(button.dataset.goalDetail){selectedProjectId=button.dataset.goalDetail;renderGoals();showPage('goal');const card: any=[...document.querySelectorAll<HTMLDetailsElement>('.goal-step-card')].find(el=>el.dataset.goalProject===selectedProjectId);if(card){card.open=true;card.scrollIntoView({block:'nearest'});}return;}
    if(button.dataset.settingsProject){selectedProjectId=button.dataset.settingsProject;openProjectForm(projectById(selectedProjectId));return;}
    if(button.dataset.openProject){selectedProjectId=button.dataset.openProject;renderProjects();showPage('projects');return;}
    if(button.dataset.selectProject){historyFilter={};historyLimit=10;selectedProjectId=button.dataset.selectProject;renderProjects();return;}
    if('addProject'in button.dataset){openProjectForm();return;}
    if('projectSettings'in button.dataset){openProjectForm(projectById());return;}
    if('editPrice'in button.dataset){openPriceForm();return;}
    if('addTrade'in button.dataset){openTradeForm();return;}
    if('addDividend'in button.dataset||'quickDividend'in button.dataset){openDividendForm();return;}
    if(button.dataset.addDividendFor){selectedProjectId=button.dataset.addDividendFor;openDividendForm();return;}
    if('addCash'in button.dataset){openCashForm();return;}
    if(button.dataset.addWithdrawal){selectedProjectId=button.dataset.addWithdrawal;openWithdrawalForm(selectedProjectId);return;}
    if('addSplit'in button.dataset){openSplitForm();return;}
    if(button.dataset.viewRecord){openRecordDetail(button.dataset.viewRecord);return;}
    if(button.dataset.editRecord){editRecord(button.dataset.editRecord);return;}
    if(button.dataset.deleteFromEdit){deleteRecord(button.dataset.deleteFromEdit);return;}
    if(button.dataset.deleteRecord){deleteRecord(button.dataset.deleteRecord);return;}
    if('projectCheck'in button.dataset){showIssues(selectedProjectId);return;}
    if('allCheck'in button.dataset){showIssues();return;}
    if(button.dataset.goalMode){const [id,mode]=button.dataset.goalMode.split(':');const project: any=projectById(id);if(!project||project.afterGoalMode===mode)return;project.afterGoalMode=mode;saveState(true).then(()=>{renderAll();showPage('goal');const cards: any=[...document.querySelectorAll<HTMLDetailsElement>('.goal-step-card')];cards.find((card: any)=>card.querySelector('[data-goal-mode]')?.dataset.goalMode.startsWith(id+':'))?.setAttribute('open','');toast('목표 달성 후 운용 방식을 저장했습니다.');});return;}
    if(button.dataset.lockRecovery){lockRecovery(button.dataset.lockRecovery);return;}
    if(button.dataset.editRecovery){lockRecovery(button.dataset.editRecovery,true);return;}
    if(button.dataset.restoreProject){const project: any=projectById(button.dataset.restoreProject);if(project){project.archived=false;selectedProjectId=project.id;saveState(true).then(()=>{renderAll();showPage('projects');toast('프로젝트를 복원했습니다.');});}return;}
    if('localMode'in button.dataset){localOnlySession=true;persistLocalMode(true);document.getElementById('authGate')?.classList.add('hidden');setSaveStatus('');return;}
    if('showLogin'in button.dataset){if(currentUser){document.getElementById('authGate')?.classList.add('hidden');showPage('settings');return;}if(demoMode){toast('테스트 모드에서는 클라우드를 연결하지 않습니다.');return;}localOnlySession=false;persistLocalMode(false);const gate: any=document.getElementById('authGate');gate?.classList.remove('hidden');initAuth().catch(()=>{document.getElementById('authGateStatus')!.textContent='로그인 서비스를 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요. 기기 저장은 계속 사용할 수 있습니다.';});requestAnimationFrame(()=>gate?.scrollIntoView({behavior:'smooth',block:'start'}));return;}
    if('backup'in button.dataset){downloadBackup();return;}
    if('backupDownload'in button.dataset){downloadPreparedBackup();return;}
    if('backupSave'in button.dataset){saveBackupToChosenLocation();return;}
    if('replaceDividends'in button.dataset){document.getElementById('dividendReplacementInput')!.click();return;}
    if(button.dataset.dividendSchedule){openDividendSchedule(button.dataset.dividendSchedule);return;}
    if('restore'in button.dataset){document.getElementById('restoreInput')!.click();return;}
    if('reviewCloud'in button.dataset){if(currentUser)connectCloudForUser(currentUser,true);else toast('클라우드 연결 후 사용할 수 있습니다.');return;}
    if('restoreSafety'in button.dataset){restoreSafetyCopy().catch(()=>toast('안전 사본을 읽지 못했습니다.'));return;}
    if('restoreAuto'in button.dataset){restoreLatestAutoBackup().catch(()=>toast('자동 백업을 읽지 못했습니다.'));return;}
    if('csv'in button.dataset){exportCSV();return;}
    if('importToss'in button.dataset){document.getElementById('tossImportInput')!.click();return;}
    if('configureToss'in button.dataset){openNativeTossSetup();return;}
    if('tossCopyIp'in button.dataset){copyTossIp();return;}
    if('openTossIp'in button.dataset){copyTossIp().finally(()=>openTossIpManagement());return;}
    if('confirmTossIp'in button.dataset){const ip: any=pendingTossIp;modalDirty=false;closeModal();syncNativeTossReadOnly({ipConfirmed:!!ip});return;}
    if('clearTossCredentials'in button.dataset){confirmAction('저장한 토스 키 삭제','이 기기에 암호화 저장한 Client ID와 Secret만 삭제합니다. 가져온 장부 기록은 유지됩니다.',async()=>{await clearNativeTossCredentials();nativeTossStatus={...nativeTossStatus,configured:false,publicIp:'',lastPublicIp:''};renderSettings();showPage('settings');toast('이 기기의 토스 키를 삭제했습니다.');},'키 삭제');return;}
    if('syncToss'in button.dataset){syncTossReadOnly();return;}
    if('rebuildMstyToss'in button.dataset){confirmAction('MSTY 기록 다시 만들기','기존 MSTY 거래만 지우고 보존된 토스 전체 체결 원본으로 다시 만듭니다. 분할 기록과 다른 종목은 유지하며, 토스 배당 조회가 지원되지 않으면 기존 배당도 유지합니다.',rebuildMstyFromToss,'다시 만들기');return;}
    if('installHotUpdate'in button.dataset){applyAppUpdate();return;}
    if('checkHotUpdate'in button.dataset){refreshAppUpdateStatus().then(()=>{renderSettings();showPage('settings');toast(appUpdateStatus.updateAvailable?'새 업데이트가 있습니다.':'현재 최신 버전입니다.');});return;}
    if('refreshOfficialDistributions'in button.dataset){refreshOfficialDistributions(true);return;}
    if('refreshExchangeRate'in button.dataset){refreshExchangeRate(true);return;}
    if('deleteTossExceptions'in button.dataset){openTossExceptionDeletion();return;}
    if('reviewToss'in button.dataset){reviewTossCandidates();return;}
    if('clearTossCorrections'in button.dataset){confirmAction('원본 변경 알림 확인','토스 원본 변경 알림만 정리합니다. 기존 원장과 원본 보존 기록은 바꾸지 않습니다.',async()=>{state.integrations.toss.correctionCandidates=[];state.integrations.toss.dividendCorrectionCandidates=[];await saveState(true);renderSettings();showPage('settings');toast('원본 변경 알림을 확인 처리했습니다.');},'확인 처리');return;}
    if('disconnectToss'in button.dataset){confirmAction('토스 화면 연결 해제','가져온 거래·배당과 원본 보존 기록은 유지하고 현재 조회 상태와 미승인 후보만 정리합니다.',async()=>{state.integrations.toss=disconnectedTossState(state.integrations.toss);await saveState(true);renderAll();showPage('settings');toast('토스 조회 화면 연결을 해제했습니다.');},'연결 해제');return;}
    if('migrateV3'in button.dataset){previewLegacyMigration();return;}
    if('logout'in button.dataset){localOnlySession=false;persistLocalMode(false);logoutGoogle();return;}
    if('reset'in button.dataset){confirmAction('V4 전체 초기화','V4 거래·배당·프로젝트를 초기화합니다. V3.2.1 원본은 유지됩니다.',async()=>{await storageSet(SAFETY_KEY,clone(state));await storageDelete(STATE_KEY);state=blankState();selectedProjectId=state.projects[0].id;await saveState(true);renderAll();showPage('home');toast('V4 데이터를 초기화했습니다.');},'초기화');return;}
    if('discardModal'in button.dataset){closeModal();return;}
    if('keepModal'in button.dataset){document.querySelector('.modal-unsaved')?.remove();return;}
    if('closeModal'in button.dataset){requestCloseModal();return;}
  }

  function bindStaticEvents(): any {
    window.addEventListener('online',()=>{refreshExchangeRate();refreshOfficialDistributions();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshExchangeRate();});
    document.addEventListener('submit',(event: Event)=>{
      const form=event.target;if(!(form instanceof HTMLFormElement))return;
      const futureDate=form.id==='dividendScheduleForm'?null:[...form.querySelectorAll<HTMLInputElement>('input[type="date"]')].find((input)=>input.value&&input.value>todayISO());
      if(futureDate){event.preventDefault();event.stopImmediatePropagation();futureDate.setCustomValidity('미래 날짜는 실제 기록으로 저장할 수 없습니다.');futureDate.reportValidity();setTimeout(()=>futureDate.setCustomValidity(''),1200);return;}
      if(form.dataset.submitting==='true'){event.preventDefault();event.stopImmediatePropagation();return;}
      form.dataset.submitting='true';
      setTimeout(()=>{if(!form.isConnected)return;delete form.dataset.submitting;},800);
    },true);
    document.addEventListener('click',(event: Event)=>{handleClick(event);rememberView();});
    window.addEventListener('pagehide',rememberView);
    document.addEventListener('submit',(event: Event)=>{if(!(event.target instanceof HTMLFormElement))return;if(event.target.id!=='historyFilterForm')return;event.preventDefault();const form=submittedFormData(event);historyFilter={month:String(form.get('month')||''),kind:String(form.get('kind')||''),query:String(form.get('query')||'')};historyLimit=10;renderProjects();document.querySelector<HTMLDetailsElement>('.record-center')!.open=true;});
    document.addEventListener('change',(event: Event)=>{if(!(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement))return;if(event.target.matches('[data-project-select]')){selectedProjectId=event.target.value;renderProjects();rememberView();return;}if(event.target.matches('[data-chart-year]')){chartYear=event.target.value;renderProjects();rememberView();return;}if(!event.target.matches('[data-chart-month]'))return;chartMonth=event.target.value;renderProjects();rememberView();});
    document.getElementById('modal')!.addEventListener('input',()=>{modalDirty=true;});
    document.getElementById('modal')!.addEventListener('change',()=>{modalDirty=true;});
    document.getElementById('modalBackdrop')!.addEventListener('click',(event: Event)=>{if(event.target instanceof Element&&event.target.id==='modalBackdrop')requestCloseModal();});
    document.addEventListener('keydown',(event: KeyboardEvent)=>{if(!(event.target instanceof Element))return;const card=event.target.closest<HTMLElement>('[data-open-project],[data-goal-detail]');if(card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();card.click();return;}if(event.key==='Escape')requestCloseModal();});
    document.getElementById('dividendReplacementInput')!.addEventListener('change',(event: Event)=>{if(!(event.target instanceof HTMLInputElement))return;const file=event.target.files?.[0];if(file)previewDividendReplacement(file);event.target.value='';});
    document.getElementById('restoreInput')!.addEventListener('change',(event: Event)=>{if(!(event.target instanceof HTMLInputElement))return;const file: any=event.target.files?.[0];if(file)restoreFromFile(file);event.target.value='';});
    document.getElementById('tossImportInput')!.addEventListener('change',(event: Event)=>{if(!(event.target instanceof HTMLInputElement))return;const file: any=event.target.files?.[0];if(file)importTossSnapshotFile(file);event.target.value='';});
    document.addEventListener('submit',(event: Event)=>{if(!(event.target instanceof HTMLFormElement))return;const id=event.target.id;if(id!=='displaySettingsForm'&&id!=='dividendSettingsForm')return;event.preventDefault();const form=submittedFormData(event);let next: any={},message='';if(id==='displaySettingsForm'){next={exchangeRate:Math.max(0,n(form.get('exchangeRate'))),exchangeRateMode:form.get('exchangeRateMode')==='auto'?'auto':'manual',appearance:String(form.get('appearance'))};message='화면 설정을 저장했습니다.';}else{const thresholdKRW: any=Math.max(1,n(form.get('thresholdKRW'))),warningKRW=Math.min(thresholdKRW,Math.max(0,n(form.get('warningKRW'))));next={targetMonthlyDividend:Math.max(0,n(form.get('targetMonthlyDividend'))),warningKRW,thresholdKRW};message='배당 기준을 저장했습니다.';}if(Object.keys(next).every(key=>state.settings[key]===next[key])){toast('바뀐 설정이 없습니다.');return;}Object.assign(state.settings,next);if(id==='displaySettingsForm')applyTheme(state.settings.appearance);saveState(true).then(()=>{renderAll();showPage('settings');toast(message);if(id==='displaySettingsForm'&&state.settings.exchangeRateMode==='auto')refreshExchangeRate();});});
    matchMedia('(prefers-color-scheme:dark)').addEventListener?.('change',()=>{if(state.settings.appearance==='system')applyTheme('system');});
    window.addEventListener('online',()=>{if(currentUser)pushCloudState();});window.addEventListener('offline',()=>setSaveStatus('오프라인','cloud-error'));
  }

  async function init(): Promise<any> {
    try{
      removeLegacyTossBrowserCredentials();
      await openStorage();
      try{const cached=await storageGet('officialDistributionFeed');if(cached)officialFeed=parseOfficialDistributionFeed(cached);}catch{}
      const existing: any=await storageGet(STATE_KEY);
      legacyMigrationSource=demoMode?null:await readLegacyState();
      if(demoMode)state=demoState();
      else if(existing){state=migrate(existing);if(legacyMigrationSource&&!state.meta.migrationAudit){const audit: any=auditLegacyAgainstState(legacyMigrationSource,state);if(audit?.passed)state.meta.migrationAudit=audit;else state.meta.legacyMigrationAvailable=true;}}
      else if(legacyMigrationSource)state=prepareLegacyMigration(legacyMigrationSource).candidate;
      else state=blankState();
      selectedProjectId=activeProjects()[0]?.id||'';applyTheme(state.settings.appearance);await storageSet(STATE_KEY,state);
      await confirmHotUpdateReady().catch(()=>{});
      await Promise.all([refreshAutoBackupStatus().catch(()=>{}),refreshNativeTossStatus().catch(()=>{})]);restoreView();renderAll();bindStaticEvents();showPage(currentPage);hideSplash();setSaveStatus('');
      refreshExchangeRate();refreshOfficialDistributions();
      refreshAppUpdateStatus().then(()=>renderSettings()).catch(()=>{});
      if(!storageStatus().durable)setSaveStatus('임시 저장 · 백업 필요','cloud-error');
      if(demoMode){const banner: any=document.createElement('aside');banner.className='demo-banner';banner.textContent='테스트 데이터 · 실계좌/클라우드와 분리';document.body.prepend(banner);}
      if(navigator.onLine&&!demoMode)initAuth().catch(()=>setSaveStatus('기기 저장 모드','cloud-error'));
      if(!demoMode&&'serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(console.warn);
    }catch (error: unknown){console.error(error);document.getElementById('page-home')!.innerHTML='<article class="card danger"><div class="card-title">저장소를 열 수 없습니다.</div><p class="tiny">일반 브라우저 모드에서 다시 열어 주세요.</p></article>';setSaveStatus('오류','cloud-error');hideSplash();}
  }

  init();
})();
