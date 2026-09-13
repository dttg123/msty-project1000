import { APP_VERSION } from '../backup.js';
import { clamp, esc, isDate, n } from './utils.js';
import { renderDividendView } from './dividend-view.js';

export function createViews(context) {
  const {
    getState, getSelectedProjectId, setSelectedProjectId, getChartMode, getRecordsExpanded, getCurrentUser, isTossBridgeConfigured,
    getTossConnectionMode, getTossLocalConfig, getTossSetup,
    activeProjects, projectById, projectRows, computeProject, recoveryStats, totals,
    displayCurrency, fmtMoney, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors
  } = context;
  const state = new Proxy({}, { get: (_, key) => getState()[key] });
  function sectionTitle(title,note='') { return `<div class="section-title-row"><h2 class="section-title">${esc(title)}</h2>${note?`<span class="section-note">${esc(note)}</span>`:''}</div>`; }
  function progress(value,color='') { return `<div class="progress-track"><div class="progress-fill" style="width:${clamp(value,0,100)}%;${color?`background:${color}`:''}"></div></div>`; }
  function pricedMoney(calc,value,digits=2) { return calc.priceAvailable?fmtMoney(value,digits):'—'; }
  function estimateLabel(calc,short=false) { return calc.project.distributionFrequency==='weekly'?(short?'최근 4회 월환산':'최근 8회 월환산'):(short?'최근 1회':'최근 3회 평균'); }

  function periodKey(dateString,mode) {
    const date=new Date(`${dateString}T12:00:00`); if(Number.isNaN(date.getTime()))return '';
    if(mode==='year')return String(date.getFullYear());
    if(mode==='month')return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    const day=(date.getDay()+6)%7; date.setDate(date.getDate()-day);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function chartSeries(projectId=null) {
    const today=new Date().toISOString().slice(0,10),rows=(projectId?projectRows('dividends',projectId):state.dividends).filter(row=>isDate(row.date)&&String(row.date)<=today&&n(row.amountUSD)>0);
    const grouped=new Map(); rows.forEach(row=>{const key=periodKey(row.date,getChartMode());if(key)grouped.set(key,(grouped.get(key)||0)+n(row.amountUSD));});
    const count=getChartMode()==='year'?5:6;
    return [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-count).map(([key,value])=>({key,label:getChartMode()==='year'?key:getChartMode()==='month'?`${key.slice(2,4)}.${key.slice(5,7)}`:`${key.slice(2,4)}.${key.slice(5,7)}/${key.slice(8,10)}`,value}));
  }
  function chartHTML(projectId=null) {
    const series=chartSeries(projectId), max=Math.max(1,...series.map(x=>x.value));
    if(!series.length)return '<div class="empty">배당을 입력하면 실제 흐름이 표시됩니다.</div>';
    return `<div class="column-chart compact-chart">${series.map(x=>`<div class="column-item"><div class="column-value">${fmtMoney(x.value,0)}</div><div class="column-track"><div class="column-fill" style="height:${Math.max(7,x.value/max*126)}px"></div></div><div class="column-label">${esc(x.label)}</div></div>`).join('')}</div>`;
  }

  function renderHome() {
    const total=totals(), monthlyTarget=Math.max(.01,n(state.settings.targetMonthlyDividend)), monthlyPct=total.monthlyEstimate/monthlyTarget*100;
    const annualKRW=total.yearDividends*n(state.settings.exchangeRate), threshold=Math.max(1,n(state.settings.thresholdKRW)), annualPct=annualKRW/threshold*100;
    const overallPct=total.rows.length?total.rows.reduce((sum,row)=>sum+Math.min(1,Math.max(0,row.progress)),0)/total.rows.length*100:0;
    document.getElementById('page-home').innerHTML=`
      <div class="stack">
        <article class="card accent">
          <div class="card-head"><div class="card-title">전체 최근 배당 월환산</div><span class="tag-pill">${total.rows.length}개 프로젝트</span></div>
          <div class="big-number">${fmtMoney(total.monthlyEstimate)}</div>
          <div class="metric-grid three">
            <div class="metric"><div class="metric-label">이번 달 실입금</div><div class="metric-value">${fmtMoney(total.currentMonthDividends,0)}</div></div>
            <div class="metric"><div class="metric-label">최근 12개월</div><div class="metric-value">${fmtMoney(total.trailing12Dividends,0)}</div></div>
            <div class="metric"><div class="metric-label">목표달성</div><div class="metric-value">${fmtPct(overallPct)}</div></div>
          </div>
          <div class="progress-wrap"><div class="progress-meta"><span>월환산 목표 ${fmtMoney(monthlyTarget)}</span><span>${fmtPct(monthlyPct)}</span></div>${progress(monthlyPct)}</div>
          ${total.staleEstimateCount?`<div class="tiny muted" style="margin-top:9px">${total.staleEstimateCount}개 프로젝트의 최근 배당 기록이 오래되어 월환산 신뢰도가 낮습니다.</div>`:''}
        </article>
        ${sectionTitle('전체 배당 흐름','세후 실입금 합산')}
        <article class="card">
          <div class="card-head"><div><div class="card-title">배당 추세</div><div class="sub-number">실제 입력 기록만 반영</div></div>${periodButtons()}</div>
          <div id="homeChart">${chartHTML()}</div>
        </article>
        ${sectionTitle('프로젝트','종목별 현황')}
        <div>${total.rows.map(projectSummaryCard).join('')||'<article class="card empty-project">프로젝트를 추가해 주세요.</article>'}</div>
        ${sectionTitle('전체 상태','자동 합산')}
        <article class="card compact">
          <div class="list-row"><div><div class="row-title">평가금액</div><div class="row-sub">${total.missingPriceCount?`현재가 미입력 ${total.missingPriceCount}개 · 알려진 종목만 합산`:'모든 종목 현재가 반영'}</div></div><div class="row-value">${fmtMoney(total.marketValue)}</div></div>
          <div class="list-row"><div><div class="row-title">투입원금</div><div class="row-sub">현재 남은 취득원가</div></div><div class="row-value">${fmtMoney(total.costBasis)}</div></div>
          <div class="list-row"><div><div class="row-title">사용 가능 배당</div><div class="row-sub">배당 + 보정 − 재투자</div></div><div class="row-value ${signClass(total.dividendAvailable)}">${fmtMoney(total.dividendAvailable)}</div></div>
          <div class="list-row"><div><div class="row-title">올해 배당 관리</div><div class="row-sub">경고 ${Math.round(n(state.settings.warningKRW)).toLocaleString('ko-KR')}원 · 기준 ${Math.round(threshold).toLocaleString('ko-KR')}원</div></div><div class="row-value ${annualKRW>=threshold?'negative':annualKRW>=n(state.settings.warningKRW)?'warning':''}">${Math.round(annualKRW).toLocaleString('ko-KR')}원</div></div>
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
      <div class="summary-grid" style="margin-top:12px"><div class="summary-chip"><div class="label">최근 배당 월환산</div><div class="value">${calc.estimateReliable?fmtMoney(calc.monthlyEstimate,0):'기록 부족'}</div></div><div class="summary-chip"><div class="label">총손익</div><div class="value ${calc.priceAvailable?signClass(calc.totalReturn):''}">${calc.priceAvailable?fmtMoney(calc.totalReturn,0):'현재가 필요'}</div></div></div>
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
    let title='',sub='',value='',cls='';const future=String(row.date)>new Date().toISOString().slice(0,10);
    if(row.kind==='trade'){title=row.type==='sell'?'매도':row.buyType==='reinvest'?'배당재투자':row.buyType==='mixed'?'혼합매수':row.buyType==='opening'?'초기보유':'직접매수';sub=`${fmtDate(row.date)} · ${fmtShares(row.shares)}주 · 단가 ${fmtMoney(row.price)}${row.source?.provider==='toss'?' · 토스 승인':''}`;value=`${row.type==='sell'?'+':'-'}${fmtMoney(n(row.shares)*n(row.price))}`;cls=row.type==='sell'?'positive':'';}
    if(row.kind==='dividend'){const perShare=n(row.sharesAtPayment)>0?n(row.amountUSD)/n(row.sharesAtPayment):0;title='세후배당';sub=`${fmtDate(row.date)}${perShare?` · 주당 ${fmtMoney(perShare,4)}`:''}${row.note?` · ${esc(row.note)}`:''}`;value=`+${fmtMoney(row.amountUSD)}`;cls='positive';}
    if(row.kind==='split'){title=row.type==='reverse'?'역분할':'주식분할';sub=`${fmtDate(row.date)} · ${row.from}:${row.to}`;value='비율 반영';}
    if(row.kind==='cash'){title=row.label||'배당 잔액 보정';sub=fmtDate(row.date);value=fmtSignedMoney(row.amountUSD);cls=n(row.amountUSD)>=0?'positive':'negative';}
    if(future)sub+=`${sub?' · ':''}미래 기록 · 현재 계산 제외`;
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
          <div class="big-number">${calc.priceAvailable?fmtMoney(calc.marketValue):'현재가 입력 필요'}</div><div class="sub-number">${calc.priceAvailable?`평가손익 ${fmtSignedMoney(calc.unrealized)}`:'현재가가 없어 평가손익을 계산하지 않았습니다.'}</div>
          <div class="metric-grid"><div class="metric"><div class="metric-label">보유주수</div><div class="metric-value">${fmtShares(calc.shares)}주</div></div><div class="metric"><div class="metric-label">평균단가</div><div class="metric-value">${fmtMoney(calc.avgCost)}</div></div></div>
          <div class="tiny muted" style="margin-top:10px">현재가 ${calc.priceAvailable?fmtMoney(calc.currentPrice):'미입력'} · ${p.priceSource==='toss'?'토스 조회':'직접 입력'}${p.priceUpdatedAt?` · ${fmtDate(String(p.priceUpdatedAt).slice(0,10))}`:''}</div>
        </article>
        <article class="card">
          <div class="card-head"><div class="card-title">배당 · 현금흐름</div><span class="status-pill">세후</span></div>
          <div class="metric-grid three"><div class="metric"><div class="metric-label">${estimateLabel(calc,true)}</div><div class="metric-value">${calc.estimateReliable?fmtMoney(calc.shortMonthlyEstimate):'—'}</div></div><div class="metric"><div class="metric-label">${estimateLabel(calc)}</div><div class="metric-value">${calc.estimateReliable?fmtMoney(calc.monthlyEstimate):'—'}</div></div><div class="metric"><div class="metric-label">이번 달 실제</div><div class="metric-value">${fmtMoney(calc.currentMonthDividends)}</div></div></div>
          ${calc.stablePerShare?`<div class="list" style="margin-top:10px"><div class="list-row"><div><div class="row-title">주당 분배금 흐름</div><div class="row-sub">최근 ${p.distributionFrequency==='weekly'?'4회':'1회'} ${fmtMoney(calc.shortPerShare,4)} · ${p.distributionFrequency==='weekly'?'8회':'3회'} ${fmtMoney(calc.stablePerShare,4)}</div></div><div class="row-value ${signClass(calc.perShareTrendPct)}">${calc.perShareTrendPct>=0?'+':''}${fmtPct(calc.perShareTrendPct)}</div></div>${calc.priceAvailable&&calc.estimateReliable?`<div class="list-row"><div><div class="row-title">현재가 기준 단순 연환산 분배율</div><div class="row-sub">최근 주당 평균을 연환산한 참고값</div></div><div class="row-value">${fmtPct(calc.annualizedCurrentYield)}</div></div>`:''}</div>`:''}
          <div class="list" style="margin-top:10px"><div class="list-row"><div><div class="row-title">누적 세후배당</div><div class="row-sub">입력한 실입금 합계</div></div><div class="row-value positive">${fmtMoney(calc.dividendsTotal)}</div></div><div class="list-row"><div><div class="row-title">사용 가능 배당</div><div class="row-sub">날짜순 원장 기준</div></div><div class="row-value ${signClass(calc.dividendAvailable)}">${fmtMoney(calc.dividendAvailable)}</div></div></div>
          ${calc.estimateStale?'<div class="tiny warning" style="margin-top:8px">최근 지급일 또는 지급 간격이 설정한 배당 주기와 맞지 않아 월환산을 숨겼습니다.</div>':''}
          <div class="quick-grid"><button class="btn primary" data-add-trade>거래</button><button class="btn secondary" data-add-dividend>배당</button><button class="btn soft" data-add-cash>잔액</button></div>
        </article>
        <article class="card">
          <div class="card-head"><div><div class="card-title">성과 구성</div><div class="sub-number">가격손익과 배당을 분리</div></div><strong class="${calc.priceAvailable?signClass(calc.totalReturn):''}">${calc.priceAvailable?fmtSignedMoney(calc.totalReturn):'계산 대기'}</strong></div>
          <div class="metric-grid three"><div class="metric"><div class="metric-label">평가손익</div><div class="metric-value ${calc.priceAvailable?signClass(calc.unrealized):''}">${pricedMoney(calc,calc.unrealized)}</div></div><div class="metric"><div class="metric-label">실현손익</div><div class="metric-value ${signClass(calc.realized)}">${fmtSignedMoney(calc.realized)}</div></div><div class="metric"><div class="metric-label">누적배당</div><div class="metric-value positive">${fmtMoney(calc.dividendsTotal)}</div></div></div>
        </article>
        <article class="card">
          <div class="card-head"><div><div class="card-title">목표</div><div class="sub-number">${fmtShares(calc.shares)} / ${fmtShares(calc.currentTarget)}주</div></div><strong>${fmtPct(pct)}</strong></div>
          ${progress(pct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}
          <div class="metric-grid three"><div class="metric"><div class="metric-label">남은 주수</div><div class="metric-value">${fmtShares(Math.max(0,calc.currentTarget-calc.shares))}주</div></div><div class="metric"><div class="metric-label">재투자 보유분</div><div class="metric-value">${fmtShares(calc.reinvestShares)}주</div></div><div class="metric"><div class="metric-label">원금회수</div><div class="metric-value">${fmtPct(rec.pct)}</div></div></div>
          ${Math.abs(calc.factor-1)>.0000001?`<div class="tiny muted" style="margin-top:9px">원래 목표 ${fmtShares(p.targetUnits)}주 → 분할·역분할 조정 목표 ${fmtShares(calc.currentTarget)}주 · 경제적 목표는 유지됩니다.</div>`:''}
          ${calc.targetReachedDate&&calc.progress<1?`<div class="tiny muted" style="margin-top:9px">${fmtDate(calc.targetReachedDate)}에 목표를 달성했지만 현재는 매도 반영 후 다시 ${fmtShares(calc.currentTarget)}주를 기준으로 계산합니다.</div>`:''}
        </article>
        ${p.recovery?.locked?`<article class="card"><div class="card-head"><div><div class="card-title">원금회수</div><div class="sub-number">${fmtDate(p.recovery.startDate)}부터 집계 · 기준 ${fmtMoney(p.recovery.basis)}</div></div><button class="mini-icon" data-edit-recovery="${p.id}">기준 수정</button></div><div class="big-number ${rec.pct>=100?'positive':''}">${fmtMoney(rec.total)}</div><div class="sub-number">남은 원금 ${fmtMoney(rec.remaining)} · ${fmtPct(rec.pct)}</div>${progress(rec.pct)}<div class="metric-grid" style="margin-top:12px"><div class="metric"><div class="metric-label">배당 회수</div><div class="metric-value">${fmtMoney(rec.dividendRecovery)}</div></div><div class="metric"><div class="metric-label">매도 회수</div><div class="metric-value">${fmtMoney(rec.sellRecovery)}</div></div></div></article>`:''}
        <article class="card"><div class="card-head"><div><div class="card-title">배당 흐름</div><div class="sub-number">${esc(p.symbol)} 실제 입력 기록</div></div>${periodButtons()}</div><div id="projectChart">${chartHTML(p.id)}</div></article>
        <article class="card">
          <div class="card-head"><div class="card-title">최근 기록</div><button class="mini-icon" data-project-settings>설정</button></div>
          <div class="list">${shown.map(recordRow).join('')||'<div class="empty">아직 기록이 없습니다.</div>'}</div>
          ${rows.length>5?`<button class="btn soft" style="width:100%;margin-top:10px" data-toggle-records>${getRecordsExpanded()?'최근 5건만':'전체 기록 보기'}</button>`:''}
          <div class="quick-grid"><button class="btn soft" data-add-split>분할·역분할</button><button class="btn soft" data-project-settings>프로젝트 설정</button><button class="btn soft" data-project-check>점검</button></div>
        </article>
      </div>`;
  }

  function renderDividends() {
    renderDividendView({
      state, total:totals(), projects:activeProjects(), sectionTitle, periodButtons, chartHTML, recordRow,
      computeProject, fmtMoney, fmtDate, fmtShares, signClass
    });
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
      <div class="stack"><article class="card"><div class="card-head"><div><div class="card-title">전체 월배당 목표</div><div class="sub-number">최근 세후 실입금 기반 월환산</div></div><span class="status-pill">${fmtPct(pct)}</span></div><div class="big-number">${fmtMoney(total.monthlyEstimate)}</div><div class="sub-number">목표 ${fmtMoney(monthlyTarget)}</div><div class="progress-wrap">${progress(pct)}</div></article>
      ${total.rows.map(calc=>{const p=calc.project,colors=projectColors(p),goalPct=calc.progress*100,rec=recoveryStats(calc);return `<article class="card">
        <div class="card-head"><div><div class="row-title">${esc(p.symbol)} · ${esc(p.tag)}</div><div class="row-sub">${fmtShares(calc.shares)} / ${fmtShares(calc.currentTarget)}주</div></div><span class="status-pill">${fmtPct(goalPct)}</span></div>
        ${progress(goalPct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}
        <div class="metric-grid"><div class="metric"><div class="metric-label">예상 달성</div><div class="metric-value small">${estimatedDate(calc)}</div></div><div class="metric"><div class="metric-label">원금 회수</div><div class="metric-value">${fmtPct(rec.pct)}</div></div></div>
        <div class="milestone-grid">${[25,50,75,100].map(level=>`<div><span>${level}%</span><strong>${calc.milestoneDates[level]?fmtDate(calc.milestoneDates[level]):'—'}</strong></div>`).join('')}</div>
        <div class="sub-number">목표 달성 후 운용</div><div class="goal-choice"><button data-goal-mode="${p.id}:cashflow" class="${p.afterGoalMode==='cashflow'?'active':''}">현금흐름 전환</button><button data-goal-mode="${p.id}:reinvest" class="${p.afterGoalMode==='reinvest'?'active':''}">계속 재투자</button></div>
        ${p.recovery.locked?`<div class="list" style="margin-top:12px"><div class="list-row"><div><div class="row-title">회수액 / 기준원금</div><div class="row-sub">배당 ${fmtMoney(rec.dividendRecovery)} · 매도 ${fmtMoney(rec.sellRecovery)}</div></div><div class="row-value ${rec.pct>=100?'positive':''}">${fmtMoney(rec.total)} / ${fmtMoney(p.recovery.basis)}</div></div></div><div class="milestone-grid">${[25,50,75,100].map(level=>`<div><span>회수 ${level}%</span><strong>${rec.milestoneDates[level]?fmtDate(rec.milestoneDates[level]):'—'}</strong></div>`).join('')}</div><button class="btn soft" style="width:100%;margin-top:11px" data-edit-recovery="${p.id}">원금회수 기준 수정</button>`:calc.targetReachedDate?`<button class="btn primary" style="width:100%;margin-top:11px" data-lock-recovery="${p.id}">원금회수 기준 확정</button>`:''}
      </article>`}).join('')}</div>`;
  }

  function renderSettings() {
    const toss=state.integrations.toss;
    const tossMode=getTossConnectionMode?.()||'none',directConfig=getTossLocalConfig?.()||{clientId:'',hasSecret:false},setup=getTossSetup?.()||{ip:'',busy:'',message:''};
    const tossReady=isTossBridgeConfigured(),tossUser=!!getCurrentUser(),tossBusy=toss.status==='syncing',canSync=tossReady&&(tossMode==='direct'||tossUser);
    const tossStatus=tossBusy?'조회 중':toss.status==='connected'?'연결됨':toss.status==='error'?'확인 필요':tossReady?'연결 시험':'설정 필요';
    const tossComparisons=(toss.comparisons||[]).slice(0,6);
    const tossDescription=toss.status==='error'?(toss.lastError||'토스 연결 상태를 다시 확인해 주세요.'):tossMode==='direct'?'현재 휴대폰 IP로 토스에 직접 연결합니다. 계좌·보유주식·체결만 읽고 주문은 하지 않습니다.':tossMode==='bridge'&&!tossUser?'Google 로그인 후 토스 계좌 조회를 시작할 수 있습니다.':tossMode==='bridge'?'읽기 전용 중계 서버로 연결합니다. 자동 저장이나 주문 기능은 없습니다.':'Client ID와 Secret을 이 기기에 저장한 뒤 현재 IP를 등록하세요.';
    const migration=state.meta.migrationAudit,migrationAvailable=!!state.meta.legacyMigrationAvailable,archivedProjects=state.projects.filter(project=>project.archived);
    document.getElementById('page-settings').innerHTML=`${sectionTitle('설정','표시 · 데이터 · 연동')}
      <div class="stack">
        <article class="card"><div class="card-title">전체 표시 설정</div><form id="globalSettingsForm" class="form-grid" style="margin-top:14px">
          <div><label class="input-label">참고 환율 (1달러)</label><input class="input" name="exchangeRate" type="number" min="0" step="1" value="${n(state.settings.exchangeRate)}"></div>
          <div><label class="input-label">전체 월배당 목표 USD</label><input class="input" name="targetMonthlyDividend" type="number" min="0" step="1" value="${n(state.settings.targetMonthlyDividend)}"></div>
          <div><label class="input-label">연간 세후배당 경고선 (원)</label><input class="input" name="warningKRW" type="number" min="0" step="10000" value="${n(state.settings.warningKRW)}"></div>
          <div><label class="input-label">연간 세후배당 관리기준 (원)</label><input class="input" name="thresholdKRW" type="number" min="0" step="10000" value="${n(state.settings.thresholdKRW)}"></div>
          <div><label class="input-label">화면 테마</label><select class="input select" name="appearance"><option value="system" ${state.settings.appearance==='system'?'selected':''}>기기 설정</option><option value="light" ${state.settings.appearance==='light'?'selected':''}>라이트</option><option value="dark" ${state.settings.appearance==='dark'?'selected':''}>다크</option></select></div>
          <button class="btn primary" type="submit">설정 저장</button>
        </form><p class="tiny muted" style="margin-top:10px">월환산은 확정 예정배당이 아니라 최근 실입금 기록의 평균입니다. 세금 판단은 증권사·세무 자료와 대조하세요.</p></article>
        <article class="card"><div class="card-head"><div><div class="card-title">토스증권 읽기 전용</div><div class="sub-number">보유주식 대조 · 체결 후보 승인</div></div><span class="status-pill ${toss.status==='connected'?'positive':''}">${tossStatus}</span></div>
          <p class="tiny muted">${esc(tossDescription)}</p>
          ${tossMode!=='bridge'?`<div class="toss-setup">
            <div class="setup-step"><span>1</span><div><strong>연결정보 저장</strong><small>클라우드에 올리지 않고 이 휴대폰에만 저장</small></div></div>
            <form id="tossDirectForm" class="form-grid compact-form">
              <div><label class="input-label">Client ID</label><input class="input" name="clientId" autocomplete="off" autocapitalize="none" spellcheck="false" required value="${esc(directConfig.clientId)}" placeholder="tsck_live_..."></div>
              <div><label class="input-label">Client Secret</label><input class="input" name="clientSecret" type="password" autocomplete="new-password" autocapitalize="none" spellcheck="false" ${directConfig.hasSecret?'':'required'} placeholder="${directConfig.hasSecret?'저장됨 · 변경할 때만 다시 입력':'tssk_live_...'}"></div>
              <button class="btn secondary" type="submit">${directConfig.hasSecret?'연결정보 다시 저장':'이 기기에 저장'}</button>
            </form>
            <div class="setup-step"><span>2</span><div><strong>현재 IP 등록</strong><small>IP가 바뀌었을 때만 다시 하면 됩니다</small></div></div>
            <div class="ip-box"><div><small>현재 공인 IP</small><strong>${setup.ip?esc(setup.ip):'확인 전'}</strong></div><button class="mini-icon" type="button" data-copy-toss-ip ${setup.ip?'':'disabled'}>복사</button></div>
            <div class="action-row"><button class="btn soft" type="button" data-check-toss-ip ${setup.busy?'disabled':''}>${setup.busy==='ip'?'확인 중…':'현재 IP 확인'}</button><button class="btn soft" type="button" data-open-toss-settings>토스 설정 열기</button></div>
            <div class="setup-step"><span>3</span><div><strong>연결 확인</strong><small>성공하면 바로 전체 조회를 사용할 수 있습니다</small></div></div>
            <button class="btn primary" style="width:100%" type="button" data-test-toss-direct ${directConfig.hasSecret&&!setup.busy?'':'disabled'}>${setup.busy==='test'?'연결 확인 중…':'토스 연결 시험'}</button>
            ${setup.message?`<p class="tiny ${/성공|저장/.test(setup.message)?'positive':'muted'} toss-setup-message">${esc(setup.message)}</p>`:''}
            ${directConfig.hasSecret?'<button class="text-button danger-text" type="button" data-clear-toss-direct>이 기기의 연결정보 삭제</button>':''}
          </div>`:''}
          ${toss.accountLabel?`<div class="row-sub">${esc(toss.accountLabel)}${toss.lastSyncAt?` · ${fmtDate(toss.lastSyncAt.slice(0,10))} 조회`:''}</div>`:''}
          ${tossComparisons.length?`<div class="list" style="margin-top:12px">${tossComparisons.map(row=>`<div class="list-row"><div><div class="row-title">${esc(row.symbol)} · ${fmtShares(row.shares)}주</div><div class="row-sub">앱 ${fmtShares(row.appShares)}주${row.supported?'':' · 원화 종목은 대조만'}</div></div><div class="row-value ${Math.abs(n(row.difference))<.0001?'positive':''}">${Math.abs(n(row.difference))<.0001?'일치':`${n(row.difference)>0?'+':''}${fmtShares(row.difference)}주`}</div></div>`).join('')}</div>`:''}
          ${toss.unsupportedCurrencyCount?`<p class="tiny muted">원화 체결 ${toss.unsupportedCurrencyCount}건은 USD 원장에 섞지 않고 제외했습니다.</p>`:''}
          ${toss.matchedExistingCount?`<p class="tiny muted">기존 수동 거래와 일치한 토스 체결 ${toss.matchedExistingCount}건은 중복 저장하지 않았습니다.</p>`:''}
          ${toss.historyTruncated?'<p class="tiny negative">체결 기록이 10,000건을 넘어 일부만 조회됐습니다. 기간을 나눠 다시 조회해야 합니다.</p>':''}
          <div class="action-row" style="margin-top:12px"><button class="btn secondary" data-sync-toss ${canSync&&!tossBusy?'':'disabled'}>${tossBusy?'조회 중…':toss.status==='connected'?'다시 조회':'전체 조회'}</button><button class="btn soft" data-review-toss ${toss.candidates?.length?'':'disabled'}>${toss.candidates?.length?`후보 ${toss.candidates.length}건 검토`:'후보 없음'}</button></div>
        </article>
        <article class="card"><div class="card-title">클라우드</div><div class="sync-line" style="margin-top:13px"><span class="sync-dot" id="syncDot"></span><div><div class="row-title" id="syncStatusText">${getCurrentUser()?'연결됨':'로그인 필요'}</div><div class="row-sub">V4 전용 저장공간 · V3 원본 보존</div></div></div>${getCurrentUser()?'<button class="btn soft" style="width:100%;margin-top:12px" data-logout>로그아웃</button>':'<button class="btn secondary" style="width:100%;margin-top:12px" data-show-login>클라우드 연결</button>'}</article>
        ${archivedProjects.length?`<article class="card"><div class="card-title">보관한 프로젝트</div><div class="list" style="margin-top:12px">${archivedProjects.map(project=>`<div class="list-row"><div><div class="row-title">${esc(project.symbol)}</div><div class="row-sub">${esc(project.name)}</div></div><button class="mini-icon" data-restore-project="${project.id}">복원</button></div>`).join('')}</div></article>`:''}
        <article class="card"><div class="card-head"><div><div class="card-title">V3.2.1 데이터 이전</div><div class="sub-number">원본 읽기 전용 · V4 복사</div></div><span class="status-pill ${migration?.passed?'positive':''}">${migration?.passed?'대조 통과':migrationAvailable?'이전 가능':'대기'}</span></div>${migration?.passed?`<div class="list" style="margin-top:12px"><div class="list-row"><div><div class="row-title">이전 결과</div><div class="row-sub">거래 ${migration.source.tradeCount}건 · 배당 ${migration.source.dividendCount}건 · 분할 ${migration.source.splitCount}건</div></div><div class="row-value positive">전부 일치</div></div></div>`:`<p class="tiny muted">${migrationAvailable?'이 기기의 V3.2.1 기록을 발견했습니다. 숫자를 먼저 대조한 뒤 복사합니다.':'V3.2.1 기록 또는 로그인된 기존 클라우드를 확인하면 활성화됩니다.'}</p>${migrationAvailable?'<button class="btn primary" style="width:100%" data-migrate-v3>V3 이전값 점검</button>':''}`}</article>
        <article class="card"><div class="card-title">백업 · 내보내기</div><div class="action-row" style="margin-top:13px"><button class="btn primary" data-backup>ZIP 백업</button><button class="btn secondary" data-restore>ZIP 복원</button></div><div class="action-row" style="margin-top:9px"><button class="btn soft" data-csv>CSV 내보내기</button><button class="btn soft" data-all-check>전체 점검</button></div></article>
        <article class="card danger"><div class="card-title">초기화</div><p class="tiny muted">V4 데이터만 지웁니다. V3.2.1 저장소는 삭제하지 않습니다.</p><button class="btn soft" style="width:100%" data-reset>V4 전체 초기화</button></article>
      </div><div class="app-version">DividendOS ${APP_VERSION}${state.meta.migratedFrom?` · ${esc(state.meta.migratedFrom)}에서 이전`:''}</div>`;
  }

  return { renderHome, renderProjects, renderDividends, renderGoals, renderSettings };
}
