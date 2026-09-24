import { esc, n } from './utils.js';

export function renderDividendView(context) {
  const {
    state, total, projects, sectionTitle, periodButtons, chartHTML, recordRow,
    computeProject, fmtMoney, fmtDate, fmtShares, signClass
  } = context;
  const page=document.getElementById('page-dividend');
  if(!page)return;
  const recent=(state.dividends||[])
    .filter(row=>projects.some(project=>project.id===row.projectId))
    .sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt||b.id).localeCompare(String(a.createdAt||a.id)))
    .slice(0,5)
    .map(row=>({...row,kind:'dividend'}));
  const projectCards=projects.map(project=>{
    const calc=computeProject(project);
    const lastDividend=[...(calc.dividends||[])].sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
    return `<article class="card compact dividend-project-card">
      <div>
        <div class="row-title">${esc(project.symbol)} · ${esc(project.tag)}</div>
        <div class="row-sub">${fmtShares(calc.shares)}주 · 최근 지급 ${lastDividend?fmtDate(lastDividend.date):'기록 없음'}</div>
        <div class="project-dividend-values">
          <span>월환산<strong>${calc.estimateReliable?fmtMoney(calc.monthlyEstimate,0):'—'}</strong></span>
          <span>올해<strong>${fmtMoney(calc.yearDividends,0)}</strong></span>
          <span>사용 가능<strong class="${signClass(calc.dividendAvailable)}">${fmtMoney(calc.dividendAvailable,0)}</strong></span>
        </div>
      </div>
      <button class="dividend-add-btn" type="button" data-add-dividend-for="${project.id}" aria-label="${esc(project.symbol)} 배당 입력">＋</button>
    </article>`;
  }).join('');
  page.innerHTML=`${sectionTitle('배당','전체 현금흐름')}
    <div class="stack">
      <div class="dividend-dashboard">
        <article class="dividend-stat"><span>이번 달 실입금</span><strong>${fmtMoney(total.currentMonthDividends,0)}</strong><small>실제 입력 합계</small></article>
        <article class="dividend-stat"><span>최근 12개월</span><strong>${fmtMoney(total.trailing12Dividends,0)}</strong><small>세후 실입금</small></article>
        <article class="dividend-stat"><span>누적 세후배당</span><strong>${fmtMoney(total.dividendsTotal,0)}</strong><small>전체 프로젝트</small></article>
        <article class="dividend-stat"><span>사용 가능 배당</span><strong class="${signClass(total.dividendAvailable)}">${fmtMoney(total.dividendAvailable,0)}</strong><small>배당 + 보정 − 재투자</small></article>
      </div>
      <article class="card">
        <div class="card-head"><div><div class="card-title">배당 흐름</div><div class="sub-number">실제 세후 입금 기록만 반영</div></div>${periodButtons()}</div>
        ${chartHTML()}
      </article>
      ${sectionTitle('종목별 배당','빠른 입력')}
      <div class="dividend-projects">${projectCards||'<article class="card empty-project">포트폴리오에서 종목을 먼저 추가해 주세요.</article>'}</div>
      <article class="card">
        <div class="card-head"><div><div class="card-title">최근 배당</div><div class="sub-number">최근 5건</div></div><span class="status-pill">${recent.length}건</span></div>
        <div class="list">${recent.map(recordRow).join('')||'<div class="empty">아직 배당 기록이 없습니다.</div>'}</div>
      </article>
      ${total.staleEstimateCount?`<article class="card compact"><div class="row-title">월환산 점검 필요</div><div class="row-sub">${n(total.staleEstimateCount)}개 종목은 기록 수·최근 지급일·지급 간격 조건이 부족해 추정치를 숨겼습니다.</div></article>`:''}
    </div>`;
}

