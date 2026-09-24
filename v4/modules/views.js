import { selectRecords, monthWeeks, historicalIncome } from './activity.js?v=0.12.1-r58';
import { APP_VERSION } from '../backup.js?v=0.12.1-r58';
import { frequencyOf } from './income.js?v=0.12.1-r58';
import { clamp, esc, isDate, n, todayISO } from './utils.js?v=0.12.1-r58';
import { buildHomeMetrics, nextMilestone } from './home-metrics.js?v=0.12.1-r58';
import { PROJECT_CATEGORIES } from './constants.js?v=0.12.1-r58';

export function createViews(context) {
  const {
    getState, getSelectedProjectId, setSelectedProjectId, getChartMode, getChartSelection, getHomeCashflowMode, getHomeYearRange, getHistoryLimit, getHistoryFilter, getChartMonth, getChartYear, getCashflowMonthKey, getPortfolioCategory, setPortfolioCategory, getCurrentUser, isTossBridgeConfigured,
    getTossConnectionMode, getTossLocalConfig, getTossSetup,
    activeProjects, projectById, projectRows, computeProject, recoveryStats, totals,
    displayCurrency, fmtMoney, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors
  } = context;
  const state = new Proxy({}, { get: (_, key) => getState()[key] });
  function sectionTitle(title,note='') { return `<div class="section-title-row"><h2 class="section-title">${esc(title)}</h2>${note?`<span class="section-note">${esc(note)}</span>`:''}</div>`; }
  function progress(value,color='') { return `<div class="progress-track"><div class="progress-fill" style="width:${clamp(value,0,100)}%;${color?`background:${color}`:''}"></div></div>`; }
  function pricedMoney(calc,value,digits=2) { return calc.priceAvailable?fmtMoney(value,digits):'—'; }
  function estimateLabel(calc,short=false) { return calc.project.distributionFrequency==='weekly'?(short?'최근 4회 월환산':'최근 8회 월환산'):(short?'최근 1회':'최근 3회 평균'); }
  const categoryLabel=category=>PROJECT_CATEGORIES.find(([key])=>key===category)?.[1]||'일반 배당';
  const finitePct=value=>value===null||value===undefined||!Number.isFinite(value)?'—':fmtPct(value);

  function paymentTrendHTML(calc){
    const rows=calc.income.payments.slice(0,8),ordered=[...rows].reverse(),values=ordered.map(row=>row.known?row.perShare:row.amount),max=Math.max(1,...values),recent=rows.slice(0,4),prior=rows.slice(4,8),valueOf=row=>row.known?row.perShare:row.amount,average=list=>list.length?list.reduce((sum,row)=>sum+valueOf(row),0)/list.length:0,recentAvg=average(recent),priorAvg=average(prior),change=recent.length===4&&prior.length===4&&priorAvg>0?(recentAvg/priorAvg-1)*100:null,perShare=rows.length&&rows.every(row=>row.known);
    if(!rows.length)return '<p class="empty-inline">실제 입금이 쌓이면 지급 추세를 보여줍니다.</p>';
    const latest=valueOf(rows[0]),previous=rows[1]?valueOf(rows[1]):0,latestChange=previous>0?(latest/previous-1)*100:null;
    return `<div class="payment-trend-summary"><div><span>최근 지급</span><strong>${fmtMoney(latest,perShare?4:2)}${perShare?' / 주':''}</strong></div><div><span>직전 지급 대비</span><strong class="${latestChange===null?'':signClass(latestChange)}">${latestChange===null?'비교 전':`${latestChange>=0?'+':''}${fmtPct(latestChange)}`}</strong></div></div><div class="payment-spark" aria-label="날짜별 실제 지급액">${ordered.map((row,index)=>`<button type="button" ${row.ids?.[0]?`data-view-record="dividend:${esc(row.ids[0])}"`:''} aria-label="${esc(fmtDate(row.date))} ${esc(perShare?fmtMoney(values[index],4)+' 주당':fmtMoney(values[index],2))}"><b>${esc(fmtMoney(values[index],perShare?4:0))}</b><i style="height:${Math.max(12,values[index]/max*58)}px"></i><small>${esc(row.date.slice(5).replace('-','.'))}</small></button>`).join('')}</div><div class="trend-sentence"><strong>${recent.length===4?`최근 4회 평균 ${fmtMoney(recentAvg,perShare?4:2)}${perShare?' / 주':''}`:`최근 실제 지급 ${recent.length}회`}</strong><span class="${change===null?'':signClass(change)}">${change===null?'각 막대를 누르면 해당 입금 기록을 확인합니다.':`이전 4회 평균보다 ${change>=0?'증가':'감소'} ${fmtPct(Math.abs(change))}`}</span></div>${perShare?'':'<p class="detail-note">일부 기록에 지급 당시 주수가 없어 해당 회차는 실제 입금액으로 표시합니다.</p>'}`;
  }

  function annualDpsHTML(calc){
    const analytics=calc.analytics,years=analytics.years.filter(row=>row.known&&row.dps>0).slice(-6),max=Math.max(1,...years.map(row=>row.dps));
    return `<div class="strategy-metrics"><div><span>최근 12개월 실제</span><strong>${fmtMoney(analytics.trailingNet,2)}</strong></div><div><span>평단 기준 세후 YOC</span><strong>${analytics.trailingYoc===null?'—':fmtPct(analytics.trailingYoc)}</strong></div><div><span>연속 증가</span><strong>${analytics.increaseStreak?analytics.increaseStreak+'년':'확인 전'}</strong></div></div>${years.length?`<div class="annual-dps-chart" aria-label="연도별 실제 주당배당">${years.map(row=>`<div><b style="height:${Math.max(10,row.dps/max*78)}px"></b><span>${row.year.slice(2)}</span></div>`).join('')}</div>`:'<p class="empty-inline">완료된 연도 기록이 쌓이면 주당배당 성장을 보여줍니다.</p>'}<div class="growth-rate-row"><span>3년 ${finitePct(analytics.cagr3)}</span><span>5년 ${finitePct(analytics.cagr5)}</span><span>10년 ${finitePct(analytics.cagr10)}</span></div>${analytics.cutCount?`<p class="strategy-warning">기록상 배당 감소 ${analytics.cutCount}회</p>`:''}`;
  }

  function strategyInsightHTML(calc){
    if(calc.project.category==='highYield')return `<article class="card portfolio-section strategy-card"><div class="detail-title"><strong>주당 실제 지급액</strong><span>최근 최대 8회</span></div>${paymentTrendHTML(calc)}<div class="strategy-metrics"><div><span>최근 12개월 세후</span><strong>${fmtMoney(calc.analytics.trailingNet,2)}</strong></div><div><span>평단 기준 세후 YOC</span><strong>${calc.analytics.trailingYoc===null?'—':fmtPct(calc.analytics.trailingYoc)}</strong></div><div><span>누적 세후분배금 ÷ 순투입원금</span><strong>${fmtPct(calc.lifetimeDividendRecoveryPct)}</strong></div></div><p class="detail-note">예상 배당은 섞지 않습니다. 마지막 비율은 투자수익 지표이며 실제 원금 보전이나 회수를 뜻하지 않습니다.</p></article>`;
    if(calc.project.category==='growth')return `<article class="card portfolio-section strategy-card"><div class="detail-title"><strong>배당 성장</strong><span>완료 연도 기준</span></div>${annualDpsHTML(calc)}<p class="detail-note">분할을 보정한 실제 주당배당 기준입니다. 현재 진행 중인 연도는 성장률에서 제외합니다.</p></article>`;
    return `<article class="card portfolio-section strategy-card"><div class="detail-title"><strong>배당 기록</strong><span>같은 기간 비교</span></div><div class="strategy-metrics"><div><span>최근 12개월 실제</span><strong>${fmtMoney(calc.analytics.trailingNet,2)}</strong></div><div><span>평단 기준 세후 YOC</span><strong>${calc.analytics.trailingYoc===null?'—':fmtPct(calc.analytics.trailingYoc)}</strong></div><div><span>전년 동기 대비</span><strong class="${calc.analytics.ytdChange===null?'':signClass(calc.analytics.ytdChange)}">${finitePct(calc.analytics.ytdChange)}</strong></div></div></article>`;
  }

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
    const selectedKey=series.some(row=>row.key===getChartSelection?.())?getChartSelection():series.at(-1).key;
    const chartMoney=value=>{
      if(displayCurrency()==='KRW'){
        const krw=n(value)*n(state.settings.exchangeRate);
        if(Math.abs(krw)>=10000)return `${(krw/10000).toFixed(Math.abs(krw)>=100000?1:1)}만`;
        return `${Math.round(krw).toLocaleString('ko-KR')}원`;
      }
      return `$${n(value).toLocaleString('en-US',{minimumFractionDigits:value&&Math.abs(value)<1000?2:0,maximumFractionDigits:Math.abs(value)<1000?2:0})}`;
    };
    return `<div class="column-chart compact-chart ${getChartMode()==='year'||getChartMode()==='month'&&getChartYear?.()?'wide-chart':'fit-chart'}">${series.map(x=>`<button class="column-item ${selectedKey===x.key?'active':''}" type="button" data-chart-key="${esc(x.key)}" aria-label="${esc(x.label)} 배당 ${esc(fmtMoney(x.value,2))}"><div class="column-value" title="${esc(fmtMoney(x.value,2))}">${esc(chartMoney(x.value))}</div><div class="column-track"><div class="column-fill" style="height:${x.value>0?Math.max(7,x.value/max*100):0}%"></div></div><div class="column-label">${esc(getChartMode()==='week'?x.label.slice(3):x.label)}</div></button>`).join('')}</div>`;
  }
  function chartSelectionHTML(projectId) {
    const chartMonth=getChartMonth?.()||todayISO().slice(0,7),series=getChartMode()==='monthWeeks'?monthWeeks(projectRows('dividends',projectId).filter(r=>r.date<=todayISO()),chartMonth).map(r=>({...r,key:r.range})):chartSeries(projectId);
    if(!series.length)return '';
    const selected=series.find(row=>row.key===getChartSelection?.())||series.at(-1),mode=getChartMode(),label=mode==='year'?`${selected.key}년`:mode==='month'?`${selected.key.replace('-','년 ')}월`:selected.label;
    const count=mode==='year'||mode==='month'?projectRows('dividends',projectId).filter(row=>row.date<=todayISO()&&row.date.startsWith(selected.key)).length:null;
    return `<div class="chart-selection-inline"><div><span>${esc(label)} 실제 입금</span><strong>${fmtMoney(selected.value,2)}</strong>${count!==null?`<small>${count}회</small>`:''}</div>${mode==='month'?`<button class="btn soft small" data-income-month="${esc(selected.key)}" data-income-project="${esc(projectId)}">최근 ${count}회 보기</button>`:''}</div>`;
  }

  function cashflowChart(items,selectedKey,mode) {
    const max=Math.max(1,...items.map(item=>item.actual));
    return `<div class="cashflow-chart actual-only ${mode==='year'?'year-bars':''}" aria-label="${mode==='year'?'연도별':'월별'} 실제 배당">${items.map(item=>`<button class="cashflow-month ${item.key===selectedKey?'active':''}" type="button" data-cashflow-period="${esc(item.key)}" aria-label="${esc(item.label)} 실제 배당 ${esc(fmtMoney(item.actual,2))}"><div class="cashflow-bars"><i class="cashflow-actual" style="height:${item.actual>0?Math.max(5,item.actual/max*112):0}px"></i></div><span>${esc(mode==='year'?item.label:item.label.replace('월',''))}</span></button>`).join('')}</div>`;
  }
  function renderHome() {
    const total=totals(),metrics=buildHomeMetrics(total.rows,state.dividends),goal=metrics.nextGoal,paceChange=metrics.pace.change,currentMonth=todayISO().slice(0,7),mode=getHomeCashflowMode?.()||'month',yearRange=getHomeYearRange?.()||'6',yearCount=yearRange==='all'?metrics.years.length:Number(yearRange),series=mode==='year'?metrics.years.slice(-yearCount):metrics.months,defaultKey=mode==='year'?(series.at(-1)?.key||String(new Date().getFullYear())):currentMonth,selectedKey=series.some(item=>item.key===getCashflowMonthKey?.())?getCashflowMonthKey():defaultKey,selected=series.find(item=>item.key===selectedKey)||{key:selectedKey,label:selectedKey,actual:0,count:0};
    const selectedRows=state.dividends.filter(row=>isDate(row.date)&&row.date<=todayISO()&&row.date.startsWith(selectedKey)),projectMap=new Map(activeProjects().map(project=>[project.id,project])),symbolRows=[...selectedRows.reduce((map,row)=>{const project=projectMap.get(row.projectId),symbol=project?.symbol||'보관 종목',item=map.get(symbol)||{symbol,value:0,project};item.value+=n(row.amountUSD);map.set(symbol,item);return map;},new Map()).values()].sort((a,b)=>b.value-a.value),topSymbols=symbolRows.slice(0,4),other=symbolRows.slice(4).reduce((sum,row)=>sum+row.value,0),composition=other?[...topSymbols,{symbol:'기타',value:other,project:null}]:topSymbols,compositionTotal=Math.max(1,composition.reduce((sum,row)=>sum+row.value,0)),compositionColor=(row,index)=>row.project?projectColors(row.project)[0]:`hsl(${225+index*24} 18% ${55-index*3}%)`;
    document.getElementById('page-home').innerHTML=`${sectionTitle('홈','세후 배당')}
      <div class="stack home-flow home-redesign">
        <article class="card month-overview">
          <div class="overview-heading"><h3>이번 달 받은 배당</h3><span>${new Date().getMonth()+1}월</span></div>
          <div class="hero-label">실제 세후 입금</div>
          <div class="hero-amount">${fmtMoney(metrics.month.actual,2)}</div>
          <div class="month-parts"><div><span>입금 횟수</span><strong>${metrics.month.count}회</strong></div><div><span>지난달 대비</span><strong class="${metrics.month.change===null?'':signClass(metrics.month.change)}">${metrics.month.change===null?'비교 전':fmtPct(metrics.month.change)}</strong></div></div>
        </article>
        <article class="card cashflow-card history-overview">
          <div class="overview-heading"><h3>배당 현금흐름</h3><div class="cashflow-mode"><button class="${mode==='month'?'active':''}" data-home-cashflow-mode="month">월별</button><button class="${mode==='year'?'active':''}" data-home-cashflow-mode="year">연도별</button></div></div>
          <p class="chart-instruction">막대를 누르면 해당 기간의 실제 입금 구성이 바뀝니다.</p>
          ${mode==='year'?`<div class="year-range-switch" aria-label="연도 표시 범위">${[['6','최근 6년'],['10','10년'],['all','전체']].map(([value,label])=>`<button class="${yearRange===value?'active':''}" data-home-year-range="${value}">${label}</button>`).join('')}</div>`:''}
          ${cashflowChart(series,selectedKey,mode)}
          ${mode==='year'&&yearRange==='all'&&metrics.years.length>10?`<div class="five-year-summary">${Array.from({length:Math.ceil(metrics.years.length/5)},(_,index)=>metrics.years.slice(index*5,index*5+5)).map(group=>`<div><span>${group[0].key}–${group.at(-1).key}</span><strong>${fmtMoney(group.reduce((sum,row)=>sum+row.actual,0),0)}</strong></div>`).join('')}</div>`:''}
          <div class="cashflow-selection"><div><span>${mode==='year'?`${selectedKey}년`:`${selectedKey.replace('-','년 ')}월`}</span><strong>${fmtMoney(selected.actual,2)}</strong><small>${selectedRows.length}회 입금</small></div>${composition.length>1?`<div class="composition-bar" aria-label="종목별 실제 배당 비중">${composition.map((row,index)=>`<i style="width:${row.value/compositionTotal*100}%;--segment:${compositionColor(row,index)}" title="${esc(row.symbol)} ${esc(fmtMoney(row.value,2))}"></i>`).join('')}</div><div class="composition-legend">${composition.map((row,index)=>`<span><i style="--dot:${compositionColor(row,index)}"></i>${esc(row.symbol)} <b>${fmtMoney(row.value,0)}</b></span>`).join('')}</div>`:'<p class="single-symbol-note">'+(composition[0]?`${esc(composition[0].symbol)}에서 받은 실제 배당입니다.`:'이 기간의 입금 기록이 없습니다.')+'</p>'}</div>
          ${mode==='month'?`<button class="card-link" data-income-month="${selectedKey}"><span>날짜별 입금 상세</span><b>›</b></button>`:''}
          <div class="cashflow-year-summary">
            <div><span>올해 받은 배당</span><strong>${fmtMoney(metrics.year.actual,2)}</strong></div>
            <div><span>지난해 총 배당</span><strong>${fmtMoney(metrics.year.previous,2)}</strong></div>
          </div>
          <div class="cashflow-pace-summary"><div><span>최근 3개월 월평균</span><strong>${metrics.pace.available?fmtMoney(metrics.pace.monthly,2):'기록 부족'}</strong></div><div><span class="${paceChange===null?'':signClass(paceChange)}">${paceChange===null?'비교 전':fmtPct(paceChange)}</span><small>직전 3개월 대비</small></div></div>
        </article>
        <article class="card compact next-card ${goal?'interactive-card':''}" ${goal?`data-goal-detail="${goal.calc.project.id}" tabindex="0" role="button"`:''}><div class="card-kicker">다음 목표</div>${goal?`<div class="next-line"><div><strong>${esc(goal.calc.project.symbol)} · ${goal.milestone.reached?'목표 달성':`${fmtShares(goal.milestone.shares)}주`}</strong><span>현재 ${fmtShares(goal.calc.shares)}주${goal.milestone.reached?' · 현금흐름 단계':` · ${fmtShares(goal.milestone.remaining)}주 남음`}</span></div><b>›</b></div>`:'<div class="empty-inline">종목을 추가하면 가장 가까운 목표를 보여줍니다.</div>'}</article>
      </div>`;
    if(mode==='year'&&typeof requestAnimationFrame==='function')requestAnimationFrame(()=>document.querySelector('#page-home .cashflow-month.active')?.scrollIntoView({block:'nearest',inline:'center'}));
  }
  function periodButtons() {
    return `<div class="chart-period">${[['week','주'],['month','월'],['year','년'],['monthWeeks','주차']].map(([mode,label])=>`<button type="button" data-chart-mode="${mode}" class="${getChartMode()===mode?'active':''}">${label}</button>`).join('')}</div>`;
  }
  function projectSummaryCard(calc) {
    const colors=projectColors(calc.project), pct=calc.progress*100;
    return `<article class="card compact project-list-card" data-open-project="${calc.project.id}" tabindex="0" role="button" aria-label="${esc(calc.project.symbol)} 프로젝트 열기" style="border-left:4px solid ${colors[0]}">
      <div class="card-head"><div><div class="row-title">${esc(calc.project.symbol)} · ${esc(calc.project.tag)}</div><div class="row-sub">${fmtShares(calc.shares)} / ${fmtShares(calc.currentTarget)}주</div></div><span class="status-pill">${fmtPct(pct)}</span></div>
      ${progress(pct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}
      <div class="summary-grid" style="margin-top:12px"><div class="summary-chip"><div class="label">누적 세후배당</div><div class="value">${fmtMoney(calc.dividendsTotal,2)}</div></div><div class="summary-chip"><div class="label">총손익</div><div class="value ${calc.priceAvailable?signClass(calc.totalReturn):''}">${calc.priceAvailable?fmtMoney(calc.totalReturn,2):'현재가 필요'}</div></div></div>
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
    const allProjects=activeProjects(); let category=getPortfolioCategory?.()||'all',projects=category==='all'?allProjects:allProjects.filter(project=>project.category===category),selectedProjectId=getSelectedProjectId();

    if(!selectedProjectId||!projects.some(project=>project.id===selectedProjectId)){selectedProjectId=projects[0]?.id||'';setSelectedProjectId(selectedProjectId);}
    const calc=projects.length?computeProject(selectedProjectId):null, page=document.getElementById('page-projects');
    if(!calc){page.innerHTML=`${sectionTitle('포트폴리오')}<div class="portfolio-filter-chips" aria-label="분석 필터">${[['all','전체'],...PROJECT_CATEGORIES].map(([key,label])=>`<button data-portfolio-category="${key}" class="${category===key?'active':''}">${label}</button>`).join('')}</div><article class="card empty-project"><p>이 분석 필터에 해당하는 종목이 없습니다.</p><button class="btn primary" data-add-project>종목 추가</button></article>`;return;}
    const p=calc.project, colors=projectColors(p), rec=recoveryStats(calc), pct=calc.progress*100, allRows=combinedRecords(calc),filter=getHistoryFilter?.()||{},rows=selectRecords(allRows,filter),historyLimit=getHistoryLimit?.()||10;
    page.innerHTML=`
      <div class="section-title-row"><h2 class="section-title">포트폴리오</h2><button class="btn soft small" data-add-project>＋ 종목</button></div>
      <div class="portfolio-filter-heading"><span>종목 ${allProjects.length}개</span><small>운용 성격으로 좁혀보기 · 토스 연결과 무관</small></div><div class="portfolio-filter-chips" aria-label="운용 성격 분석 필터">${[['all','전체'],...PROJECT_CATEGORIES].map(([key,label])=>`<button class="${category===key?'active':''}" data-portfolio-category="${key}">${label}<b>${key==='all'?allProjects.length:allProjects.filter(x=>x.category===key).length}</b></button>`).join('')}</div>
      ${projects.length>4?`<label class="project-select-label">종목 선택<select class="input" data-project-select>${projects.map(x=>`<option value="${x.id}" ${x.id===p.id?'selected':''}>${esc(x.symbol)} · ${esc(categoryLabel(x.category))}</option>`).join('')}</select></label>`:`<div class="project-tabs">${projects.map(x=>`<button class="project-tab ${x.id===p.id?'active':''}" data-select-project="${x.id}">${esc(x.symbol)}</button>`).join('')}</div>`}
      <div class="stack portfolio-stack">
        <article class="card portfolio-summary" style="--project-a:${colors[0]};--project-b:${colors[1]}">
          <div class="portfolio-heading"><div><div class="project-symbol">${esc(p.symbol)}</div><div class="project-name">${esc(p.name)}</div><div class="project-tags"><span class="strategy-tag">${esc(categoryLabel(p.category))}</span>${(p.brokerLinks||[]).some(link=>link.provider==='toss')?'<span class="sync-tag">토스 연결</span>':''}</div></div><button class="btn soft small project-settings-shortcut" data-project-settings aria-label="${esc(p.symbol)} 종목 설정">설정</button></div>
          <div class="value-line"><div class="value-caption"><span>평가금액</span><small>${calc.priceAvailable?'현재가 반영':'현재가 미입력'}</small></div><strong>${calc.priceAvailable?fmtMoney(calc.marketValue):'—'}</strong><small class="${calc.priceAvailable?signClass(calc.unrealized):''}">${calc.priceAvailable?`평가손익 ${fmtSignedMoney(calc.unrealized)}`:'토스 연동 전에는 아래 수동 관리에서 입력할 수 있습니다.'}</small></div>
          <div class="holding-row"><div><span>보유주수</span><strong>${fmtShares(calc.shares)}주</strong></div><div><span>평균단가</span><strong>${fmtMoney(calc.avgCost)}</strong></div></div>
        </article>
        <article class="card portfolio-cashflow compact-income">
          <div class="overview-heading"><h3>배당 현금흐름</h3><span>${frequencyOf(p).label} · 세후</span></div>
          <div class="portfolio-income-hero"><span>이번 달 실제 배당</span><strong>${fmtMoney(calc.currentMonthDividends,2)}</strong></div>
          <div class="cashflow-secondary"><div><span>누적 세후배당</span><strong>${fmtMoney(calc.dividendsTotal,2)}</strong></div><div><span>최근 12개월 실제</span><strong>${fmtMoney(calc.analytics.trailingNet,2)}</strong></div>${Math.abs(calc.dividendAvailable-calc.dividendsTotal)>.01?`<div><span>남은 배당금</span><strong>${fmtMoney(calc.dividendAvailable,2)}</strong></div>`:calc.reinvestAmount>0?`<div><span>재투자 사용</span><strong>${fmtMoney(calc.reinvestAmount,2)}</strong></div>`:''}</div>
        </article>
        ${strategyInsightHTML(calc)}
        ${p.recovery?.locked?`<article class="card portfolio-section"><div class="detail-title"><strong>원금회수</strong><span>${fmtPct(rec.pct)}</span></div>${progress(rec.pct)}<div class="detail-note">회수 ${fmtMoney(rec.total)} · 남은 원금 ${fmtMoney(rec.remaining)}</div><button class="btn soft small" data-edit-recovery="${p.id}">회수 기준 수정</button></article>`:''}
        <article class="card portfolio-section"><div class="detail-title"><strong>배당 흐름</strong><div class="chart-period">${[['week','주'],['month','월'],['year','년'],['monthWeeks','주차']].map(([mode,label])=>`<button type="button" data-chart-mode="${mode}" class="${getChartMode()===mode?'active':''}">${label}</button>`).join('')}</div></div>${getChartMode()==='month'?`<div class="chart-filter-line"><label for="chartYear">조회 연도</label><select id="chartYear" class="input" aria-label="월별 배당 연도" data-chart-year><option value="">최근 지급월</option>${[...new Set([...(getChartYear?.()?[getChartYear()]:[]),...calc.postedDividends.map(r=>r.date.slice(0,4))])].sort().reverse().map(year=>`<option value="${year}" ${getChartYear?.()===year?'selected':''}>${year}년</option>`).join('')}</select></div>`:''}${getChartMode()==='year'?'<p class="tiny muted">전체 기록 연도 · 좌우로 밀어 확인하세요.</p>':''}${getChartMode()==='monthWeeks'?`<label class="input-label" for="chartMonth">주차를 볼 월</label><input id="chartMonth" class="input" type="month" value="${esc(getChartMonth?.()||todayISO().slice(0,7))}" data-chart-month><p class="tiny muted">1~7일 / 8~14일 / 15~21일 / 22~28일 / 29~말일</p>`:''}<div id="projectChart">${chartHTML(p.id)}</div>${chartSelectionHTML(p.id)}</article>
        <article class="card portfolio-section"><div class="detail-title"><strong>배당 포함 성과</strong><span class="${calc.priceAvailable?signClass(calc.totalReturn):''}">${calc.priceAvailable?fmtSignedMoney(calc.totalReturn):'현재가 필요'}</span></div><div class="performance-rows"><div><span>평가손익</span><strong class="${calc.priceAvailable?signClass(calc.unrealized):''}">${pricedMoney(calc,calc.unrealized)}</strong></div><div><span>실현손익</span><strong class="${signClass(calc.realized)}">${fmtSignedMoney(calc.realized)}</strong></div><div><span>누적 세후배당</span><strong class="positive">${fmtMoney(calc.dividendsTotal)}</strong></div></div></article>
        <details class="card manual-tools"><summary><div><strong>수동 관리</strong><span>토스 미연동·누락 기록 보정용</span></div><b class="chev">⌄</b></summary><div class="manual-tools-body"><div class="support-actions"><button class="btn soft small" data-edit-price>현재가</button><button class="btn soft small" data-add-trade>거래</button><button class="btn soft small" data-add-dividend>배당 입금</button><button class="btn soft small" data-add-cash>잔액 보정</button><button class="btn soft small" data-add-split>분할·역분할</button><button class="btn soft small" data-project-check>점검</button></div></div></details>
        <details class="card transaction-history">
          <summary><div><strong>거래내역</strong><span>${rows.length}건 · 눌러서 보기</span></div><b class="chev">⌄</b></summary>
          <div class="transaction-body"><form id="historyFilterForm" class="history-filter"><label>기간<input class="input" type="month" name="month" value="${esc(filter.month||'')}"></label><label>유형<select class="input" name="kind">${[['','전체'],['trade','거래'],['dividend','배당'],['split','분할'],['cash','잔액 보정']].map(([value,label])=>`<option value="${value}" ${filter.kind===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="history-query">날짜 · 메모 · 금액<input class="input" type="search" name="query" value="${esc(filter.query||'')}" placeholder="기록 검색"></label><button class="btn soft" type="submit">조회</button><button class="btn soft" type="button" data-history-reset>전체 보기</button></form><p class="tiny muted">${rows.length}건 / 전체 ${allRows.length}건</p><div class="list records-list">${rows.slice(0,historyLimit).map(recordRow).join('')||'<div class="empty">조건에 맞는 기록이 없습니다.</div>'}</div>${rows.length>historyLimit?`<button class="btn soft history-more" data-history-more>이전 기록 10건 더 보기 (${rows.length-historyLimit}건 남음)</button>`:''}</div>
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
      <div class="stack">${rows.map(calc=>{const p=calc.project,colors=projectColors(p),milestone=nextMilestone(calc),rec=recoveryStats(calc),goalPct=milestone.reached?100:(calc.shares/Math.max(1,milestone.shares))*100,buyCost=calc.priceAvailable?milestone.remaining*calc.currentPrice:0;return `<details class="card goal-step-card" data-goal-project="${esc(p.id)}" style="--project-a:${colors[0]};--project-b:${colors[1]}">
        <summary><div><span class="goal-symbol">${esc(p.symbol)}</span><strong>${fmtShares(milestone.shares)}주 목표</strong><small>현재 ${fmtShares(calc.shares)}주${milestone.reached?' · 목표 달성':` · ${fmtShares(milestone.remaining)}주 남음`}</small></div><b>${milestone.reached?'완료':fmtPct(goalPct)}</b></summary>
        ${progress(goalPct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}
        ${milestone.reached?`<div class="goal-detail-body"><div class="cashflow-primary"><span>최근 12개월 실제 세후배당</span><strong>${fmtMoney(calc.analytics.trailingNet,2)}</strong></div><p class="detail-note">예상 배당이 아니라 실제 입금 기록입니다.</p></div>`:`<div class="goal-detail-body"><div class="goal-info-rows"><div><span>현재 보유</span><strong>${fmtShares(calc.shares)}주</strong></div><div><span>최근 12개월 실제</span><strong>${fmtMoney(calc.analytics.trailingNet,2)}</strong></div><div><span>필요 매수금</span><strong>${calc.priceAvailable?fmtMoney(buyCost,2):'현재가 필요'}</strong></div><div><span>계획상 달성 시점</span><strong>${estimatedDate(calc,milestone.shares)}</strong></div></div><button class="btn soft small" data-settings-project="${esc(p.id)}">목표 · 월 매수계획 설정</button><p class="detail-note">달성 시점은 저장한 월 매수계획만 반영하며 배당금은 예측하지 않습니다.</p></div>`}
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
          <div><label class="input-label">화면 밝기</label><select class="input select" name="appearance"><option value="system" ${state.settings.appearance==='system'?'selected':''}>휴대폰 설정 따라 자동</option><option value="light" ${state.settings.appearance==='light'?'selected':''}>항상 밝은 화면</option><option value="dark" ${state.settings.appearance==='dark'?'selected':''}>항상 어두운 화면</option></select></div>
          <button class="btn secondary" type="submit">화면 설정 저장</button>
        </form><p class="tiny muted" style="margin-top:10px">자동 환율은 연동 데이터에 환율이 포함될 때 적용하고, 그 전까지는 입력값을 유지합니다.</p></div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">배당 관리 기준</div><div class="sub-number">월 목표 $${Math.round(n(state.settings.targetMonthlyDividend)).toLocaleString('en-US')} · 관리기준 ${Math.round(n(state.settings.thresholdKRW)).toLocaleString('ko-KR')}원</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><form id="dividendSettingsForm" class="form-grid">
          <div><label class="input-label">전체 월배당 목표 USD</label><input class="input" name="targetMonthlyDividend" type="number" min="0" step="1" value="${n(state.settings.targetMonthlyDividend)}"></div>
          <div><label class="input-label">연간 세후배당 경고선 (원)</label><input class="input" name="warningKRW" type="number" min="0" step="10000" value="${n(state.settings.warningKRW)}"></div>
          <div><label class="input-label">연간 세후배당 관리기준 (원)</label><input class="input" name="thresholdKRW" type="number" min="0" step="10000" value="${n(state.settings.thresholdKRW)}"></div>
          <button class="btn secondary" type="submit">배당 기준 저장</button>
        </form><p class="tiny muted" style="margin-top:10px">홈과 현금흐름은 실제 입금 기록만 집계합니다.</p></div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">종목별 설정</div><div class="sub-number">운용 성격 · 목표 · 그래프 색상</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><div class="list settings-project-list">${activeProjects().map(project=>`<div class="list-row"><div><div class="row-title"><span class="project-color-dot" style="background:${projectColors(project)[0]}"></span>${esc(project.symbol)}</div><div class="row-sub">${esc(categoryLabel(project.category))} · 목표 ${fmtShares(project.targetUnits)}주</div></div><button class="mini-icon" data-settings-project="${project.id}">수정</button></div>`).join('')}</div></div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">토스증권 읽기 전용</div><div class="sub-number">보유주식 · 현재가 · 체결 대조</div></div><span class="status-pill ${toss.status==='connected'?'positive':''}">${tossStatus}</span><b class="chev">⌄</b></summary><div class="settings-section-body">
          <p class="tiny muted">${esc(tossDescription)}</p>
          <p class="tiny muted toss-capability-note">현재 공개 API 연동 범위는 보유주식·현재가·체결입니다. 배당 입금은 API 응답에 포함될 때만 승인 후보로 받고, 그 전에는 수동 보정 기록을 V4에 영구 보존합니다.</p>
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
          ${tossComparisons.length?`<div class="list" style="margin-top:12px">${tossComparisons.map(row=>`<div class="list-row"><div><div class="row-title">${esc(row.symbol)} · ${fmtShares(row.shares)}주</div><div class="row-sub">${row.accounts?.length>1?`${row.accounts.length}계좌 합산 · `:''}앱 ${fmtShares(row.appShares)}주${row.supported?'':' · 원화 종목은 대조만'}</div></div><div class="row-value ${Math.abs(n(row.difference))<.0001?'positive':''}">${Math.abs(n(row.difference))<.0001?'일치':`${n(row.difference)>0?'+':''}${fmtShares(row.difference)}주`}</div></div>`).join('')}</div>`:''}
          ${toss.unsupportedCurrencyCount?`<p class="tiny muted">원화 체결 ${toss.unsupportedCurrencyCount}건은 USD 원장에 섞지 않고 제외했습니다.</p>`:''}
          ${toss.matchedExistingCount?`<p class="tiny muted">기존 수동 거래와 일치한 토스 체결 ${toss.matchedExistingCount}건은 중복 저장하지 않았습니다.</p>`:''}${toss.matchedExistingDividendCount?`<p class="tiny muted">기존 배당과 일치한 토스 입금 ${toss.matchedExistingDividendCount}건은 중복 저장하지 않았습니다.</p>`:''}
          ${(toss.sourceLedger?.orders?.length||toss.sourceLedger?.dividends?.length)?`<p class="tiny positive">기기 보존 원본 · 거래 ${toss.sourceLedger.orders.length}건 · 배당 ${toss.sourceLedger.dividends.length}건${toss.lastSuccessfulAt?' · 마지막 성공 '+fmtDate(toss.lastSuccessfulAt.slice(0,10)):''}</p>`:''}
          ${toss.historyTruncated?'<p class="tiny negative">체결 기록이 10,000건을 넘어 일부만 조회됐습니다. 기간을 나눠 다시 조회해야 합니다.</p>':''}
          <div class="action-row" style="margin-top:12px"><button class="btn secondary" data-sync-toss ${canSync&&!tossBusy?'':'disabled'}>${tossBusy?'조회 중…':toss.status==='connected'?'다시 조회':'전체 조회'}</button><button class="btn soft" data-review-toss ${(toss.candidates?.length||toss.dividendCandidates?.length)?'':'disabled'}>${(toss.candidates?.length||0)+(toss.dividendCandidates?.length||0)?`후보 ${(toss.candidates?.length||0)+(toss.dividendCandidates?.length||0)}건 검토`:'후보 없음'}</button></div>
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
