import { APP_VERSION } from '../backup.js';
import { clamp, esc, n } from './utils.js';

export function createViews(context) {
  const {
    getState, getSelectedProjectId, setSelectedProjectId, getChartMode, getRecordsExpanded, getCurrentUser, isTossBridgeConfigured,
    activeProjects, projectById, projectRows, computeProject, recoveryStats, totals,
    displayCurrency, fmtMoney, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors
  } = context;
  const state = new Proxy({}, { get: (_, key) => getState()[key] });
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
    const grouped=new Map(); rows.forEach(row=>{const key=periodKey(row.date,getChartMode());if(key)grouped.set(key,(grouped.get(key)||0)+n(row.amountUSD));});
    const count=getChartMode()==='year'?5:6;
    return [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-count).map(([key,value])=>({key,label:getChartMode()==='year'?key:getChartMode()==='month'?`${Number(key.slice(5))}월`:`${Number(key.slice(5,7))}/${Number(key.slice(8))}`,value}));
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
    return `<div class="chart-period">${[['week','주'],['month','월'],['year','년']].map(([mode,label])=>`<button type="button" data-chart-mode="${mode}" class="${getChartMode()===mode?'active':''}">${label}</button>`).join('')}</div>`;
  }
  function projectSummaryCard(calc) {
    const colors=projectColors(calc.project), pct=calc.progress*100;
    return `<article class="card compact project-list-card" data-open-project="${calc.project.id}" tabindex="0" role="button" aria-label="${esc(calc.project.symbol)} 프로젝트 열기" style="border-left:4px solid ${colors[0]}">
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
    const projects=activeProjects(); let selectedProjectId=getSelectedProjectId();
    if(!selectedProjectId||!projectById(selectedProjectId)){selectedProjectId=projects[0]?.id||'';setSelectedProjectId(selectedProjectId);}
    const calc=computeProject(selectedProjectId), page=document.getElementById('page-projects');
    if(!calc){page.innerHTML=`${sectionTitle('프로젝트')}<article class="card empty-project"><p>등록된 프로젝트가 없습니다.</p><button class="btn primary" data-add-project>프로젝트 추가</button></article>`;return;}
    const p=calc.project, colors=projectColors(p), rec=recoveryStats(calc), pct=calc.progress*100, rows=combinedRecords(calc), shown=getRecordsExpanded()?rows:rows.slice(0,5);
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
          ${rows.length>5?`<button class="btn soft" style="width:100%;margin-top:10px" data-toggle-records>${getRecordsExpanded()?'최근 5건만':'전체 기록 보기'}</button>`:''}
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
    const tossReady=isTossBridgeConfigured(),tossUser=!!getCurrentUser(),tossBusy=toss.status==='syncing';
    const tossStatus=tossBusy?'조회 중':toss.status==='connected'?'연결됨':toss.status==='error'?'확인 필요':tossReady?'승인 대기':'서버 준비 중';
    const tossComparisons=(toss.comparisons||[]).slice(0,6);
    const tossDescription=!tossReady?'비밀키를 앱에 넣지 않도록 읽기 전용 중계 서버를 준비 중입니다.':!tossUser?'Google 로그인 후 토스 계좌 조회를 시작할 수 있습니다.':toss.status==='error'?(toss.lastError||'토스 연결 상태를 다시 확인해 주세요.'):'계좌·보유주식·체결 주문만 조회합니다. 자동 저장이나 주문 기능은 없습니다.';
    const migration=state.meta.migrationAudit,migrationAvailable=!!state.meta.legacyMigrationAvailable,archivedProjects=state.projects.filter(project=>project.archived);
    document.getElementById('page-settings').innerHTML=`${sectionTitle('설정','표시 · 데이터 · 연동')}
      <div class="stack">
        <article class="card"><div class="card-title">전체 표시 설정</div><form id="globalSettingsForm" class="form-grid" style="margin-top:14px">
          <div><label class="input-label">참고 환율 (1달러)</label><input class="input" name="exchangeRate" type="number" min="0" step="1" value="${n(state.settings.exchangeRate)}"></div>
          <div><label class="input-label">전체 월배당 목표 USD</label><input class="input" name="targetMonthlyDividend" type="number" min="0" step="1" value="${n(state.settings.targetMonthlyDividend)}"></div>
          <div><label class="input-label">연 배당 경고금액 (원)</label><input class="input" name="warningKRW" type="number" min="0" step="10000" value="${n(state.settings.warningKRW)}"></div>
          <div><label class="input-label">연 배당 관리기준 (원)</label><input class="input" name="thresholdKRW" type="number" min="0" step="10000" value="${n(state.settings.thresholdKRW)}"></div>
          <div><label class="input-label">화면 테마</label><select class="input select" name="appearance"><option value="system" ${state.settings.appearance==='system'?'selected':''}>기기 설정</option><option value="light" ${state.settings.appearance==='light'?'selected':''}>라이트</option><option value="dark" ${state.settings.appearance==='dark'?'selected':''}>다크</option></select></div>
          <button class="btn primary" type="submit">설정 저장</button>
        </form></article>
        <article class="card"><div class="card-head"><div><div class="card-title">토스증권 읽기 전용</div><div class="sub-number">보유주식 대조 · 체결 후보 승인</div></div><span class="status-pill ${toss.status==='connected'?'positive':''}">${tossStatus}</span></div>
          <p class="tiny muted">${esc(tossDescription)}</p>
          ${toss.accountLabel?`<div class="row-sub">${esc(toss.accountLabel)}${toss.lastSyncAt?` · ${fmtDate(toss.lastSyncAt.slice(0,10))} 조회`:''}</div>`:''}
          ${tossComparisons.length?`<div class="list" style="margin-top:12px">${tossComparisons.map(row=>`<div class="list-row"><div><div class="row-title">${esc(row.symbol)} · ${fmtShares(row.shares)}주</div><div class="row-sub">앱 ${fmtShares(row.appShares)}주${row.supported?'':' · 원화 종목은 대조만'}</div></div><div class="row-value ${Math.abs(n(row.difference))<.0001?'positive':''}">${Math.abs(n(row.difference))<.0001?'일치':`${n(row.difference)>0?'+':''}${fmtShares(row.difference)}주`}</div></div>`).join('')}</div>`:''}
          ${toss.unsupportedCurrencyCount?`<p class="tiny muted">원화 체결 ${toss.unsupportedCurrencyCount}건은 USD 원장에 섞지 않고 제외했습니다.</p>`:''}
          ${toss.historyTruncated?'<p class="tiny negative">체결 기록이 10,000건을 넘어 일부만 조회됐습니다. 기간을 나눠 다시 조회해야 합니다.</p>':''}
          <div class="action-row" style="margin-top:12px"><button class="btn secondary" data-sync-toss ${tossReady&&tossUser&&!tossBusy?'':'disabled'}>${tossBusy?'조회 중…':toss.status==='connected'?'다시 조회':'토스 조회'}</button><button class="btn soft" data-review-toss ${toss.candidates?.length?'':'disabled'}>${toss.candidates?.length?`후보 ${toss.candidates.length}건 검토`:'후보 없음'}</button></div>
        </article>
        <article class="card"><div class="card-title">클라우드</div><div class="sync-line" style="margin-top:13px"><span class="sync-dot" id="syncDot"></span><div><div class="row-title" id="syncStatusText">${getCurrentUser()?'연결됨':'로그인 필요'}</div><div class="row-sub">V4 전용 저장공간 · V3 원본 보존</div></div></div>${getCurrentUser()?'<button class="btn soft" style="width:100%;margin-top:12px" data-logout>로그아웃</button>':''}</article>
        ${archivedProjects.length?`<article class="card"><div class="card-title">보관한 프로젝트</div><div class="list" style="margin-top:12px">${archivedProjects.map(project=>`<div class="list-row"><div><div class="row-title">${esc(project.symbol)}</div><div class="row-sub">${esc(project.name)}</div></div><button class="mini-icon" data-restore-project="${project.id}">복원</button></div>`).join('')}</div></article>`:''}
        <article class="card"><div class="card-head"><div><div class="card-title">V3.2.1 데이터 이전</div><div class="sub-number">원본 읽기 전용 · V4 복사</div></div><span class="status-pill ${migration?.passed?'positive':''}">${migration?.passed?'대조 통과':migrationAvailable?'이전 가능':'대기'}</span></div>${migration?.passed?`<div class="list" style="margin-top:12px"><div class="list-row"><div><div class="row-title">이전 결과</div><div class="row-sub">거래 ${migration.source.tradeCount}건 · 배당 ${migration.source.dividendCount}건 · 분할 ${migration.source.splitCount}건</div></div><div class="row-value positive">전부 일치</div></div></div>`:`<p class="tiny muted">${migrationAvailable?'이 기기의 V3.2.1 기록을 발견했습니다. 숫자를 먼저 대조한 뒤 복사합니다.':'V3.2.1 기록 또는 로그인된 기존 클라우드를 확인하면 활성화됩니다.'}</p>${migrationAvailable?'<button class="btn primary" style="width:100%" data-migrate-v3>V3 이전값 점검</button>':''}`}</article>
        <article class="card"><div class="card-title">백업 · 내보내기</div><div class="action-row" style="margin-top:13px"><button class="btn primary" data-backup>ZIP 백업</button><button class="btn secondary" data-restore>ZIP 복원</button></div><div class="action-row" style="margin-top:9px"><button class="btn soft" data-csv>CSV 내보내기</button><button class="btn soft" data-all-check>전체 점검</button></div></article>
        <article class="card danger"><div class="card-title">초기화</div><p class="tiny muted">V4 데이터만 지웁니다. V3.2.1 저장소는 삭제하지 않습니다.</p><button class="btn soft" style="width:100%" data-reset>V4 전체 초기화</button></article>
      </div><div class="app-version">DividendOS ${APP_VERSION}${state.meta.migratedFrom?` · ${esc(state.meta.migratedFrom)}에서 이전`:''}</div>`;
  }

  return { renderHome, renderProjects, renderGoals, renderSettings };
}
