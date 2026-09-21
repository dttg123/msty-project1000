import { selectRecords, monthWeeks, historicalIncome } from './activity.js';
import { APP_VERSION } from '../backup.js';
import { frequencyOf } from './income.js?v=0.11.1-r50';
import { clamp, esc, isDate, n, todayISO } from './utils.js';
import { buildHomeMetrics, nextMilestone } from './home-metrics.js?v=0.11.1-r50';

export function createViews(context) {
  const {
    getState, getSelectedProjectId, setSelectedProjectId, getChartMode, getHistoryLimit, getHistoryFilter, getChartMonth, getChartYear, getCashflowMonthKey, getPortfolioCategory, setPortfolioCategory, getCurrentUser, isTossBridgeConfigured,
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
    const today=todayISO(),rows=(projectId?projectRows('dividends',projectId):state.dividends).filter(row=>isDate(row.date)&&String(row.date)<=today&&n(row.amountUSD)>0);
    if(getChartMode()==='year'||getChartMode()==='month'&&getChartYear?.())return historicalIncome(rows,getChartMode(),getChartYear?.(),today);
    const grouped=new Map(); rows.forEach(row=>{const key=periodKey(row.date,getChartMode());if(key)grouped.set(key,(grouped.get(key)||0)+n(row.amountUSD));});
    const count=getChartMode()==='year'?10:6;
    return [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-count).map(([key,value])=>({key,label:getChartMode()==='year'?key:getChartMode()==='month'?`${key.slice(2,4)}.${key.slice(5,7)}`:`${key.slice(2,4)}.${key.slice(5,7)}/${key.slice(8,10)}`,value}));
  }
  function chartHTML(projectId=null) {
    const chartMonth=getChartMonth?.()||todayISO().slice(0,7);
    const series=getChartMode()==='monthWeeks'?monthWeeks(projectRows('dividends',projectId).filter(r=>r.date<=todayISO()),chartMonth).map(r=>({...r,key:r.range})):chartSeries(projectId), max=Math.max(1,...series.map(x=>x.value));
    if(!series.length)return '<div class="empty">배당을 입력하면 실제 흐름이 표시됩니다.</div>';
    const chartMoney=value=>{
      if(displayCurrency()==='KRW'){
        const krw=n(value)*n(state.settings.exchangeRate);
        if(Math.abs(krw)>=10000)return `${(krw/10000).toFixed(Math.abs(krw)>=100000?1:1)}만`;
        return `${Math.round(krw).toLocaleString('ko-KR')}원`;
      }
      return `$${n(value).toLocaleString('en-US',{minimumFractionDigits:value&&Math.abs(value)<1000?2:0,maximumFractionDigits:Math.abs(value)<1000?2:0})}`;
    };
    return `<div class="column-chart compact-chart ${getChartMode()==='year'||getChartMode()==='month'&&getChartYear?.()?'wide-chart':'fit-chart'}">${series.map(x=>`<button class="column-item" type="button" data-chart-value="${esc(fmtMoney(x.value,2))}" data-chart-label="${esc(getChartMode()==='month'&&getChartYear?.()?x.key:x.label)}" aria-label="${esc(x.label)} 배당 ${esc(fmtMoney(x.value,2))}"><div class="column-value" title="${esc(fmtMoney(x.value,2))}">${esc(chartMoney(x.value))}</div><div class="column-track"><div class="column-fill" style="height:${x.value>0?Math.max(7,x.value/max*100):0}%"></div></div><div class="column-label">${esc(getChartMode()==='week'?x.label.slice(3):x.label)}</div></button>`).join('')}</div>`;
  }

  function cashflowChart(months,selectedKey) {
    const max=Math.max(1,...months.map(item=>item.actual+item.estimated));
    return `<div class="cashflow-legend"><span><i class="actual-dot"></i>실제</span><span><i class="estimate-dot"></i>예상</span></div><div class="cashflow-chart" aria-label="최근 12개월 배당 실제와 예상">${months.map(item=>`<button class="cashflow-month ${item.key===selectedKey?'active':''}" type="button" data-cashflow-month="${esc(item.key)}" aria-label="${esc(item.label)} 실제 ${esc(fmtMoney(item.actual,2))} 예상 ${esc(fmtMoney(item.estimated,2))}"><div class="cashflow-bars"><i class="cashflow-estimate" style="height:${item.estimated/max*112}px"></i><i class="cashflow-actual" style="height:${item.actual/max*112}px"></i></div><span>${esc(item.label)}</span></button>`).join('')}</div>`;
  }
  function renderHome() {
    const total=totals(),metrics=buildHomeMetrics(total.rows,state.dividends),goal=metrics.nextGoal,paceChange=metrics.pace.change,currentMonth=todayISO().slice(0,7),selectedMonth=metrics.months.find(item=>item.key===getCashflowMonthKey?.()),next=metrics.nextDividend;
    document.getElementById('page-home').innerHTML=`${sectionTitle('홈','세후 배당')}
      <div class="stack home-flow home-redesign">
        <article class="card month-overview">
          <div class="overview-heading"><h3>이번 달 배당</h3><span>${new Date().getMonth()+1}월</span></div>
          <div class="hero-label">월말 예상 합계${metrics.missingEstimateCount?' · 일부 미산정':''}</div>
          <div class="hero-amount">${fmtMoney(metrics.month.total,2)}</div>
          <div class="month-parts"><div><span>받은 배당</span><strong>${fmtMoney(metrics.month.actual,2)}</strong></div><div><span>앞으로 받을 예상</span><strong>${fmtMoney(metrics.month.remaining,2)}</strong></div></div>
          ${next?`<div class="upcoming-inline" aria-label="다음 예상 배당"><span><small>다음 배당 · 예상</small><strong>${esc(next.symbol)} <em>${fmtDate(next.date)}</em></strong></span><b>${fmtMoney(next.amountUSD,2)}</b></div>`:'<p class="detail-note">다음 배당은 지급 기록이 쌓이면 계산됩니다.</p>'}
        </article>
        <article class="card cashflow-card history-overview">
          <div class="overview-heading"><h3>배당 현금흐름</h3><span>최근 12개월</span></div>
          <p class="chart-instruction">월을 누르면 입금 내역을 볼 수 있어요.</p>
          ${cashflowChart(metrics.months,selectedMonth?.key||currentMonth)}
          ${selectedMonth?`<div class="selected-month-line"><strong>${selectedMonth.key.replace('-','년 ')}월</strong><span>받음 ${fmtMoney(selectedMonth.actual,2)}${selectedMonth.estimated?' · 예상 '+fmtMoney(selectedMonth.estimated,2):''}</span></div>`:''}
          <button class="card-link" data-income-month="${selectedMonth?.key||currentMonth}"><span>${selectedMonth?selectedMonth.label:'이번 달'} 종목별·날짜별 내역</span><b>›</b></button>
          <div class="cashflow-year-summary">
            <div><span>올해 받은 배당</span><strong>${fmtMoney(metrics.year.actual,2)}</strong></div>
            <div><span>연말 예상${metrics.missingEstimateCount?' · 일부 미산정':''}</span><strong>${fmtMoney(metrics.year.total,2)}</strong></div>
          </div>
          <div class="cashflow-pace-summary"><div><span>현재 월 페이스</span><strong>${metrics.pace.available?fmtMoney(metrics.pace.monthly,2):'기록 부족'}</strong></div><div><span class="${paceChange===null?'':signClass(paceChange)}">${paceChange===null?'추세 비교 부족':fmtPct(paceChange)}</span><small>연 환산 ${metrics.pace.available?fmtMoney(metrics.pace.annualized,2):'—'}</small></div></div>
          <p class="detail-note">최근 지급 평균과 현재 보유량 기준입니다.</p>
        </article>
        <article class="card compact next-card ${goal?'interactive-card':''}" ${goal?`data-goal-detail="${goal.calc.project.id}" tabindex="0" role="button"`:''}><div class="card-kicker">다음 목표</div>${goal?`<div class="next-line"><div><strong>${esc(goal.calc.project.symbol)} · ${goal.milestone.reached?'목표 달성':`${fmtShares(goal.milestone.shares)}주`}</strong><span>현재 ${fmtShares(goal.calc.shares)}주${goal.milestone.reached?' · 현금흐름 단계':` · ${fmtShares(goal.milestone.remaining)}주 남음`}</span></div><b>›</b></div>`:'<div class="empty-inline">종목을 추가하면 가장 가까운 목표를 보여줍니다.</div>'}</article>
      </div>`;
  }
  function periodButtons() {
    return `<div class="chart-period">${[['week','주'],['month','월'],['year','년'],['monthWeeks','주차']].map(([mode,label])=>`<button type="button" data-chart-mode="${mode}" class="${getChartMode()===mode?'active':''}">${label}</button>`).join('')}</div>`;
  }
  function projectSummaryCard(calc) {
    const colors=projectColors(calc.project), pct=calc.progress*100;
    return `<article class="card compact project-list-card" data-open-project="${calc.project.id}" tabindex="0" role="button" aria-label="${esc(calc.project.symbol)} 프로젝트 열기" style="border-left:4px solid ${colors[0]}">
      <div class="card-head"><div><div class="row-title">${esc(calc.project.symbol)} · ${esc(calc.project.tag)}</div><div class="row-sub">${fmtShares(calc.shares)} / ${fmtShares(calc.currentTarget)}주</div></div><span class="status-pill">${fmtPct(pct)}</span></div>
      ${progress(pct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}
      <div class="summary-grid" style="margin-top:12px"><div class="summary-chip"><div class="label">최근 배당 월환산</div><div class="value">${calc.estimateReliable?fmtMoney(calc.monthlyEstimate,2):'기록 부족'}</div></div><div class="summary-chip"><div class="label">총손익</div><div class="value ${calc.priceAvailable?signClass(calc.totalReturn):''}">${calc.priceAvailable?fmtMoney(calc.totalReturn,2):'현재가 필요'}</div></div></div>
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
    let title='',sub='',value='',cls='';const future=String(row.date)>todayISO();
    if(row.kind==='trade'){title=row.type==='sell'?'매도':row.buyType==='reinvest'?'배당재투자':row.buyType==='mixed'?'혼합매수':row.buyType==='opening'?'초기보유':'직접매수';sub=`${fmtDate(row.date)} · ${fmtShares(row.shares)}주 · 단가 ${fmtMoney(row.price)}${row.source?.provider==='toss'?' · 토스 승인':''}`;value=`${row.type==='sell'?'+':'-'}${fmtMoney(n(row.shares)*n(row.price))}`;cls=row.type==='sell'?'positive':'';}
    if(row.kind==='dividend'){const perShare=n(row.sharesAtPayment)>0?n(row.amountUSD)/n(row.sharesAtPayment):0;title='세후배당'+(row.rocPercent!==null&&row.rocPercent!==undefined?` · ROC ${n(row.rocPercent)}% (${row.rocStatus==='final'?'확정':'추정'})`:'');sub=`${fmtDate(row.date)}${perShare?` · 주당 ${fmtMoney(perShare,4)}`:''}${row.note?` · ${esc(row.note)}`:''}`;value=`+${fmtMoney(row.amountUSD)}`;cls='positive';}
    if(row.kind==='split'){title=row.type==='reverse'?'역분할':'주식분할';sub=`${fmtDate(row.date)} · ${row.from}:${row.to}`;value='비율 반영';}
    if(row.kind==='cash'){title=esc(row.label||'배당 잔액 보정');sub=fmtDate(row.date);value=fmtSignedMoney(row.amountUSD);cls=n(row.amountUSD)>=0?'positive':'negative';}
    if(future)sub+=`${sub?' · ':''}미래 기록 · 현재 계산 제외`;
    return `<button type="button" class="list-row record-row-button" data-view-record="${row.kind}:${row.id}" aria-label="${esc(title)} 기록 상세"><div><div class="row-title">${title}</div><div class="row-sub">${sub}</div></div><div class="record-value"><div class="row-value ${cls}">${value}</div><span class="record-chevron">상세 ›</span></div></button>`;
  }

  function renderProjects() {
    const allProjects=activeProjects(); let category=getPortfolioCategory?.()||'highYield',projects=allProjects.filter(project=>project.category===category),selectedProjectId=getSelectedProjectId();

    if(!selectedProjectId||!projects.some(project=>project.id===selectedProjectId)){selectedProjectId=projects[0]?.id||'';setSelectedProjectId(selectedProjectId);}
    const calc=projects.length?computeProject(selectedProjectId):null, page=document.getElementById('page-projects');
    if(!calc){page.innerHTML=`${sectionTitle('포트폴리오')}<div class="portfolio-categories">${[['highYield','고배당주'],['dividend','배당주']].map(([key,label])=>`<button data-portfolio-category="${key}" class="${category===key?'active':''}">${label}</button>`).join('')}</div><article class="card empty-project"><p>이 분류에 등록된 종목이 없습니다.</p><button class="btn primary" data-add-project>종목 추가</button></article>`;return;}
    const p=calc.project, colors=projectColors(p), rec=recoveryStats(calc), pct=calc.progress*100, allRows=combinedRecords(calc),filter=getHistoryFilter?.()||{},rows=selectRecords(allRows,filter),historyLimit=getHistoryLimit?.()||10;
    page.innerHTML=`
      <div class="section-title-row"><h2 class="section-title">포트폴리오</h2><button class="btn soft small" data-add-project>＋ 종목</button></div>
      <div class="portfolio-categories"><button class="${category==='highYield'?'active':''}" data-portfolio-category="highYield"><span>고배당주</span><strong>${allProjects.filter(x=>x.category==='highYield').length}</strong></button><button class="${category==='dividend'?'active':''}" data-portfolio-category="dividend"><span>배당주</span><strong>${allProjects.filter(x=>x.category==='dividend').length}</strong></button></div>
      <div class="project-tabs">${projects.map(x=>`<button class="project-tab ${x.id===p.id?'active':''}" data-select-project="${x.id}">${esc(x.symbol)}</button>`).join('')}</div>
      <div class="stack portfolio-stack">
        <article class="card portfolio-summary" style="--project-a:${colors[0]};--project-b:${colors[1]}">
          <div class="portfolio-heading"><div><div class="project-symbol">${esc(p.symbol)}</div><div class="project-name">${esc(p.name)}</div></div><button class="btn soft small project-settings-shortcut" data-project-settings aria-label="${esc(p.symbol)} 종목 설정">설정</button></div>
          <div class="value-line"><div class="value-caption"><span>평가금액</span><button class="price-shortcut" data-edit-price>${calc.priceAvailable?'현재가 수정':'현재가 입력'} ›</button></div><strong>${calc.priceAvailable?fmtMoney(calc.marketValue):'현재가 미입력'}</strong><small class="${calc.priceAvailable?signClass(calc.unrealized):''}">${calc.priceAvailable?`평가손익 ${fmtSignedMoney(calc.unrealized)}`:'현재가를 입력하면 평가금액이 계산됩니다.'}</small></div>
          <div class="holding-row"><div><span>보유주수</span><strong>${fmtShares(calc.shares)}주</strong></div><div><span>평균단가</span><strong>${fmtMoney(calc.avgCost)}</strong></div></div><div class="entry-actions"><button class="btn soft" data-add-trade>거래</button><button class="btn primary" data-add-dividend>배당금 입금</button></div>
        </article>
        <article class="card portfolio-cashflow compact-income">
          <div class="overview-heading"><h3>배당 현금흐름</h3><span>${frequencyOf(p).label} · 세후</span></div>
          <div class="portfolio-income-hero"><span>현재 보유량 기준 월 예상 배당</span><strong>${calc.estimateReliable?fmtMoney(calc.monthlyEstimate,2):'기록 부족'}</strong></div>
          ${calc.estimateReliable?`<div class="income-progress"><div><span>이번 달 수령</span><b>${fmtPct(clamp(calc.currentMonthDividends/calc.monthlyEstimate*100,0,100))}</b></div><div class="income-progress-track"><i style="width:${clamp(calc.currentMonthDividends/calc.monthlyEstimate*100,0,100)}%"></i></div></div>`:''}
          <div class="cashflow-secondary"><div><span>이번 달 받음</span><strong>${fmtMoney(calc.currentMonthDividends,2)}</strong></div><div><span>사용 가능 배당</span><strong>${fmtMoney(calc.dividendAvailable,2)}</strong></div></div>
          ${calc.postedDividends.length&&!calc.income?.known?'<p class="tiny warning">지급 기준 주수가 없어 예상액을 계산하지 않았습니다. 배당 기록에서 주수를 확인해 주세요.</p>':calc.estimateStale?'<p class="tiny warning">최근 지급일·기록 수를 확인해 주세요. 예상액은 확정 배당이 아닙니다.</p>':''}
          ${p.distributionFrequency==='weekly'?(()=>{const has4=calc.estimateReliable&&calc.income?.payments.length>=4,has8=calc.estimateReliable&&calc.income?.payments.length>=8,max=Math.max(1,has4?calc.shortMonthlyEstimate:0,has8?calc.monthlyEstimate:0);return `<section class="income-evidence" aria-label="배당 추세"><div class="overview-heading"><h3>4회·8회 추세</h3><span class="trend-badge ${has8&&calc.income?.trend!=null?signClass(calc.income.trend):''}">${has8&&calc.income?.trend!=null?`${calc.income.trend>0?'↑ ':calc.income.trend<0?'↓ ':''}${fmtPct(Math.abs(calc.income.trend))}`:'비교 준비 중'}</span></div><div class="trend-bars"><div><div><span>최근 4회</span><b>${has4?fmtMoney(calc.shortMonthlyEstimate,2):'4회 필요'}</b></div><div class="trend-track"><i style="width:${has4?Math.max(8,calc.shortMonthlyEstimate/max*100):0}%"></i></div></div><div><div><span>최근 8회</span><b>${has8?fmtMoney(calc.monthlyEstimate,2):'8회 기록 필요'}</b></div><div class="trend-track muted-track"><i style="width:${has8?Math.max(8,calc.monthlyEstimate/max*100):0}%"></i></div></div></div><p class="detail-note">월환산 비교 · 주수와 분할 반영</p></section>`;})():''}
        </article>
        ${p.recovery?.locked?`<article class="card portfolio-section"><div class="detail-title"><strong>원금회수</strong><span>${fmtPct(rec.pct)}</span></div>${progress(rec.pct)}<div class="detail-note">회수 ${fmtMoney(rec.total)} · 남은 원금 ${fmtMoney(rec.remaining)}</div><button class="btn soft small" data-edit-recovery="${p.id}">회수 기준 수정</button></article>`:''}
        <article class="card portfolio-section"><div class="detail-title"><strong>배당 흐름</strong><div class="chart-period">${[['week','주'],['month','월'],['year','년'],['monthWeeks','주차']].map(([mode,label])=>`<button type="button" data-chart-mode="${mode}" class="${getChartMode()===mode?'active':''}">${label}</button>`).join('')}</div></div>${getChartMode()==='month'?`<div class="chart-filter-line"><label for="chartYear">조회 연도</label><select id="chartYear" class="input" aria-label="월별 배당 연도" data-chart-year><option value="">최근 지급월</option>${[...new Set([...(getChartYear?.()?[getChartYear()]:[]),...calc.postedDividends.map(r=>r.date.slice(0,4))])].sort().reverse().map(year=>`<option value="${year}" ${getChartYear?.()===year?'selected':''}>${year}년</option>`).join('')}</select></div>`:''}${getChartMode()==='year'?'<p class="tiny muted">전체 기록 연도 · 좌우로 밀어 확인하세요.</p>':''}${getChartMode()==='monthWeeks'?`<label class="input-label" for="chartMonth">주차를 볼 월</label><input id="chartMonth" class="input" type="month" value="${esc(getChartMonth?.()||todayISO().slice(0,7))}" data-chart-month><p class="tiny muted">1~7일 / 8~14일 / 15~21일 / 22~28일 / 29~말일</p>`:''}<div id="projectChart">${chartHTML(p.id)}</div></article>
        <article class="card portfolio-section"><div class="detail-title"><strong>배당 포함 성과</strong><span class="${calc.priceAvailable?signClass(calc.totalReturn):''}">${calc.priceAvailable?fmtSignedMoney(calc.totalReturn):'현재가 필요'}</span></div><div class="performance-rows"><div><span>평가손익</span><strong class="${calc.priceAvailable?signClass(calc.unrealized):''}">${pricedMoney(calc,calc.unrealized)}</strong></div><div><span>실현손익</span><strong class="${signClass(calc.realized)}">${fmtSignedMoney(calc.realized)}</strong></div><div><span>누적 세후배당</span><strong class="positive">${fmtMoney(calc.dividendsTotal)}</strong></div></div></article>
        <details class="card transaction-history">
          <summary><div><strong>거래내역</strong><span>${rows.length}건 · 눌러서 보기</span></div><b class="chev">⌄</b></summary>
          <div class="transaction-body"><form id="historyFilterForm" class="history-filter"><label>기간<input class="input" type="month" name="month" value="${esc(filter.month||'')}"></label><label>유형<select class="input" name="kind">${[['','전체'],['trade','거래'],['dividend','배당'],['split','분할'],['cash','잔액 보정']].map(([value,label])=>`<option value="${value}" ${filter.kind===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="history-query">날짜 · 메모 · 금액<input class="input" type="search" name="query" value="${esc(filter.query||'')}" placeholder="기록 검색"></label><button class="btn soft" type="submit">조회</button><button class="btn soft" type="button" data-history-reset>전체 보기</button></form><p class="tiny muted">${rows.length}건 / 전체 ${allRows.length}건</p><div class="list records-list">${rows.slice(0,historyLimit).map(recordRow).join('')||'<div class="empty">조건에 맞는 기록이 없습니다.</div>'}</div>${rows.length>historyLimit?`<button class="btn soft history-more" data-history-more>이전 기록 10건 더 보기 (${rows.length-historyLimit}건 남음)</button>`:''}<div class="support-actions"><button class="btn soft small" data-add-cash>잔액 보정</button><button class="btn soft small" data-add-split>분할·역분할</button><button class="btn soft small" data-project-check>점검</button></div></div>
        </details>
      </div>`;
  }

  function estimatedDate(calc,targetShares=calc.currentTarget) {
    const plan=Math.max(0,n(calc.project.monthlyPlanShares)), remaining=Math.max(0,targetShares-calc.shares);
    if(remaining<=0)return '달성 완료'; if(plan<=0)return '월 매수계획 필요';
    const now=new Date(),date=new Date(now.getFullYear(),now.getMonth()+Math.ceil(remaining/plan),1);
    return `${date.getFullYear()}년 ${date.getMonth()+1}월 예상`;
  }
  function renderGoals() {
    const rows=totals().rows;
    document.getElementById('page-goal').innerHTML=`${sectionTitle('다음 목표','가장 가까운 단계만')}
      <div class="stack">${rows.map(calc=>{const p=calc.project,colors=projectColors(p),milestone=nextMilestone(calc),rec=recoveryStats(calc),targetMonthly=calc.estimateReliable&&calc.shares>0?calc.monthlyEstimate*(milestone.shares/calc.shares):0,goalPct=milestone.reached?100:(calc.shares/Math.max(1,milestone.shares))*100,buyCost=calc.priceAvailable?milestone.remaining*calc.currentPrice:0;return `<details class="card goal-step-card" data-goal-project="${esc(p.id)}" style="--project-a:${colors[0]};--project-b:${colors[1]}">
        <summary><div><span class="goal-symbol">${esc(p.symbol)}</span><strong>${fmtShares(milestone.shares)}주 목표</strong><small>현재 ${fmtShares(calc.shares)}주${milestone.reached?' · 목표 달성':` · ${fmtShares(milestone.remaining)}주 남음`}</small></div><b>${milestone.reached?'완료':fmtPct(goalPct)}</b></summary>
        ${progress(goalPct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}
        ${milestone.reached?`<div class="goal-detail-body"><div class="cashflow-primary"><span>완주 후 월 현금흐름 예상</span><strong>${calc.estimateReliable?fmtMoney(calc.monthlyEstimate,2):'기록 부족'}</strong></div><p class="detail-note">현재 보유량과 최근 지급 기록 기준입니다. 실제 배당은 달라질 수 있습니다.</p></div>`:`<div class="goal-detail-body"><div class="goal-flow-compare"><div><span>현재 월배당 예상</span><strong>${calc.estimateReliable?fmtMoney(calc.monthlyEstimate,2):'기록 부족'}</strong></div><b>→</b><div><span>${fmtShares(milestone.shares)}주 예상</span><strong>${targetMonthly?fmtMoney(targetMonthly,2):'기록 부족'}</strong></div></div><div class="goal-info-rows"><div><span>필요 매수금</span><strong>${milestone.reached?'0':calc.priceAvailable?fmtMoney(buyCost,2):'현재가 필요'}</strong></div><div><span>예상 달성일</span><strong>${estimatedDate(calc,milestone.shares)}</strong></div></div><button class="btn soft small" data-settings-project="${esc(p.id)}">목표 · 월 매수계획 설정</button><p class="detail-note">최근 지급 평균을 같은 기준으로 환산합니다. 실제 배당과 매수가에 따라 달라집니다.</p></div>`}
        ${milestone.reached?`<div class="goal-choice"><button data-goal-mode="${p.id}:cashflow" class="${p.afterGoalMode==='cashflow'?'active':''}">현금흐름</button><button data-goal-mode="${p.id}:reinvest" class="${p.afterGoalMode==='reinvest'?'active':''}">재투자</button></div>`:''}
        ${p.recovery.locked?`<div class="row-sub goal-recovery">원금회수 ${fmtMoney(rec.total)} / ${fmtMoney(p.recovery.basis)} · ${fmtPct(rec.pct)}</div><button class="btn soft" data-edit-recovery="${p.id}">회수 기준 수정</button>`:calc.targetReachedDate?`<button class="btn primary" data-lock-recovery="${p.id}">원금회수 시작</button>`:''}
      </details>`}).join('')||'<article class="card empty">종목을 추가하면 250 · 500 · 750 · 1,000주 중 다음 목표를 보여줍니다.</article>'}</div>`;
  }

  function renderSettings() {
    const toss=state.integrations.toss;
    const tossMode=getTossConnectionMode?.()||'none',directConfig=getTossLocalConfig?.()||{clientId:'',hasSecret:false},setup=getTossSetup?.()||{ip:'',busy:'',message:''};
    const tossReady=isTossBridgeConfigured(),tossUser=!!getCurrentUser(),tossBusy=toss.status==='syncing',canSync=tossReady&&(tossMode==='direct'||tossUser);
    const tossStatus=tossBusy?'조회 중':toss.status==='connected'?'연결됨':toss.status==='error'?'확인 필요':tossReady?'연결 시험':'설정 필요';
    const tossComparisons=(toss.comparisons||[]).slice(0,6);
    const tossDescription=toss.status==='error'?(toss.lastError||'토스 연결 상태를 다시 확인해 주세요.'):tossMode==='direct'?'현재 휴대폰 IP로 토스에 직접 연결합니다. 조회한 원본 기록은 기기에 보존하고 주문은 하지 않습니다.':tossMode==='bridge'&&!tossUser?'Google 로그인 후 토스 계좌 조회를 시작할 수 있습니다.':tossMode==='bridge'?'읽기 전용 중계 서버로 연결합니다. 조회 기록은 기기에 보존하고 앱 원장 반영은 직접 승인합니다.':'Client ID와 Secret을 이 기기에 저장한 뒤 현재 IP를 등록하세요.';
    const migration=state.meta.migrationAudit,migrationAvailable=!!state.meta.legacyMigrationAvailable,archivedProjects=state.projects.filter(project=>project.archived);
    document.getElementById('page-settings').innerHTML=`${sectionTitle('내 Dividend OS','설정')}
      <div class="stack">
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">화면 · 환율</div><div class="sub-number">${state.settings.appearance==='system'?'기기 설정':state.settings.appearance==='light'?'라이트':'다크'} · ${state.settings.exchangeRateMode==='auto'?'자동 환율':'직접 입력'} · 1달러 ${Math.round(n(state.settings.exchangeRate)).toLocaleString('ko-KR')}원</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><form id="displaySettingsForm" class="form-grid">
          <div class="form-grid two"><div><label class="input-label">환율 적용</label><select class="input select" name="exchangeRateMode"><option value="manual" ${state.settings.exchangeRateMode!=='auto'?'selected':''}>직접 입력</option><option value="auto" ${state.settings.exchangeRateMode==='auto'?'selected':''}>연동 시 자동</option></select></div><div><label class="input-label">참고 환율 (1달러)</label><input class="input" name="exchangeRate" type="number" min="1" step="1" required value="${n(state.settings.exchangeRate)}"></div></div>
          <div><label class="input-label">화면 테마</label><select class="input select" name="appearance"><option value="system" ${state.settings.appearance==='system'?'selected':''}>기기 설정</option><option value="light" ${state.settings.appearance==='light'?'selected':''}>라이트</option><option value="dark" ${state.settings.appearance==='dark'?'selected':''}>다크</option></select></div>
          <button class="btn secondary" type="submit">화면 설정 저장</button>
        </form><p class="tiny muted" style="margin-top:10px">자동 환율은 연동 데이터에 환율이 포함될 때 적용하고, 그 전까지는 입력값을 유지합니다.</p></div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">배당 관리 기준</div><div class="sub-number">월 목표 $${Math.round(n(state.settings.targetMonthlyDividend)).toLocaleString('en-US')} · 관리기준 ${Math.round(n(state.settings.thresholdKRW)).toLocaleString('ko-KR')}원</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><form id="dividendSettingsForm" class="form-grid">
          <div><label class="input-label">전체 월배당 목표 USD</label><input class="input" name="targetMonthlyDividend" type="number" min="0" step="1" value="${n(state.settings.targetMonthlyDividend)}"></div>
          <div><label class="input-label">연간 세후배당 경고선 (원)</label><input class="input" name="warningKRW" type="number" min="0" step="10000" value="${n(state.settings.warningKRW)}"></div>
          <div><label class="input-label">연간 세후배당 관리기준 (원)</label><input class="input" name="thresholdKRW" type="number" min="0" step="10000" value="${n(state.settings.thresholdKRW)}"></div>
          <button class="btn secondary" type="submit">배당 기준 저장</button>
        </form><p class="tiny muted" style="margin-top:10px">월 예상은 배당 주기와 최근 지급 기록을 기준으로 계산합니다.</p></div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">종목별 설정</div><div class="sub-number">분류 · 목표 · 카드 색상</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><div class="list settings-project-list">${activeProjects().map(project=>`<div class="list-row"><div><div class="row-title"><span class="project-color-dot" style="background:${projectColors(project)[0]}"></span>${esc(project.symbol)}</div><div class="row-sub">${project.category==='dividend'?'배당주':'고배당주'} · 목표 ${fmtShares(project.targetUnits)}주</div></div><button class="mini-icon" data-settings-project="${project.id}">수정</button></div>`).join('')}</div></div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">토스증권 읽기 전용</div><div class="sub-number">보유주식 대조 · 체결 후보 승인</div></div><span class="status-pill ${toss.status==='connected'?'positive':''}">${tossStatus}</span><b class="chev">⌄</b></summary><div class="settings-section-body">
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
          ${(toss.sourceLedger?.orders?.length||toss.sourceLedger?.dividends?.length)?`<p class="tiny positive">기기 보존 원본 · 거래 ${toss.sourceLedger.orders.length}건 · 배당 ${toss.sourceLedger.dividends.length}건${toss.lastSuccessfulAt?' · 마지막 성공 '+fmtDate(toss.lastSuccessfulAt.slice(0,10)):''}</p>`:''}
          ${toss.historyTruncated?'<p class="tiny negative">체결 기록이 10,000건을 넘어 일부만 조회됐습니다. 기간을 나눠 다시 조회해야 합니다.</p>':''}
          <div class="action-row" style="margin-top:12px"><button class="btn secondary" data-sync-toss ${canSync&&!tossBusy?'':'disabled'}>${tossBusy?'조회 중…':toss.status==='connected'?'다시 조회':'전체 조회'}</button><button class="btn soft" data-review-toss ${toss.candidates?.length?'':'disabled'}>${toss.candidates?.length?`후보 ${toss.candidates.length}건 검토`:'후보 없음'}</button></div>
        </div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">클라우드</div><div class="sub-number">자동 백업 연결 상태</div></div><strong class="${getCurrentUser()?'positive':''}">${getCurrentUser()?'연결됨':'로그인 필요'}</strong><b class="chev">⌄</b></summary><div class="settings-section-body"><div class="sync-line"><span class="sync-dot" id="syncDot"></span><div><div class="row-title" id="syncStatusText">${getCurrentUser()?'연결됨':'로그인 필요'}</div><div class="row-sub">V4 전용 저장공간 · V3 원본 보존</div></div></div>${getCurrentUser()?'<button class="btn soft" style="width:100%;margin-top:12px" data-logout>로그아웃</button>':'<button class="btn secondary" style="width:100%;margin-top:12px" data-show-login>클라우드 연결</button>'}</div></details>
        ${archivedProjects.length?`<article class="card"><div class="card-title">보관한 프로젝트</div><div class="list" style="margin-top:12px">${archivedProjects.map(project=>`<div class="list-row"><div><div class="row-title">${esc(project.symbol)}</div><div class="row-sub">${esc(project.name)}</div></div><button class="mini-icon" data-restore-project="${project.id}">복원</button></div>`).join('')}</div></article>`:''}
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">데이터 · 고급 설정</div><div class="sub-number">이전 · 백업 · 점검 · 초기화</div></div><b class="chev">⌄</b></summary><div class="settings-section-body advanced-settings">
          <section><div class="card-head"><div><div class="card-title">V3.2.1 데이터 이전</div><div class="sub-number">원본 읽기 전용 · V4 복사</div></div><span class="status-pill ${migration?.passed?'positive':''}">${migration?.passed?'대조 통과':migrationAvailable?'이전 가능':'대기'}</span></div>${migration?.passed?`<div class="list"><div class="list-row"><div><div class="row-title">이전 결과</div><div class="row-sub">거래 ${migration.source.tradeCount}건 · 배당 ${migration.source.dividendCount}건 · 분할 ${migration.source.splitCount}건</div></div><div class="row-value positive">전부 일치</div></div></div>`:`<p class="tiny muted">${migrationAvailable?'이 기기의 V3.2.1 기록을 발견했습니다. 숫자를 먼저 대조한 뒤 복사합니다.':'V3.2.1 기록 또는 로그인된 기존 클라우드를 확인하면 활성화됩니다.'}</p>${migrationAvailable?'<button class="btn primary" style="width:100%" data-migrate-v3>V3 이전값 점검</button>':''}`}</section>
          <section><div class="card-title">백업 · 내보내기</div><div class="action-row" style="margin-top:13px"><button class="btn primary" data-backup>ZIP 백업</button><button class="btn secondary" data-restore>ZIP 복원</button></div><div class="action-row" style="margin-top:9px"><button class="btn soft" data-csv>CSV 내보내기</button><button class="btn soft" data-all-check>전체 점검</button></div></section>
          <section><div class="card-title">안전 사본</div><p class="tiny muted">삭제·복원·초기화 직전 기록으로 한 단계 되돌립니다. 기기 밖 ZIP 백업도 별도로 보관해 주세요.</p><button class="btn soft" style="width:100%" data-restore-safety>직전 안전 사본 되돌리기</button><button class="btn soft" style="width:100%;margin-top:9px" data-review-cloud>클라우드 기록 확인</button></section>
          <section class="danger-zone"><div class="card-title">초기화</div><p class="tiny muted">V4 데이터만 지웁니다. V3.2.1 저장소는 삭제하지 않습니다.</p><button class="btn soft" style="width:100%" data-reset>V4 전체 초기화</button></section>
        </div></details>
      </div><div class="detail-note">원화는 설정 환율로 환산한 참고 금액입니다. 관리기준은 사용자 알림용이며 세금 판정이 아닙니다.</div><div class="app-version">DividendOS ${APP_VERSION}${state.meta.migratedFrom?` · ${esc(state.meta.migratedFrom)}에서 이전`:''}</div>`;
    document.getElementById('page-settings').querySelectorAll?.('input,select,textarea').forEach((input,index)=>{const label=input.closest('div')?.querySelector('label');if(label){input.id='settings-field-'+index;label.htmlFor=input.id;}});
  }

  return { renderHome, renderProjects, renderGoals, renderSettings };
}
