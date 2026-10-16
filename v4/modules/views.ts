import {dividendPlanStatus,projectRecovery} from './dividend-plan.js';
import type { ProjectCalculation } from './portfolio.js';
import type { AppState, DividendRecord, Project } from '../types/domain.js';

import { selectRecords, monthWeeks, historicalIncome } from './activity.js';
import { reportingDividends, isPostedDividend } from './finance.js';
import { APP_VERSION } from '../backup.js';
import { clamp, esc, isDate, n, todayISO } from './utils.js';
import { buildHomeMetrics, nextMilestone, dividendGoalStatus } from './home-metrics.js';
import { PROJECT_CATEGORIES } from './constants.js';


import type { createPortfolioEngine } from './portfolio.js';
import type { createFormatters } from './format.js';
import type { RecordFilter } from './activity.js';
import type { OfficialDistributionFeed } from './finance.js';
import { isRecord } from './utils.js';
type Engine = ReturnType<typeof createPortfolioEngine>;
type ChartRow = {key:string;label:string;value:number};
type Payment = ProjectCalculation['income']['payments'][number];
type Composition = {symbol:string;value:number;project:Project|null|undefined};
const releaseLabel=(value:string)=>/^[1-9]\d*\.\d+\.0$/.test(value)?value.slice(0,-2):value;
const records=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.filter(isRecord):[];
export type ViewContext = Pick<Engine,'activeProjects'|'projectById'|'projectRows'|'computeProject'|'recoveryStats'|'totals'> & ReturnType<typeof createFormatters> & {
  getInteractionPreferences?:()=>{haptics:boolean;motion:boolean};
  getState:()=>AppState;
  getSelectedProjectId:()=>string;setSelectedProjectId:(value:string)=>void;
  getPortfolioDetail?:()=>boolean;getPortfolioDetailTab?:()=>string;
  getPortfolioIncomeMonth?:(projectId:string)=>string;
  getPortfolioGroup?:()=>string;setPortfolioGroup?:(value:string)=>void;
  getChartMode:()=>string;getChartSelection?:()=>string;
  getHomeCashflowMode?:()=>string;getHomeYearRange?:()=>string;getHistoryLimit?:()=>number;
  getHistoryFilter?:()=>RecordFilter;getChartMonth?:()=>string;getChartYear?:()=>string;getCashflowMonthKey:()=>string;
  getCurrentUser:()=>{uid:string}|null;
  getAutoBackupStatus?:()=>{count:number;lastAt:string;error:string};
  getNativeTossStatus?:()=>{available:boolean;configured:boolean;publicIp:string;lastPublicIp?:string;checking:boolean};
  getAppUpdateStatus?:()=>{available:boolean;checking:boolean;currentVersion:string;latestVersion:string;updateAvailable:boolean;nativeUpdateRequired:boolean;error:string};
  getExchangeRateStatus?:()=>{busy:boolean;error:string};
  getCombinedRefreshStatus?:()=>{busy:boolean;summary:string};
  getSaveSummary?:()=>string;
  getOfficialDistributionStatus?:()=>{feed:OfficialDistributionFeed|null;busy:boolean;error:string};
  isTossBridgeConfigured:()=>boolean;
};

export function createViews(context: ViewContext) {
  const {
    getInteractionPreferences, getPortfolioDetail, getPortfolioDetailTab, getPortfolioIncomeMonth, getState, getSelectedProjectId, setSelectedProjectId, getPortfolioGroup, setPortfolioGroup, getChartMode, getChartSelection, getHomeCashflowMode, getHomeYearRange, getHistoryLimit, getHistoryFilter, getChartMonth, getChartYear, getCashflowMonthKey, getCurrentUser, getAutoBackupStatus, getNativeTossStatus, getAppUpdateStatus, getExchangeRateStatus, getCombinedRefreshStatus, getSaveSummary, getOfficialDistributionStatus, isTossBridgeConfigured,
    activeProjects, projectById, projectRows, computeProject, recoveryStats, totals,
    displayCurrency, fmtMoney, fmtDividend, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors
  } = context;
  const state = new Proxy({} as AppState, { get: (_, key) => Reflect.get(getState(),key) });
  // Preserve reading position and disclosure state when live values change.
  const viewScopes=new Map<string,string>();
  function preserveView(id:string,scope:string,draw:()=>void):void {
    const page=document.getElementById(id)!;
    if(!page.querySelectorAll||typeof window==='undefined'){draw();return;}
    const same=viewScopes.get(id)===scope,scrollY=window.scrollY,active=page.classList.contains('active');
    const keys=(selector:string)=>{
      const counts=new Map<string,number>();
      return [...page.querySelectorAll<HTMLElement>(selector)].map(el=>{
        const base=JSON.stringify([el.id,el.className,el.closest<HTMLElement>('[data-goal-project]')?.dataset.goalProject||'']);
        const index=counts.get(base)||0;counts.set(base,index+1);return {el,key:base+index};
      });
    };
    const disclosures=new Map(same?keys('details').map(({el,key})=>[key,(el as HTMLDetailsElement).open]):[]);
    const horizontal=new Map(same?keys('.cashflow-chart,.column-chart,.payment-spark,.project-tabs,.five-year-summary').map(({el,key})=>[key,el.scrollLeft]):[]);
    const focused=document.activeElement instanceof HTMLElement&&page.contains(document.activeElement)?document.activeElement:null;
    const focusId=focused?.id,focusName=focused?.getAttribute('name'),formId=focused?.closest('form')?.id;
    draw();viewScopes.set(id,scope);
    keys('details').forEach(({el,key})=>{if(disclosures.has(key))(el as HTMLDetailsElement).open=disclosures.get(key)!;});
    keys('.cashflow-chart,.column-chart,.payment-spark,.project-tabs,.five-year-summary').forEach(({el,key})=>{if(horizontal.has(key))el.scrollLeft=horizontal.get(key)!;});
    if(same&&focused&&!focused.isConnected){
      const replacement=focusId?document.getElementById(focusId):formId&&focusName?[...page.querySelectorAll<HTMLElement>('input,select,textarea')].find(el=>el.getAttribute('name')===focusName&&el.closest('form')?.id===formId):null;
      replacement?.focus({preventScroll:true});
    }
    if(active&&document.body.style.position!=='fixed')window.scrollTo({top:scrollY,behavior:'instant'});
  }
  function renderHome(options:{cashflowOnly?:boolean;selectionOnly?:boolean}={}){
    preserveView('page-home','home',()=>drawHome(options));
  }
  function renderProjects(){preserveView('page-projects',getSelectedProjectId()+':'+String(getPortfolioDetail?.()),drawProjects);}
  function renderGoals(){preserveView('page-goal','goals',drawGoals);}
  function refreshPanelHTML():string{
    const status=getCombinedRefreshStatus?.()||{busy:false,summary:''};
    const last=state.integrations.toss.lastSyncAt;
    return `<div class="refresh-panel"><button class="btn soft small" data-sync-all aria-busy="${status.busy}" ${status.busy?'disabled':''}>${status.busy?'갱신 중…':'토스·환율 갱신'}</button>${status.summary?`<p class="tiny muted" role="status">${esc(status.summary)}</p>`:''}<details class="refresh-info"><summary>조회 정보</summary><p class="tiny muted">토스 ${esc(syncTime(last))}<br>환율 ${state.settings.exchangeRateMode==='auto'?`${esc(state.settings.exchangeRateDate||'미확인')} · ${esc(syncTime(state.settings.exchangeRateUpdatedAt))}`:'직접 입력값 유지'}</p></details></div>`;
  }
  function annualAlertHTML(yearUSD:number):string{
    const status=dividendGoalStatus(state.settings,0,yearUSD);
    if(status.alert==='off')return '';
    const won=(amount:number)=>Math.round(amount).toLocaleString('ko-KR')+'원';
    return `<div class="dividend-alert ${status.alert}" role="status"><strong>${status.alert==='reached'?'연간 배당 알림 기준 도달':status.alert==='early'?'연간 배당 미리 알림':'연간 배당 알림'}</strong><span>올해 세후 입금 ${won(status.annual)} / 기준 ${won(status.limit)}</span><small>${status.alert==='reached'?'기준 초과 '+won(Math.max(0,status.annual-status.limit)):'기준까지 '+won(status.annualRemaining)} · 개인 입금 관리용</small><small>원화는 현재 참고 환율 기준 · 세금 판정 아님</small></div>`;
  }
  function officialScheduleHTML(project: Project):string {
    const status=getOfficialDistributionStatus?.()||{feed:null,busy:false,error:''},feed=project.symbol==='MSTY'?status.feed:null;
    const manual=project.dividendAnnouncement,official=feed?.rows.find((row)=>row.payDate>=todayISO())||feed?.rows[0];
    const row=manual&&manual.payDate>=todayISO()?manual:official;
    const content=row?`<p>${row.payDate>=todayISO()?'공시 지급 예정':'최근 공시 지급'} ${esc(row.payDate)} · 배당락 ${esc(row.exDate)}</p><p class="tiny muted">${row===manual?'직접 기록한 공시':'운용사 공시 · 세전 주당 $'+Number(('amountPerShareUSD' in row?row.amountPerShareUSD:0)).toFixed(4)} · 실제 계좌 입금일은 다를 수 있습니다.</p>${row===official&&feed?`<p class="tiny muted">자료 확인 ${esc(syncTime(feed.retrievedAt))}${Date.now()-Date.parse(feed.retrievedAt)>3*86400000?' · 최신 공시 재확인 필요':''}</p><a class="text-link" href="${esc(feed.sourceURL)}" target="_blank" rel="noopener noreferrer">운용사 원문 보기</a>`:''}${row.payDate<todayISO()?'<p class="tiny muted">다음 지급일은 아직 확인되지 않았습니다.</p>':''}`:'<p class="tiny muted">확인된 공시가 없습니다. 공시 지급일을 기록하면 여기에 표시합니다.</p>';
    return content+(project.symbol==='MSTY'?`<button class="text-link" style="margin-top:10px" data-refresh-official-distributions ${status.busy?'disabled':''}>${status.busy?'공시 확인 중…':'공시 갱신'}</button>${status.error?`<p class="tiny muted">${esc(status.error)}</p>`:''}`:'');
  }
  function shortQuoteTime(value:unknown):string{const date=new Date(String(value||''));if(!Number.isFinite(date.getTime()))return '시간 미확인';const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date);const part=(key:string)=>parts.find(row=>row.type===key)?.value||'';return `${part('year')}.${part('month')}.${part('day')} ${part('hour')}:${part('minute')}`;}
  function syncTime(value: unknown): string {const date=new Date(String(value||''));return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+' (한국 시간)':'기록 없음';}
  function sectionTitle(title: string,note: string ='') { return `<div class="section-title-row"><h2 class="section-title">${esc(title)}</h2>${note?`<span class="section-note">${esc(note)}</span>`:''}</div>`; }
  function progress(value: number,color: string ='') { return `<div class="progress-track"><div class="progress-fill" style="width:${clamp(value,0,100)}%;${color?`background:${color}`:''}"></div></div>`; }
  function pricedMoney(calc: ProjectCalculation,value: number,digits: number =2) { return calc.priceAvailable?fmtMoney(value,digits):'—'; }
  const categoryLabel=(category: unknown)=>category==='highYield'?'고배당주':'배당주';
  const projectGroup=(project: Pick<Project,'category'>|null|undefined)=>project?.category==='highYield'?'highYield':'dividend';
  const finitePct=(value: number|null|undefined)=>value===null||value===undefined||!Number.isFinite(value)?'—':fmtPct(value);

  function paymentTrendHTML(calc: ProjectCalculation){
    const rows=calc.income.payments.slice(0,8),usePerShare=rows.length>0&&rows.every((row)=>row.known),ordered=[...rows].reverse(),values=ordered.map(row=>usePerShare?row.perShare:row.amount),max=Math.max(1,...values),recent=rows.slice(0,4),prior=rows.slice(4,8),valueOf=(row: Payment)=>usePerShare?row.perShare:row.amount,average=(list: Payment[])=>list.length?list.reduce((sum,row)=>sum+valueOf(row),0)/list.length:0,recentAvg=average(recent),priorAvg=average(prior),change=recent.length===4&&prior.length===4&&priorAvg>0?(recentAvg/priorAvg-1)*100:null,perShare=usePerShare;
    if(!rows.length)return '<p class="empty-inline">실제 입금이 쌓이면 지급 추세를 보여줍니다.</p>';
    const latest=valueOf(rows[0]),previous=rows[1]?valueOf(rows[1]):0,latestChange=previous>0?(latest/previous-1)*100:null;
    return `<div class="payment-trend-summary"><div><span>최근 지급</span><strong>${fmtMoney(latest,perShare?4:2)}${perShare?' / 주':''}</strong></div><div><span>직전 지급 대비</span><strong class="${latestChange===null?'':signClass(latestChange)}">${latestChange===null?'비교 전':`${latestChange>=0?'+':''}${fmtPct(latestChange)}`}</strong></div></div><div class="payment-spark" aria-label="날짜별 실제 지급액">${ordered.map((row,index)=>`<button type="button" ${row.ids?.[0]?`data-view-record="dividend:${esc(row.ids[0])}"`:''} aria-label="${esc(fmtDate(row.date))} ${esc(perShare?fmtMoney(values[index],4)+' 주당':fmtMoney(values[index],2))}"><b>${esc(fmtMoney(values[index],perShare?4:0))}</b><i style="height:${Math.max(12,values[index]/max*58)}px"></i><small>${esc(row.date.slice(5).replace('-','.'))}</small></button>`).join('')}</div><div class="trend-sentence"><strong>${recent.length===4?`최근 4회 평균 ${fmtMoney(recentAvg,perShare?4:2)}${perShare?' / 주':''}`:`최근 실제 지급 ${recent.length}회`}</strong><span class="${change===null?'':signClass(change)}">${change===null?'각 막대를 누르면 해당 입금 기록을 확인합니다.':`이전 4회 평균보다 ${change>=0?'증가':'감소'} ${fmtPct(Math.abs(change))}`}</span></div>${perShare?'':'<p class="detail-note">일부 기록에 지급 당시 주수가 없어 해당 회차는 실제 입금액으로 표시합니다.</p>'}`;
  }

  function annualDpsHTML(calc: ProjectCalculation){
    const analytics=calc.analytics,years=analytics.years.filter((row)=>row.known&&row.dps>0).slice(-6),max=Math.max(1,...years.map((row)=>row.dps));
    const growthRates=([[3,analytics.cagr3],[5,analytics.cagr5],[10,analytics.cagr10]] satisfies Array<[number,number|null]>).filter(([,value])=>value!==null&&value!==undefined&&Number.isFinite(value));
    return `<div class="strategy-metrics two"><div><span>최근 1년 배당률</span><strong>${analytics.trailingYoc===null?'기록 부족':fmtPct(analytics.trailingYoc)}</strong></div><div><span>입력 기록상 연속 증가</span><strong>${analytics.increaseStreak?analytics.increaseStreak+'년':'확인 전'}</strong></div></div>${years.length?`<div class="annual-chart-heading"><strong>연도별 주당 세후 배당금</strong><span>입력된 주당 세후 금액 · 연간 누락 여부 미확인</span></div><div class="annual-dps-chart" aria-label="연도별 실제 주당 세후 배당금">${years.map((row)=>`<div><small>${fmtMoney(row.dps,2)}</small><b style="height:${Math.max(10,row.dps/max*70)}px"></b><span>${row.year}년</span></div>`).join('')}</div>`:'<p class="empty-inline">완료된 연도 기록이 쌓이면 주당배당 성장을 보여줍니다.</p>'}${growthRates.length?`<div class="growth-rate-heading">입력 기록상 연평균 증가율</div><div class="growth-rate-row">${growthRates.map(([period,value])=>`<span><b>최근 ${period}년</b><strong>${n(value)>=0?'+':''}${fmtPct(value)}</strong></span>`).join('')}</div>`:''}${analytics.cutCount?`<p class="strategy-warning">기록상 배당 감소 ${analytics.cutCount}회</p>`:''}`;
  }

  function strategyInsightHTML(calc: ProjectCalculation){
    if(calc.project.category==='highYield')return `<div class="analysis-divider"><strong>${calc.income.payments.length&&calc.income.payments.every((row)=>row.known)?'주당 실제 지급액':'실제 입금액 추세'}</strong><span>최근 최대 8회</span></div>${paymentTrendHTML(calc)}<div class="strategy-metrics two easy-yield-metrics"><div><span>최근 1년 배당률</span><strong>${calc.analytics.trailingYoc===null?'기록 부족':fmtPct(calc.analytics.trailingYoc)}</strong></div><div><span>투입금 대비 누적 배당률</span><strong>${calc.hasKRWDividends?'달러 금액 미확인':fmtPct(calc.lifetimeDividendRecoveryPct)}</strong></div></div><details class="metric-guide"><summary>지표 뜻 보기</summary><p><b>1년 배당률</b> 최근 1년 주당 세후 배당을 현재 평균 원가와 비교합니다. ROC가 있으면 조정 원가를 사용합니다.</p><p><b>누적 배당률</b> 직접 넣은 투자금과 지금까지 실제 세후 배당의 비율입니다. 원금 회수율은 아닙니다.</p></details>`;
    if(calc.project.category==='growth')return `<div class="analysis-divider"><strong>주당배당 성장</strong><span>완료 연도 기준</span></div>${annualDpsHTML(calc)}<details class="metric-guide"><summary>계산 기준 보기</summary><p>분할을 보정한 실제 주당배당만 사용하며 진행 중인 연도는 성장률에서 제외합니다.</p></details>`;
    return `<div class="analysis-divider"><strong>배당 변화</strong><span>같은 기간 비교</span></div><div class="strategy-metrics two"><div><span>최근 1년 배당률</span><strong>${calc.analytics.trailingYoc===null?'기록 부족':fmtPct(calc.analytics.trailingYoc)}</strong></div><div><span>전년 같은 기간 대비</span><strong class="${calc.analytics.ytdChange===null?'':signClass(calc.analytics.ytdChange)}">${finitePct(calc.analytics.ytdChange)}</strong></div></div><details class="metric-guide"><summary>지표 뜻 보기</summary><p>최근 1년 주당 세후 배당을 현재 평균 원가와 비교합니다. ROC는 원가에 반영하며, 기록이 빠지면 배당률이 낮게 나올 수 있습니다. 올해 배당은 지난해 같은 기간과 비교합니다.</p></details>`;
  }

  function dividendManagementHTML(calc:ProjectCalculation){
    const p=calc.project,status=dividendPlanStatus(calc),rec=projectRecovery(calc),reached=!!calc.targetReachedDate||rec.locked;
    const destination={isa:'ISA',otherDividend:'다른 배당주',living:'생활비',other:'기타'};
    return `<div class="detail-title"><strong>${reached?'원금회수 현황':'배당 사용 · 원금회수'}</strong><span class="phase-pill">${status.mode==='reinvest'?p.symbol+' 재투자':'다른 곳에 사용'}</span></div>
      ${status.suggested?`<div class="dividend-plan-notice"><p>배당 제외 평가손익이 ${status.suggested==='outside'?'플러스':'마이너스'}예요. ${status.suggested==='outside'?'ISA·다른 배당주 활용':'재투자 재개'}로 바꿀까요?</p><button class="btn primary small" data-dividend-mode="${esc(p.id)}:${status.suggested}">${status.suggested==='outside'?'다른 곳에 사용':'재투자로 변경'}</button></div>`:''}
      <div class="recovery-hero"><span>${reached?'회수할 원금':'배당으로 회수한 금액'}</span><strong>${fmtMoney(reached?rec.remaining:rec.total,2)}</strong><small>${!rec.basisConfirmed?'회수 기준 확인 필요':rec.basis>0?fmtPct(rec.pct)+' 회수':'직접 투자금 기록 필요'} · ${rec.locked?'기존 확정 기준 유지':'직접 넣은 돈 기준'}${calc.unconfirmedFundingCount?' · 토스 매수 '+calc.unconfirmedFundingCount+'건 재투자 여부 확인 필요':''}</small></div>
      ${reached?progress(rec.pct):''}
      <div class="lifecycle-actions"><button class="btn primary small" data-add-withdrawal="${esc(p.id)}" ${calc.dividendBalanceConfirmed?'':'disabled'}>배당 사용 기록</button><button class="btn soft small" data-dividend-mode="${esc(p.id)}:${status.mode==='reinvest'?'outside':'reinvest'}">${status.mode==='reinvest'?'외부 사용으로 변경':'재투자로 변경'}</button></div>
      <p class="recovery-short-note">다른 곳에 사용한 배당만 회수에 포함해요. 재투자는 별도로 관리해요.</p><details class="dividend-use-details"><summary>사용 내역 · 계산 기준</summary><div class="goal-info-rows"><div><span>${rec.locked?'확정 회수 기준':rec.basisConfirmed?'직접 투자한 금액':'직접 투자금 (잠정)'}</span><strong>${fmtMoney(rec.basis,2)}</strong></div><div><span>받은 배당 합계 (USD)</span><strong>${fmtMoney(calc.usdDividendsTotal,2)}</strong></div><div><span>${esc(p.symbol)} 재투자 사용</span><strong>${fmtMoney(calc.reinvestAmount,2)}</strong></div><div><span>다른 곳에 사용한 배당</span><strong>${fmtMoney(rec.total,2)}</strong></div><div><span>사용 가능한 배당 (계좌 잔액과 다름)</span><strong>${calc.dividendBalanceConfirmed?fmtMoney(calc.spendableDividendBalance??0,2):'자금 구분 확인 필요'}</strong></div><div><span>회수할 원금</span><strong>${fmtMoney(rec.remaining,2)}</strong></div>${rec.profit>0?`<div><span>기준원금 초과 회수</span><strong>${fmtMoney(rec.profit,2)}</strong></div>`:''}<div><span>전환 판단용 평가손익</span><strong>${calc.priceAvailable?fmtSignedMoney(status.pnl):'현재가 필요'}</strong></div></div>
      <div class="recovery-calculation-note"><strong>회수 · 재투자 계산 기준</strong>      <p class="detail-note">배당·ROC 조정 전 매입원가와 달러 시세로 판단합니다. 손익이 0이면 방향을 유지합니다. ${status.fresh?'':'시세가 없거나 7일 이상 지나 전환 안내를 보류합니다.'} 방향 변경은 실제 거래나 과거 기록을 바꾸지 않습니다.</p>
      <p class="detail-note">${esc(p.symbol)} 밖에서 사용한 배당만 회수에 포함합니다. ISA·다른 종목·생활비 사용을 기록하며 전체 계좌의 출금액을 뜻하지 않습니다. 재투자는 회수가 아닙니다. ${rec.locked?'기존 확정 원금·시작일을 유지합니다.':'새로 넣은 돈은 직접 투자금에 더해집니다. 매도대금은 이 배당 회수율에서 제외합니다.'} 잔액 보정은 회수로 계산하지 않습니다.</p>
</div>
      ${calc.unconfirmedCapitalFundingCount?`<p class="detail-note funding-pending">비배당 매수 ${calc.unconfirmedCapitalFundingCount}건의 새 원금·재사용 자금 구분이 필요합니다. 회수 기준은 잠정값입니다.</p>`:''}
      ${calc.openingBalanceOverlap?`<p class="detail-note funding-pending">초기 잔액 날짜 이전의 거래가 있습니다. 중간 잔액을 전체 내역에 더하면 중복될 수 있습니다.</p><button class="btn soft small" data-exclude-opening-snapshot="${esc(p.id)}">중간 잔액 중복 확인</button>`:''}
      ${calc.cashTimingUnconfirmedDates.length?`<p class="detail-note funding-pending">같은 날 입금·출금 순서를 확인할 날짜: ${calc.cashTimingUnconfirmedDates.map(esc).join(', ')}. 입금·매수 기록에서 거래내역 시각을 입력하세요.</p>`:''}
      ${calc.cashDeficitEvents.length?'<p class="detail-note funding-pending">과거 출금 당시 배당 잔액이 부족한 기록이 있습니다. 이후 입금으로 가려지지 않도록 사용 가능 표시를 보류합니다.</p>':''}
      ${calc.reservedDividendShortfall>.000001?'<p class="detail-note funding-pending">결제 예정 재투자에 필요한 배당 잔액이 부족합니다. 기존 매수 자금 구분을 확인해 주세요.</p>':''}
      ${calc.reservedDividendAmount>0?`<p class="detail-note">결제 예정 재투자 ${fmtMoney(calc.reservedDividendAmount,2)}는 사용 가능액에서 예약 차감합니다.</p>`:''}
      ${calc.hasKRWDividends?'<p class="detail-note">원화 배당은 달러 사용 잔액에서 제외됩니다. 실제 달러 금액을 확인한 뒤 기록하세요.</p>':''}
      ${calc.unconfirmedFundingCount?`<p class="detail-note funding-pending">토스 매수 ${calc.unconfirmedFundingCount}건이 새로 넣은 돈인지 배당 재투자인지 아직 확인되지 않았습니다. 확인 전에는 직접 투자로 임시 계산하므로 투자금과 배당 사용액이 잠정값입니다.</p><button class="btn soft small" data-review-funding="${esc(p.id)}">매수 자금 출처 확인</button>`:''}
      ${rec.uses.length?`<div class="list">${[...rec.uses].reverse().slice(0,5).map(row=>`<button class="list-row record-row-button" data-view-record="cash:${esc(row.id)}"><div><div class="row-title">${row.destination?destination[row.destination]:'기존 배당 인출'}</div><div class="row-sub">${fmtDate(row.date)}</div></div><strong>${fmtMoney(-row.amountUSD,2)}</strong></button>`).join('')}</div>`:''}
      ${rec.locked?`<button class="btn soft small" data-edit-recovery="${esc(p.id)}">기존 회수 기준 확인 · 수정</button>`:''}
      ${p.dividendPlan?.history.length?`<p class="detail-note">최근 방향 변경: ${p.dividendPlan.history.slice(-3).map(row=>`${esc(row.confirmedAt.slice(0,10))} ${row.mode==='reinvest'?'재투자':'다른 곳에 사용'}`).join(' · ')}</p>`:''}</details>`;
  }

  function lifecycleContent(calc:ProjectCalculation){
    return calc.project.category==='highYield'?dividendManagementHTML(calc):'';
  }

  function periodKey(dateString: string,mode: string) {
    const date=new Date(`${dateString}T12:00:00`); if(Number.isNaN(date.getTime()))return '';
    if(mode==='year')return String(date.getFullYear());
    if(mode==='month')return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    const day=(date.getDay()+6)%7; date.setDate(date.getDate()-day);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function chartSeries(projectId: string|null =null) {
    const today=todayISO(),rows=reportingDividends((projectId?projectRows('dividends',projectId||''):state.dividends).filter((row)=>isDate(row.date)&&isPostedDividend(row,today)),n(state.settings.exchangeRate));
    if(getChartMode()==='month')return historicalIncome(rows,'month',effectiveChartYear(rows),today);
    if(getChartMode()==='year')return historicalIncome(rows,'year','',today);
    const grouped=new Map<string,number>(); rows.forEach((row)=>{const key=periodKey(row.date,getChartMode());if(key)grouped.set(key,(grouped.get(key)||0)+n(row.amountUSD));});
    const count=getChartMode()==='year'?10:6;
    return [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(-count).map(([key,value])=>({key,label:getChartMode()==='year'?key:getChartMode()==='month'?`${key.slice(2,4)}.${key.slice(5,7)}`:`${key.slice(2,4)}.${key.slice(5,7)}/${key.slice(8,10)}`,value}));
  }
  function effectiveChartYear(rows: DividendRecord[] =[]) {
    const chosen=String(getChartYear?.()||''); if(/^\d{4}$/.test(chosen))return chosen;
    return rows.map((row)=>String(row.date||'').slice(0,4)).filter((year)=>/^\d{4}$/.test(year)).sort().at(-1)||todayISO().slice(0,4);
  }
  function selectedChartRow(series: ChartRow[],mode: string,chartMonth ='') {
    const chosen=series.find((row)=>row.key===getChartSelection?.()); if(chosen)return chosen;
    if(mode==='month'){const current=todayISO().slice(0,7),exact=series.find((row)=>row.key===current&&row.value>0);return exact||[...series].reverse().find(row=>row.value>0)||series.at(-1);}
    if(mode==='monthWeeks'){if(chartMonth===todayISO().slice(0,7)){const day=+todayISO().slice(8),index=Math.min(4,Math.floor((day-1)/7));return series[index]||series.at(-1);}return [...series].reverse().find(row=>row.value>0)||series.at(-1);}
    return series.at(-1);
  }
  function chartHTML(projectId: string|null =null) {
    const chartMonth=getChartMonth?.()||todayISO().slice(0,7);
    const series=getChartMode()==='monthWeeks'?monthWeeks(reportingDividends(projectRows('dividends',projectId||'').filter((r)=>isPostedDividend(r,todayISO())),n(state.settings.exchangeRate)),chartMonth).map((r)=>({...r,key:r.range})):chartSeries(projectId), max=Math.max(1,...series.map((x)=>x.value));
    if(!series.length)return '<div class="empty">배당을 기록하면 그래프가 나타나요.</div>';
    const selectedKey=selectedChartRow(series,getChartMode(),chartMonth)?.key||'';
    const chartMoney=(value: number)=>{
      if(displayCurrency()==='KRW'){
        const krw=n(value)*n(state.settings.exchangeRate);
        if(Math.abs(krw)>=10000)return `${(krw/10000).toFixed(Math.abs(krw)>=100000?1:1)}만`;
        return `${Math.round(krw).toLocaleString('ko-KR')}원`;
      }
      return `$${n(value).toLocaleString('en-US',{minimumFractionDigits:value&&Math.abs(value)<1000?2:0,maximumFractionDigits:Math.abs(value)<1000?2:0})}`;
    };
    const modeClass=getChartMode()==='month'?'month-chart':getChartMode()==='year'?'year-chart wide-chart':'fit-chart';
    return `<div class="column-chart compact-chart ${modeClass}">${series.map((x)=>`<button class="column-item ${selectedKey===x.key?'active':''}" type="button" data-chart-key="${esc(x.key)}" aria-label="${esc(x.label)} 배당 ${esc(fmtMoney(x.value,2))}"><div class="column-value" title="${esc(fmtMoney(x.value,2))}">${esc(chartMoney(x.value))}</div><div class="column-track"><div class="column-fill" style="height:${x.value>0?Math.max(7,x.value/max*100):0}%"></div></div><div class="column-label">${esc(getChartMode()==='month'?`${+x.key.slice(5)}월`:getChartMode()==='week'?x.label.slice(3):x.label)}</div></button>`).join('')}</div>`;
  }
  function chartSelectionHTML(projectId: string) {
    const chartMonth=getChartMonth?.()||todayISO().slice(0,7),series=getChartMode()==='monthWeeks'?monthWeeks(reportingDividends(projectRows('dividends',projectId||'').filter((r)=>isPostedDividend(r,todayISO())),n(state.settings.exchangeRate)),chartMonth).map((r)=>({...r,key:r.range})):chartSeries(projectId);
    if(!series.length)return '';
    const mode=getChartMode(),selected=selectedChartRow(series,mode,chartMonth)! ,label=mode==='year'?`${selected.key}년`:mode==='month'?`${selected.key.replace('-','년 ')}월`:selected.label;
    const count=mode==='year'||mode==='month'?projectRows('dividends',projectId||'').filter((row)=>row.date<=todayISO()&&row.date.startsWith(selected.key)).length:null;
    return `<div class="chart-selection-inline"><div><span>${esc(label)} 실제 입금</span><strong>${fmtMoney(selected.value,2)}</strong>${count!==null?`<small>${count}회</small>`:''}</div>${mode==='month'&&count?`<button class="btn soft small" data-income-month="${esc(selected.key)}" data-income-project="${esc(projectId)}">입금 ${count}건 보기</button>`:''}</div>`;
  }
  function chartContextHTML(calc: ProjectCalculation) {
    const mode=getChartMode();
    if(mode==='month'){
      const year=effectiveChartYear(calc.postedDividends);
      return `<div class="chart-context-line year-stepper"><span>달력 월별 실제 입금</span><div><button type="button" data-chart-year-shift="-1" aria-label="이전 연도">‹</button><strong>${year}년</strong><button type="button" data-chart-year-shift="1" aria-label="다음 연도">›</button></div></div>`;
    }
    if(mode==='monthWeeks')return `<div class="chart-context-line month-stepper"><label for="chartMonth">주차를 볼 월</label><input id="chartMonth" class="input" type="month" value="${esc(getChartMonth?.()||todayISO().slice(0,7))}" data-chart-month></div>`;
    if(mode==='year')return '<div class="chart-context-line"><span>연도별 실제 입금</span><b>좌우로 밀어 확인</b></div>';
    return '<div class="chart-context-line"><span>최근 지급 회차</span><b>최근 6회</b></div>';
  }

  function cashflowChart(items: Array<{key:string;label:string;actual:number}>,selectedKey: string,mode: string) {
    const max=Math.max(1,...items.map((item)=>item.actual));
    return `<div class="cashflow-chart actual-only ${mode==='year'?'year-bars':''}" aria-label="${mode==='year'?'연도별':'월별'} 실제 배당">${items.map((item)=>`<button class="cashflow-month ${item.key===selectedKey?'active':''}" aria-pressed="${item.key===selectedKey}" type="button" data-cashflow-period="${esc(item.key)}" aria-label="${esc(item.label)} 실제 배당 ${esc(fmtMoney(item.actual,2))}"><div class="cashflow-bars"><i class="cashflow-actual" style="height:${item.actual>0?Math.max(5,item.actual/max*112):0}px"></i></div><span>${esc(mode==='year'?item.label:item.label.replace('월',''))}</span></button>`).join('')}</div>`;
  }
  function drawHome({cashflowOnly=false,selectionOnly=false}:{cashflowOnly?:boolean;selectionOnly?:boolean}={}) {
    const reportRows=reportingDividends(state.dividends.filter((row)=>isPostedDividend(row,todayISO())),n(state.settings.exchangeRate));
    const total=totals(),metrics=buildHomeMetrics(total.rows,reportRows),goal=metrics.nextGoal,paceChange=metrics.pace.change,currentMonth=todayISO().slice(0,7),mode=getHomeCashflowMode?.()||'month',yearRange=getHomeYearRange?.()||'6',yearCount=yearRange==='all'?metrics.years.length:Number(yearRange),series=mode==='year'?metrics.years.slice(-yearCount):metrics.months,defaultKey=mode==='year'?(series.at(-1)?.key||String(new Date().getFullYear())):currentMonth,selectedKey=series.some((item)=>item.key===getCashflowMonthKey?.())?getCashflowMonthKey():defaultKey,selected=series.find((item)=>item.key===selectedKey)||{key:selectedKey,label:selectedKey,actual:0,count:0};
    const dividendGoal=dividendGoalStatus(state.settings,metrics.month.actual,metrics.year.actual);
    const selectedRows=reportRows.filter((row)=>isDate(row.date)&&row.date<=todayISO()&&row.date.startsWith(selectedKey)),projectMap=new Map(activeProjects().map((project)=>[project.id,project])),symbolRows=[...selectedRows.reduce((map,row)=>{const project=projectMap.get(row.projectId),symbol=project?.symbol||'보관 종목',item=map.get(symbol)||{symbol,value:0,project};item.value+=n(row.amountUSD);map.set(symbol,item);return map;},new Map<string,Composition>()).values()].sort((a,b)=>b.value-a.value),topSymbols=symbolRows.slice(0,4),other=symbolRows.slice(4).reduce((sum,row)=>sum+row.value,0),composition=other?[...topSymbols,{symbol:'기타',value:other,project:null}]:topSymbols,compositionTotal=Math.max(1,composition.reduce((sum,row)=>sum+row.value,0)),compositionColor=(row: Composition,index: number)=>row.project?projectColors(row.project)[0]:`hsl(${225+index*24} 18% ${55-index*3}%)`;
    const html=`${sectionTitle('홈','세후 배당')}
      <div class="stack home-flow home-redesign">
        <article class="card month-overview">
          <div class="overview-heading"><h3>이번 달 받은 배당</h3><span>${new Date().getMonth()+1}월</span></div>
          <div class="hero-label">세후 입금</div>${state.dividends.some((row)=>row.currency==="KRW")?'<p class="tiny muted">원화 확인액 보존 · 달러 표시는 현재 환율 참고값</p>':''}
          <div class="hero-amount">${fmtMoney(metrics.month.actual,2)}</div>
          <div class="monthly-dividend-goal"><span>월 배당 목표 ${dividendGoal.target>0?fmtMoney(dividendGoal.target,2):'목표 미설정'}</span>${dividendGoal.monthPct!==null?`${progress(dividendGoal.monthPct)}<strong>이번 달 ${fmtPct(dividendGoal.monthPct)} 달성 · ${dividendGoal.monthRemaining>0?fmtMoney(dividendGoal.monthRemaining,2)+' 남음':'목표 달성'}</strong>`:''}<small>세후 입금 기준</small></div>
          <div class="month-parts"><div><span>입금 횟수</span><strong>${metrics.month.count}회</strong></div><div><span>지난달 대비</span><strong class="${metrics.month.change===null?'':signClass(metrics.month.change)}">${metrics.month.change===null?'비교 전':fmtPct(metrics.month.change)}</strong></div></div>
        </article>
        <article class="card home-stocks"><div class="overview-heading"><h3>내 종목</h3><button class="text-link" data-home-portfolio>전체 보기 ›</button></div><div class="list">${total.rows.slice(0,3).map(row=>`<button class="list-row home-stock-row" data-project-detail="${esc(row.project.id)}" style="--project-a:${projectColors(row.project)[0]}"><span class="stock-avatar">${esc(row.project.symbol.slice(0,1))}</span><div><div class="row-title">${esc(row.project.symbol)}</div><div class="row-sub">${fmtShares(row.shares)}주 · ${esc(categoryLabel(row.project.category))}</div></div><div class="record-value"><strong>${fmtMoney(row.currentMonthDividends,2)}</strong><span class="row-sub">이번 달 배당 ›</span></div></button>`).join('')||'<div class="empty">종목을 추가해 배당을 관리하세요.</div>'}</div></article>
        <article class="card home-recent"><div class="overview-heading"><h3>최근 입금</h3><button class="text-link" data-income-month="${currentMonth}">이번 달 내역 ›</button></div><div class="list">${[...reportRows].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,1).map(row=>`<button class="list-row" data-view-record="dividend:${esc(row.id)}"><div><div class="row-title">${esc(projectMap.get(row.projectId)?.symbol||'보관 종목')} 배당</div><div class="row-sub">${fmtDate(row.date)} · 세후</div></div><strong>${fmtMoney(row.amountUSD,2)}</strong></button>`).join('')||'<div class="empty-inline">입금 기록이 아직 없어요.</div>'}</div></article>
        <article class="card cashflow-card history-overview">
          <div class="overview-heading"><h3>배당 현금흐름</h3><div class="cashflow-mode"><button class="${mode==='month'?'active':''}" data-home-cashflow-mode="month">월별</button><button class="${mode==='year'?'active':''}" data-home-cashflow-mode="year">연도별</button></div></div>
          <p class="chart-instruction">막대를 눌러 입금 내역을 확인하세요.</p>
          ${mode==='year'?`<div class="year-range-switch" aria-label="연도 표시 범위">${[['6','최근 6년'],['10','10년'],['all','전체']].map(([value,label])=>`<button class="${yearRange===value?'active':''}" data-home-year-range="${value}">${label}</button>`).join('')}</div>`:''}
          <div class="cashflow-picked" aria-live="polite" aria-atomic="true"><span>${mode==='year'?`${selectedKey}년`:`${selectedKey.replace('-','년 ')}월`} · ${selectedRows.length}회 입금</span><strong>${fmtMoney(selected.actual,2)}</strong></div>
          ${cashflowChart(series,selectedKey,mode)}
          ${mode==='year'&&yearRange==='all'&&metrics.years.length>10?`<div class="five-year-summary">${Array.from({length:Math.ceil(metrics.years.length/5)},(_,index)=>metrics.years.slice(index*5,index*5+5)).map(group=>`<div><span>${group[0].key}–${group.at(-1)?.key}</span><strong>${fmtMoney(group.reduce((sum,row)=>sum+row.actual,0),0)}</strong></div>`).join('')}</div>`:''}
          <details class="home-cashflow-details"><summary><span>연간 배당 · 상세 분석</span><strong>${fmtMoney(metrics.year.actual,2)}</strong><b>⌄</b></summary><div class="cashflow-detail-body"><div class="cashflow-selection"><div><span>${mode==='year'?`${selectedKey}년`:`${selectedKey.replace('-','년 ')}월`}</span><strong>${fmtMoney(selected.actual,2)}</strong><small>${selectedRows.length}회 입금</small></div>${composition.length>1?`<div class="composition-bar" aria-label="종목별 실제 배당 비중">${composition.map((row,index)=>`<i style="width:${row.value/compositionTotal*100}%;--segment:${compositionColor(row,index)}" title="${esc(row.symbol)} ${esc(fmtMoney(row.value,2))}"></i>`).join('')}</div><div class="composition-legend">${composition.map((row,index)=>`<span><i style="--dot:${compositionColor(row,index)}"></i>${esc(row.symbol)} <b>${fmtMoney(row.value,0)}</b></span>`).join('')}</div>`:'<p class="single-symbol-note">'+(composition[0]?`${esc(composition[0].symbol)}에서 받은 실제 배당입니다.`:'아직 받은 배당이 없어요.')+'</p>'}</div>
          ${mode==='month'?`<button class="card-link" data-income-month="${selectedKey}"><span>입금 내역 보기</span><b>›</b></button>`:''}
          <div class="cashflow-year-summary">
            <div><span>올해 받은 배당</span><strong>${fmtMoney(metrics.year.actual,2)}</strong></div>
            <div><span>지난해 총 배당</span><strong>${fmtMoney(metrics.year.previous,2)}</strong></div>
          </div>
          ${dividendGoal.alert==='early'||dividendGoal.alert==='reached'?'':annualAlertHTML(metrics.year.actual)}
          <div class="cashflow-pace-summary"><div><span>최근 3개월 월평균</span><strong>${metrics.pace.available?fmtMoney(metrics.pace.monthly,2):'기록 부족'}</strong></div><div><span class="${paceChange===null?'':signClass(paceChange)}">${paceChange===null?'비교 전':fmtPct(paceChange)}</span><small>직전 3개월 대비</small></div></div>
          </div></details>${dividendGoal.alert==='early'||dividendGoal.alert==='reached'?annualAlertHTML(metrics.year.actual):''}
        </article>
        <article class="card compact next-card ${goal?'interactive-card':''}" ${goal?`data-goal-detail="${goal.calc.project.id}" tabindex="0" role="button"`:''}><div class="card-kicker">다음 목표</div>${goal?`<div class="next-line"><div><strong>${esc(goal.calc.project.symbol)} · ${goal.milestone.reached?'목표 달성':`${fmtShares(goal.milestone.shares)}주`}</strong><span>현재 ${fmtShares(goal.calc.shares)}주${goal.milestone.reached?' · 현금흐름 단계':` · ${fmtShares(goal.milestone.remaining)}주 남음`}</span></div><b>›</b></div>`:'<div class="empty-inline">종목을 추가해 목표를 시작하세요.</div>'}</article>
      </div>`;
    const page=document.getElementById('page-home')!,current=page.querySelector?.<HTMLElement>('.cashflow-card');
    if(cashflowOnly&&current&&document.createElement){
      const template=document.createElement('template');template.innerHTML=html;
      const next=template.content.querySelector<HTMLElement>('.cashflow-card')!;
      if(selectionOnly){
        current.querySelectorAll<HTMLElement>('[data-cashflow-period]').forEach(button=>{const selected=button.dataset.cashflowPeriod===selectedKey;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
        for(const selector of ['.cashflow-picked','.cashflow-selection']){
          const target=current.querySelector(selector),source=next.querySelector(selector);if(target&&source)target.replaceChildren(...source.childNodes);
        }
        const link=current.querySelector<HTMLElement>('[data-income-month]');if(link)link.dataset.incomeMonth=selectedKey;
      }else current.replaceChildren(...next.childNodes);
    }else page.innerHTML=html;
    // Move only the horizontal rail; scrollIntoView also moves the whole page.
    if(mode==='year'&&!selectionOnly&&typeof requestAnimationFrame==='function')requestAnimationFrame(()=>{
      const rail=page.querySelector<HTMLElement>('.cashflow-chart'),selected=rail?.querySelector<HTMLElement>('.cashflow-month.active');
      if(rail&&selected)rail.scrollLeft+=selected.getBoundingClientRect().left-rail.getBoundingClientRect().left-(rail.clientWidth-selected.clientWidth)/2;
    });
  }
  function combinedRecords(calc: ProjectCalculation) {
    return [
      ...calc.trades.map((row)=>({...row,kind:'trade' as const})),
      ...calc.dividends.map((row)=>({...row,kind:'dividend' as const})),
      ...projectRows('splits',calc.project.id).map((row)=>({...row,kind:'split' as const})),
      ...calc.adjustments.map((row)=>({...row,kind:'cash' as const}))
    ].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt||b.id).localeCompare(String(a.createdAt||a.id)));
  }
  function recordRow(row: ReturnType<typeof combinedRecords>[number]) {
    let title='',sub='',value='',cls='';const future=String(row.date)>todayISO();
    if(row.kind==='trade'){title=row.type==='buy'&&row.dividendFunding&&row.dividendFunding.sourceFingerprint===row.source?.sourceFingerprint?(row.dividendFunding.amountUSD>0?'매수 · 배당 사용 '+fmtMoney(row.dividendFunding.amountUSD,2):'매수 · 직접 투자'):row.type==='sell'?'매도':row.buyType==='reinvest'?'배당재투자':row.buyType==='mixed'?'혼합매수':row.buyType==='opening'?'초기보유':'직접매수';sub=`${fmtDate(row.date)} · ${fmtShares(row.shares)}주 · 단가 ${fmtMoney(row.price)}${row.source?.provider==='toss'?' · 토스 승인':''}`;value=`${row.type==='sell'?'+':'-'}${fmtMoney(n(row.shares)*n(row.price))}`;cls=row.type==='sell'?'positive':'';}
    if(row.kind==='dividend'){const perShare=row.currency!=='KRW'&&n(row.sharesAtPayment)>0?n(row.amountUSD)/n(row.sharesAtPayment):0;title='세후배당'+(row.rocPercent!==null&&row.rocPercent!==undefined?` · ROC ${n(row.rocPercent)}% (${row.rocStatus==='final'?'확정':'추정'})`:'');sub=`${fmtDate(row.date)}${perShare?` · 주당 ${fmtMoney(perShare,4)}`:''}${row.note?` · ${esc(row.note)}`:''}`;value=`+${fmtDividend?fmtDividend(row):fmtMoney(row.amountUSD)}`;cls='positive';}
    if(row.kind==='split'){title=row.type==='reverse'?'역분할':'주식분할';sub=`${fmtDate(row.date)} · ${row.from}:${row.to}`;value='비율 반영';}
    if(row.kind==='cash'){const withdrawal=row.purpose==='recoveryWithdrawal'||row.purpose==='dividendUse';title=withdrawal?esc(row.label||'배당금 인출'):esc(row.label||'배당 잔액 보정');sub=`${fmtDate(row.date)}${withdrawal?' · 원금회수 반영':''}`;value=withdrawal?`-${fmtMoney(Math.abs(n(row.amountUSD)))}`:fmtSignedMoney(row.amountUSD);cls=withdrawal?'':n(row.amountUSD)>=0?'positive':'negative';}
    if(future)sub+=`${sub?' · ':''}미래 기록 · 현재 계산 제외`;
    return `<button type="button" class="list-row record-row-button" data-view-record="${row.kind}:${row.id}" aria-label="${esc(title)} 기록 상세"><div><div class="row-title">${title}</div><div class="row-sub">${sub}</div></div><div class="record-value"><div class="row-value ${cls}">${value}</div><span class="record-chevron">상세 ›</span></div></button>`;
  }

  function portfolioValuationHTML(calc:ProjectCalculation,detail=false):string {
    const p=calc.project,colors=projectColors(p);
    const fit=(text:string)=>`${(145/(text.length+1)).toFixed(2)}cqi`;
    const average=fmtMoney(calc.shares>0?calc.purchaseBasis/calc.shares:0),shareText=fmtShares(calc.shares)+'주';
    return `        <article class="card portfolio-summary" style="--project-a:${colors[0]};--project-b:${colors[1]}">
          <div class="portfolio-heading"><div>${detail?`<div class="project-symbol">${esc(p.symbol)}</div>`:`<button class="project-symbol project-symbol-link" data-project-detail="${esc(p.id)}" aria-label="${esc(p.symbol)} 상세 보기">${esc(p.symbol)} <span>›</span></button>`}<div class="project-name">${esc(p.name)}</div><div class="project-tags"><span class="strategy-tag">${esc(categoryLabel(p.category))}</span></div></div>${detail?'':`<button class="btn soft small project-settings-shortcut" data-project-settings aria-label="${esc(p.symbol)} 종목 설정">설정</button>`}</div>
          ${!calc.priceAvailable?'<p class="price-missing-note">현재가를 입력하면 평가금액과 손익을 확인할 수 있어요.</p>':''}<div class="value-line${fmtMoney(calc.marketValue).length>13||fmtSignedMoney(calc.priceUnrealized).length>13?' valuation-wide':''}"><div class="valuation-primary"><div class="value-caption"><span>평가금액</span><small>${calc.priceAvailable?detail?`${p.priceSource==='toss'?'토스':'입력 시세'} · ${esc(shortQuoteTime(p.priceUpdatedAt))}`:p.priceSource==='toss'?'토스 시세':'입력 시세':'현재가 미입력'}</small></div><strong class="fit-market" style="--money-fit:${fit(calc.priceAvailable?fmtMoney(calc.marketValue):'—')}">${calc.priceAvailable?fmtMoney(calc.marketValue):'—'}</strong></div><div class="current-pnl ${calc.priceAvailable?signClass(calc.priceUnrealized):''}" data-current-pnl><span>평가손익 · 배당 제외</span><strong><span class="pnl-amount" style="--money-fit:${fit(calc.priceAvailable?fmtSignedMoney(calc.priceUnrealized):'시세 미확인')}">${calc.priceAvailable?fmtSignedMoney(calc.priceUnrealized):'시세 미확인'}</span>${calc.priceAvailable&&calc.purchaseBasis>0?'<span class="pnl-rate">'+fmtPct(calc.priceUnrealized/calc.purchaseBasis*100)+'</span>':''}</strong></div><small class="${calc.totalReturn!==null?signClass(calc.totalReturn):''}">${calc.totalReturn!==null?`<span>배당 포함 손익</span> <span class="total-return-value"><b class="fit-total" style="--money-fit:${fit(fmtSignedMoney(calc.totalReturn))}">${fmtSignedMoney(calc.totalReturn)}</b></span>`:calc.hasKRWDividends?'달러 배당액 확인 필요':'현재가를 입력하면 손익이 표시돼요.'}</small></div>
          <div class="holding-row${average.length>10||shareText.length>10?' holdings-wide':''}"><div><span>보유 수량</span><strong class="fit-holding" style="--money-fit:${fit(shareText)}">${shareText}</strong></div><div><span>평균 매수가</span><strong class="fit-holding" style="--money-fit:${fit(average)}">${average}</strong></div></div>
${detail?`          <details class="performance-breakdown" open><summary>배당까지 합친 손익 <b>⌄</b></summary><details class="calculation-guide"><summary>손익 · ROC 계산 기준</summary><p class="detail-note">현재 평가손익은 배당 제외 · ROC 조정 전 매입원가 기준입니다. 합산 손익에는 매도 실현손익과 실제 세후배당이 포함됩니다. ROC 조정 손익은 별도 회계 기준입니다.</p></details><div class="performance-rows"><div><span>평가손익 · 배당 제외</span><strong class="${calc.priceAvailable?signClass(calc.priceUnrealized):''}" style="--detail-fit:${fit(pricedMoney(calc,calc.priceUnrealized))}">${pricedMoney(calc,calc.priceUnrealized)}</strong></div><div><span>실현손익 · 매입 기준</span><strong class="${signClass(calc.totalSellCashIn-(calc.totalBuyCashOut-calc.purchaseBasis))}" style="--detail-fit:${fit(fmtSignedMoney(calc.totalSellCashIn-(calc.totalBuyCashOut-calc.purchaseBasis)))}">${fmtSignedMoney(calc.totalSellCashIn-(calc.totalBuyCashOut-calc.purchaseBasis))}</strong></div><div><span>누적 세후 배당</span><strong class="positive" style="--detail-fit:${fit(fmtMoney(calc.dividendsTotal))}">${fmtMoney(calc.dividendsTotal)}</strong></div>${calc.totalReturn!==null?`<div class="performance-total"><span>합산 손익</span><strong class="${signClass(calc.totalReturn)}" style="--detail-fit:${fit(fmtSignedMoney(calc.totalReturn))}">${fmtSignedMoney(calc.totalReturn)}</strong></div>`:''}${calc.rocBasisReduction>0?`<div><span>ROC 조정 평균 원가</span><strong style="--detail-fit:${fit(fmtMoney(calc.avgCost))}">${fmtMoney(calc.avgCost)}</strong></div><div><span>ROC 조정 평가손익</span><strong class="${calc.priceAvailable?signClass(calc.unrealized):''}" style="--detail-fit:${fit(pricedMoney(calc,calc.unrealized))}">${pricedMoney(calc,calc.unrealized)}</strong></div>`:''}</div></details>
`:''}</article>`;
  }
  function portfolioMonthChartHTML(calc:ProjectCalculation,selectedMonth:string):string {
    const month=todayISO().slice(0,7),year=Number(month.slice(0,4)),last=Number(month.slice(5)),dividends=reportingDividends(calc.postedDividends,n(state.settings.exchangeRate)),series=Array.from({length:6},(_,index)=>{const date=new Date(Date.UTC(year,last-6+index,1)),key=date.toISOString().slice(0,7);return {key,value:dividends.filter(row=>row.date.startsWith(key)).reduce((sum,row)=>sum+n(row.amountUSD),0)};}),max=Math.max(1,...series.map(row=>row.value));
    return `<div class="summary-chart-period">최근 6개월 · ${series[0].key.slice(0,4)===series[5].key.slice(0,4)?series[5].key.slice(0,4):series[0].key.slice(0,4)+'–'+series[5].key.slice(0,4)}년</div><div class="summary-month-chart" aria-label="최근 월별 실제 세후 배당">${series.map(row=>`<button type="button" data-portfolio-income-month="${esc(row.key)}" data-income-month="${esc(row.key)}" data-income-project="${esc(calc.project.id)}" aria-pressed="${row.key===selectedMonth}" aria-label="${esc(row.key)} 실제 배당 ${esc(fmtMoney(row.value,2))}"><div class="summary-bar-track"><i style="height:${row.value>0?Math.max(6,row.value/max*100):0}%"></i></div><span>${Number(row.key.slice(5))}월</span></button>`).join('')}</div>`;
  }

  function drawProjects() {
    const allProjects=activeProjects(),group=getPortfolioGroup?.()==='dividend'?'dividend':'highYield',projects=allProjects.filter((project)=>projectGroup(project)===group),counts={highYield:allProjects.filter((project)=>projectGroup(project)==='highYield').length,dividend:allProjects.filter((project)=>projectGroup(project)==='dividend').length}; let selectedProjectId=getSelectedProjectId();
    if(!selectedProjectId||!projects.some((project)=>project.id===selectedProjectId)){selectedProjectId=projects[0]?.id||'';setSelectedProjectId(selectedProjectId);}
    const calc=projects.length?computeProject(selectedProjectId):null, page=document.getElementById('page-projects'),groupTabs=`<div class="portfolio-group-tabs" aria-label="포트폴리오 분류"><button type="button" data-portfolio-group="highYield" class="${group==='highYield'?'active':''}"><span>고배당주</span><b>${counts.highYield}</b></button><button type="button" data-portfolio-group="dividend" class="${group==='dividend'?'active':''}"><span>배당주</span><b>${counts.dividend}</b></button></div>`;
    if(!page)return;
    if(!allProjects.length){page.innerHTML=`${sectionTitle('포트폴리오')}<article class="card empty-project"><p>아직 등록된 종목이 없습니다.</p><button class="btn primary" data-add-project>종목 추가</button></article>`;return;}
    if(!calc){page.innerHTML=`<div class="section-title-row"><h2 class="section-title">포트폴리오</h2><button class="btn soft small" data-add-project>＋ 종목</button></div>${groupTabs}<article class="card empty-project"><p>${group==='highYield'?'고배당주':'배당주'}로 묶인 종목이 없습니다.</p><button class="btn primary" data-add-project>종목 추가</button></article>`;return;}
    if(!calc)return;
    const p=calc.project,colors=projectColors(p),rec=recoveryStats(calc);
    const milestone=nextMilestone(calc);
    const detailTab=['summary','dividend','recovery','records'].includes(getPortfolioDetailTab?.()||'')?getPortfolioDetailTab!():'summary';
    const projectPicker=projects.length===1?'':projects.length>4?`<label class="project-select-label">종목 선택<select class="input" data-project-select>${projects.map(x=>`<option value="${esc(x.id)}" ${x.id===p.id?'selected':''}>${esc(x.symbol)}</option>`).join('')}</select></label>`:`<div class="project-tabs">${projects.map(x=>`<button class="project-tab ${x.id===p.id?'active':''}" data-select-project="${esc(x.id)}">${esc(x.symbol)}</button>`).join('')}</div>`;
    if(!getPortfolioDetail?.()){
      const currentMonth=todayISO().slice(0,7),requestedMonth=getPortfolioIncomeMonth?.(p.id)||'',selectedMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)?requestedMonth:currentMonth;
      const selectedIncome=reportingDividends(calc.postedDividends,n(state.settings.exchangeRate)).filter(row=>row.date.startsWith(selectedMonth)).reduce((sum,row)=>sum+n(row.amountUSD),0),incomeText=fmtMoney(selectedIncome,2),incomeFit=`${(145/(incomeText.length+1)).toFixed(2)}cqi`;
      const plan=dividendPlanStatus(calc),status=p.category==='highYield'?(plan.mode==='reinvest'?'재투자 중':'다른 곳에 사용 중'):categoryLabel(p.category);
      page.innerHTML=`<div class="section-title-row"><h2 class="section-title">포트폴리오</h2><button class="btn soft small" data-add-project>＋ 종목</button></div>${groupTabs}${projectPicker}<div class="stack portfolio-stack portfolio-overview" style="--project-a:${colors[0]};--project-b:${colors[1]}">
        ${portfolioValuationHTML(calc)}
        <button class="portfolio-status-strip" data-goal-detail="${esc(p.id)}"><span class="phase-pill">${esc(status)}</span><span>${rec.stage!=='accumulating'?'달성 · 원금회수 관리':'다음 목표 '+fmtShares(milestone.shares)+'주'} <b>›</b></span></button>
        <article class="card portfolio-month-summary"><div class="overview-heading"><h3>${selectedMonth===currentMonth?'이번 달 받은 배당':selectedMonth.replace('-','년 ')+'월 받은 배당'}</h3><span class="tiny muted">누적 ${fmtMoney(calc.dividendsTotal,2)}</span></div><div class="portfolio-income-hero" aria-live="polite"><strong class="fit-income" style="--money-fit:${incomeFit}">${incomeText}</strong><span>세후 입금</span><button class="text-link summary-income-records" data-income-month="${esc(selectedMonth)}" data-income-project="${esc(p.id)}">입금 내역 ›</button></div>${portfolioMonthChartHTML(calc,selectedMonth)}</article>
        <button class="btn soft portfolio-detail-link" data-project-detail="${esc(p.id)}">종목 상세 보기 <b>›</b>${plan.suggested?' <span class="detail-attention">운용 확인</span>':''}</button>
      </div>`;return;
    }
    const allRows=combinedRecords(calc),filter=getHistoryFilter?.()||{},rows=selectRecords(allRows,filter),historyLimit=getHistoryLimit?.()||10;
    page.innerHTML=`
      <div class="section-title-row project-detail-heading"><button class="btn soft small" data-portfolio-overview aria-label="포트폴리오 요약으로 돌아가기">‹</button><h2 class="section-title">${esc(p.symbol)}</h2><button class="text-link" data-project-settings aria-label="${esc(p.symbol)} 종목 설정">관리</button></div>
      ${projectPicker}
      <div class="stack portfolio-stack" style="--project-a:${colors[0]};--project-b:${colors[1]}">
        <div class="project-detail-tabs" role="tablist" aria-label="종목 상세"><button role="tab" id="detail-tab-summary" aria-controls="detail-panel-summary" data-project-detail-tab="summary" aria-selected="${detailTab==='summary'}">요약</button><button role="tab" id="detail-tab-dividend" aria-controls="detail-panel-dividend" data-project-detail-tab="dividend" aria-selected="${detailTab==='dividend'}">배당</button><button role="tab" id="detail-tab-recovery" aria-controls="detail-panel-recovery" data-project-detail-tab="recovery" aria-selected="${detailTab==='recovery'}">${p.category==='highYield'?'회수':'운용'}</button><button role="tab" id="detail-tab-records" aria-controls="detail-panel-records" data-project-detail-tab="records" aria-selected="${detailTab==='records'}">기록</button></div>
        <section id="detail-panel-summary" class="detail-panel stack" role="tabpanel" aria-labelledby="detail-tab-summary" ${detailTab==='summary'?'':'hidden'}>${portfolioValuationHTML(calc,true)}<button class="btn soft summary-price-action" data-summary-price>${calc.priceAvailable?'현재가 갱신':'현재가 입력'}</button></section>
        <section id="detail-panel-dividend" class="detail-panel stack" role="tabpanel" aria-labelledby="detail-tab-dividend" ${detailTab==='dividend'?'':'hidden'}>
        <article class="card portfolio-cashflow compact-income dividend-analysis-card">
          <div class="overview-heading"><h3>배당 분석</h3><button class="text-link" data-quick-dividend>＋ 입금 기록</button><span>${calc.income.spec.label}${calc.income.spec.automatic?' · 자동':''} · 세후</span></div>
          <div class="portfolio-income-hero"><span>이번 달 받은 배당</span><strong>${fmtMoney(calc.currentMonthDividends,2)}</strong></div>
          <div class="cashflow-secondary"><div><span>누적 세후배당</span><strong>${fmtMoney(calc.dividendsTotal,2)}</strong></div><div><span>최근 1년 받은 배당</span><strong>${fmtMoney(calc.analytics.trailingNet,2)}</strong></div>${calc.hasKRWDividends?'<div><span>달러 배당 잔액</span><strong>달러 금액 미확인</strong></div>':Math.abs(calc.dividendAvailable-calc.dividendsTotal)>.01?`<div><span>남은 배당금</span><strong>${calc.dividendBalanceConfirmed?fmtMoney(calc.spendableDividendBalance??0,2):'자금 구분 확인 필요'}</strong></div>`:calc.reinvestAmount>0?`<div><span>재투자 사용</span><strong>${fmtMoney(calc.reinvestAmount,2)}</strong></div>`:''}</div>
          <p class="detail-note">입력된 기록 ${calc.postedDividends.length}건${calc.postedDividends.length?` · ${esc(calc.postedDividends[0].date)}부터`:""} · 누락 여부 미확인${calc.hasKRWDividends?" · 원화 원본 보존, 달러 표시는 현재 환율 참고값":""}</p><details class="analysis-details"><summary>배당률 · 지급 추세 자세히 보기</summary>${strategyInsightHTML(calc).replace(/<details class="metric-guide"><summary>([^<]+)<\/summary>/g,'<div class="metric-guide"><strong>$1</strong>').replace(/<\/details>/g,'</div>')}</details>
        </article>
        <article class="card portfolio-section portfolio-flow-card"><div class="detail-title"><strong>실제 입금 흐름</strong><div class="chart-period">${[['week','주'],['month','월'],['year','년'],['monthWeeks','주차']].map(([mode,label])=>`<button type="button" data-chart-mode="${mode}" class="${getChartMode()===mode?'active':''}">${label}</button>`).join('')}</div></div><div class="portfolio-chart-stage">${chartContextHTML(calc)}<div id="projectChart">${chartHTML(p.id)}</div>${chartSelectionHTML(p.id)}</div></article>
        <article class="card compact"><div class="detail-title"><strong>공시 배당 일정</strong><button class="text-link" data-dividend-schedule="${p.id}">직접 기록</button></div>${officialScheduleHTML(p)}</article>
        </section>
        <section id="detail-panel-recovery" class="detail-panel stack" role="tabpanel" aria-labelledby="detail-tab-recovery" ${detailTab==='recovery'?'':'hidden'}>
        ${p.category==='highYield'?`<article class="card dividend-management">${dividendManagementHTML(calc)}</article>`:''}
        ${p.category!=='highYield'?`<article class="card"><div class="detail-title"><strong>배당 운용</strong></div>${strategyInsightHTML(calc)}</article>`:''}</section>
        <section id="detail-panel-records" class="detail-panel stack" role="tabpanel" aria-labelledby="detail-tab-records" ${detailTab==='records'?'':'hidden'}>
        <article class="card record-center">
          <div class="detail-title"><strong>기록 ${rows.length}건</strong><button class="text-link" data-record-add>＋ 기록 추가</button></div>
          <div class="transaction-body"><form id="historyFilterForm" class="history-filter compact-record-filter"><label><span class="filter-caption">기간</span><input class="input" type="month" name="month" aria-label="기록 기간" value="${esc(filter.month||'')}"></label><label><span class="filter-caption">유형</span><select class="input" name="kind" aria-label="기록 유형">${[['','전체'],['trade','거래'],['dividend','배당'],['split','분할'],['cash','인출·잔액']].map(([value,label])=>`<option value="${value}" ${filter.kind===value?'selected':''}>${label}</option>`).join('')}</select></label><details class="history-search" ${filter.query?'open':''}><summary>검색</summary><div class="history-query"><label><span class="filter-caption">날짜 · 메모 · 금액</span><input class="input" type="search" name="query" aria-label="기록 검색" value="${esc(filter.query||'')}" placeholder="날짜 · 메모 · 금액 검색"></label><button class="btn soft" type="submit">검색</button></div></details>${filter.month||filter.kind||filter.query?'<button class="text-link filter-reset" type="button" data-history-reset>필터 초기화</button>':''}</form>${filter.month||filter.kind||filter.query?`<p class="tiny muted">전체 ${allRows.length}건 중 ${rows.length}건</p>`:''}<div class="list records-list">${rows.slice(0,historyLimit).map(recordRow).join('')||'<div class="empty">조건에 맞는 기록이 없습니다.</div>'}</div>${rows.length>historyLimit?`<button class="btn soft history-more" data-history-more>이전 기록 10건 더 보기 (${rows.length-historyLimit}건 남음)</button>`:''}<details class="manual-tools embedded-tools"><summary><div><strong>시세 · 잔액 보정</strong><span>현재가 수정 · 잔액 보정 · 장부 점검</span></div><b class="chev">⌄</b></summary><div class="manual-tools-body"><div class="support-actions"><button class="btn soft small" data-edit-price>현재가</button><button class="btn soft small" data-add-cash>잔액 보정</button><button class="btn soft small" data-project-check>점검</button></div></div></details></div>
        </article></section>
      </div>`;
  }

  function estimatedDate(calc: ProjectCalculation,targetShares =calc.currentTarget) {
    const plan=Math.max(0,n(calc.project.monthlyPlanShares)), remaining=Math.max(0,targetShares-calc.shares);
    if(remaining<=0)return '달성 완료'; if(plan<=0)return '월 매수계획 필요';
    const now=new Date(),date=new Date(now.getFullYear(),now.getMonth()+Math.ceil(remaining/plan),1);
    return `${date.getFullYear()}년 ${date.getMonth()+1}월 예상`;
  }
  function goalMilestonesHTML(calc:ProjectCalculation):string {
    return `<div class="goal-milestones" aria-label="주수 목표 달성 기록">${([25,50,75,100] as const).map(level=>`<div class="${calc.milestoneDates[level]?'achieved':''}"><strong>${fmtShares(calc.currentTarget*level/100)}주</strong><span>${calc.milestoneDates[level]?fmtDate(calc.milestoneDates[level]):'미달성'}</span></div>`).join('')}</div>`;
  }
  function drawGoals() {
    const rows=totals().rows;
    document.getElementById('page-goal')!.innerHTML=`${sectionTitle('다음 목표','가장 가까운 단계만')}
      <div class="stack">${rows.map((calc: ProjectCalculation)=>{const p=calc.project,colors=projectColors(p),milestone=nextMilestone(calc),rec=p.category==='highYield'&&!p.recovery.locked&&calc.targetReachedDate?{...recoveryStats(calc),...projectRecovery(calc),stage:projectRecovery(calc).basis>0&&projectRecovery(calc).pct>=100?'profit':'recovery'}:recoveryStats(calc),lifecycle=p.category==='highYield'&&rec.stage!=='accumulating',goalPct=milestone.reached?100:(calc.shares/Math.max(1,milestone.shares))*100,buyCost=calc.priceAvailable?milestone.remaining*calc.currentPrice:0,phaseLabel=rec.stage==='setup'?'목표 달성':rec.stage==='recovery'?'원금 회수 중':rec.stage==='profit'?'순수익 단계':'';return `<details class="card goal-step-card ${lifecycle?'lifecycle-goal':''}" data-goal-project="${esc(p.id)}" style="--project-a:${colors[0]};--project-b:${colors[1]}">
        <summary><div><div class="goal-symbol-row"><span class="goal-symbol">${esc(p.symbol)}</span>${lifecycle?`<em class="goal-achieved-badge">✓ ${fmtShares(calc.currentTarget)}주 달성</em>`:''}</div><strong>${lifecycle?phaseLabel:`${fmtShares(milestone.shares)}주 목표`}</strong><small>${lifecycle?`현재 ${fmtShares(calc.shares)}주 · 달성일 ${fmtDate(rec.reachedDate)}`:`현재 ${fmtShares(calc.shares)}주${milestone.reached?' · 목표 달성':` · ${fmtShares(milestone.remaining)}주 남음`}`}</small></div><div class="goal-summary-status"><span>${lifecycle?(rec.stage==='setup'?'주수 목표':rec.stage==='profit'?'회수 후':'원금 회수'):'달성률'}</span><b>${lifecycle?(rec.stage==='setup'?'100%':rec.stage==='profit'?'완료':fmtPct(rec.pct)):(milestone.reached?'완료':fmtPct(goalPct))}</b></div></summary>
        ${lifecycle?`${rec.stage==='setup'?progress(100,`linear-gradient(90deg,${colors[0]},${colors[1]})`):progress(rec.pct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}<div class="goal-detail-body">${goalMilestonesHTML(calc)}${lifecycleContent(calc)}</div>`:`${progress(goalPct,`linear-gradient(90deg,${colors[0]},${colors[1]})`)}<div class="goal-detail-body">${goalMilestonesHTML(calc)}<div class="goal-info-rows"><div><span>현재 보유</span><strong>${fmtShares(calc.shares)}주</strong></div><div><span>최근 1년 받은 배당</span><strong>${fmtMoney(calc.analytics.trailingNet,2)}</strong></div><div><span>필요 매수금</span><strong>${calc.priceAvailable?fmtMoney(buyCost,2):'현재가 필요'}</strong></div><div><span>계획상 달성 시점</span><strong>${estimatedDate(calc,milestone.shares)}</strong></div></div><button class="btn soft small" data-settings-project="${esc(p.id)}">목표 · 월 매수계획 설정</button><p class="detail-note">달성 시점은 저장한 월 매수계획만 반영하며 배당금은 예측하지 않습니다.</p>${p.category==='highYield'?`<div class="goal-recovery-preview compact-recovery-link"><span>배당으로 회수한 금액 <b>${fmtMoney(projectRecovery(calc).total,2)}</b></span><button class="card-link" data-project-detail="${esc(p.id)}" data-detail-tab="recovery"><span>배당 사용 · 원금회수 상세</span><b>›</b></button></div>`:''}</div>`}
      </details>`}).join('')||'<article class="card empty">종목을 추가하면 설정한 다음 목표를 보여줍니다.</article>'}</div>`;
  }

  function renderSettings() {
    const container=document.getElementById('page-settings')!;
    const savedScroll=typeof window==='undefined'?0:window.scrollY;
    const priorSections=[...(container.querySelectorAll?.<HTMLDetailsElement>('details')||[])];
    const opened=new Set(priorSections.filter(section=>section.open).map(section=>section.dataset.settingsKey));
    const hadSections=priorSections.length>0;
    const toss=state.integrations.toss;
    const nativeToss=getNativeTossStatus?.()||{available:false,configured:false,publicIp:'',checking:false};
    const appUpdate=getAppUpdateStatus?.()||{available:false,checking:false,currentVersion:APP_VERSION,latestVersion:APP_VERSION,updateAvailable:false,nativeUpdateRequired:false,error:''};
    const tossReady=isTossBridgeConfigured(),tossUser=!!getCurrentUser(),tossBusy=String(toss.status)==='syncing'||nativeToss.checking||!!getCombinedRefreshStatus?.().busy;
    const tossStatus=tossBusy?'처리 중':toss.status==='connected'?'연결됨':String(toss.status)==='partial'?'일부 성공':toss.status==='error'?'확인 필요':nativeToss.available?(nativeToss.configured?'갱신 준비':'최초 설정'):'파일 불러오기';
    const tossComparisons=records(toss.comparisons).slice(0,6);
    const tossOrders=records(toss.sourceLedger?.orders).filter((row)=>row.currency==='USD'&&row.importable!==false),tossBuys=tossOrders.filter((row)=>row.type==='buy').length,tossSells=tossOrders.filter((row)=>row.type==='sell').length;
    const tossDescription=toss.status==='error'?(toss.lastError||'토스 조회 상태를 다시 확인해 주세요.'):String(toss.status)==='partial'?'일부 계좌 또는 시세 조회가 실패했습니다. 성공한 데이터만 보존했으며 전체 성공으로 처리하지 않았습니다.':nativeToss.available?(nativeToss.configured?'토스 갱신만 누르면 매수·매도를 가상 적용해 보유 수량까지 맞는 경우 자동 저장합니다. 중복·과매도·원본 변경만 확인을 요청합니다.':'처음 한 번만 Client ID와 Secret을 안전하게 저장하면 됩니다.'):'현재 IP를 토스에 등록해 만든 읽기 전용 JSON을 불러옵니다. Client ID와 Secret은 브라우저와 파일에 저장하지 않습니다.';
    const autoImportReason=({duplicate:'수동 거래와 겹칠 가능성이 있어 확인이 필요합니다.',oversell:'체결만 적용하면 중간 보유 수량이 음수가 되어 확인이 필요합니다.',reconciliation:'체결 합계와 현재 보유 수량이 달라 확인이 필요합니다.',correction:'토스 원본이 변경된 체결이 있어 확인이 필요합니다.',truncated:'전체 체결을 받지 못해 자동 저장하지 않았습니다.',partial:'일부 계좌 조회가 실패해 자동 저장하지 않았습니다.',ledger:'장부 검증을 통과하지 못했습니다.',validation:'장부 검증을 통과하지 못했습니다.'} as Record<string,string>)[String(toss.lastAutoImportReason||'')]||'';
    const migration=state.meta.migrationAudit,migrationAvailable=!!state.meta.legacyMigrationAvailable,archivedProjects=state.projects.filter((project)=>project.archived),autoBackup=getAutoBackupStatus?.()||{count:0,lastAt:'',error:''};
    document.getElementById('page-settings')!.innerHTML=`${sectionTitle('설정','Dividend OS')}${refreshPanelHTML()}
      <div class="stack settings-list">
        <details class="card settings-status"><summary><span>${state.meta.lastLocalSaveAt?'기기 저장됨':'저장 상태 확인'}</span><span class="tiny muted">${getCurrentUser()?'클라우드 연결됨':'클라우드 연결 안 됨'}</span><b class="chev">⌄</b></summary><p class="tiny muted">재무 계산 업데이트 이후에는 모든 기기에서 최신 버전을 사용하세요. 구버전에서 추가한 기록은 자동 합쳐지지 않습니다.</p><p class="tiny muted">기기 저장 ${esc(syncTime(state.meta.lastLocalSaveAt))}<br>클라우드 <span id="cloudSaveSummary">${esc(getSaveSummary?.()|| (getCurrentUser()?"연결됨 · 저장 상태 확인":"연결 안 됨 · 기기 저장 사용"))}</span></p></details>
        <div class="settings-group-label">사용 설정</div><div class="settings-group">
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">화면 · 환율</div><div class="sub-number">${state.settings.appearance==='system'?'기기 설정':state.settings.appearance==='light'?'라이트':'다크'} · ${state.settings.exchangeRateMode==='auto'?'자동 환율':'직접 입력'} · 1달러 ${Math.round(n(state.settings.exchangeRate)).toLocaleString('ko-KR')}원</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><form id="displaySettingsForm" class="form-grid">
          <div class="form-grid two"><div><label class="input-label">환율 적용</label><select class="input select" name="exchangeRateMode"><option value="manual" ${state.settings.exchangeRateMode!=='auto'?'selected':''}>직접 입력</option><option value="auto" ${state.settings.exchangeRateMode==='auto'?'selected':''}>자동 참고 환율</option></select></div><div><label class="input-label">참고 환율 (1달러)</label><input class="input" name="exchangeRate" type="number" min="1" step="1" required value="${n(state.settings.exchangeRate)}"></div></div>
          <div><label class="input-label">화면 테마</label><select class="input select" name="appearance"><option value="system" ${state.settings.appearance==='system'?'selected':''}>기기 설정 따르기</option><option value="light" ${state.settings.appearance==='light'?'selected':''}>라이트 모드</option><option value="dark" ${state.settings.appearance==='dark'?'selected':''}>다크 모드</option></select></div>
          <button class="btn secondary" type="submit">화면 설정 저장</button></form><div class="feedback-settings"><label><span>터치 진동<small>화면 이동 · 저장 결과에 짧게 반응</small></span><input type="checkbox" role="switch" aria-label="터치 진동" data-feedback-setting="haptics" ${(getInteractionPreferences?.().haptics??true)?'checked':''}></label><label><span>화면 효과<small>이 기기에 적용 · 시스템의 동작 줄이기 우선</small></span><input type="checkbox" role="switch" aria-label="화면 효과" data-feedback-setting="motion" ${(getInteractionPreferences?.().motion??true)?'checked':''}></label></div>${getExchangeRateStatus?.().error?`<p class="tiny negative">${esc(getExchangeRateStatus().error)}</p>`:''}</div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">배당 설정</div><div class="sub-number">월 세후 목표 $${Math.round(n(state.settings.targetMonthlyDividend)).toLocaleString('en-US')} · ${state.settings.dividendAlertEnabled===false?'연간 알림 꺼짐':'연간 알림'} ${Math.round(n(state.settings.thresholdKRW)).toLocaleString('ko-KR')}원</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><form id="dividendSettingsForm" class="form-grid">
          <div><label class="input-label">월 배당 목표금 (USD)</label><input class="input" name="targetMonthlyDividend" type="number" min="0" step="1" value="${n(state.settings.targetMonthlyDividend)}"></div>
          <p class="detail-note">전체 종목의 세후 입금 기준입니다.</p><details class="annual-alert-settings"><summary>연간 배당 알림 · 선택 사항</summary><label class="input-label">연간 알림 사용</label><select class="input select" name="dividendAlertEnabled"><option value="on" ${state.settings.dividendAlertEnabled!==false?'selected':''}>사용</option><option value="off" ${state.settings.dividendAlertEnabled===false?'selected':''}>사용 안 함</option></select>
          <div><label class="input-label">미리 알림 금액 (원)</label><input class="input" name="warningKRW" type="number" min="0" step="10000" value="${n(state.settings.warningKRW)}"></div>
          <div><label class="input-label">기준 도달 알림 금액 (원)</label><input class="input" name="thresholdKRW" type="number" min="0" step="10000" value="${n(state.settings.thresholdKRW)}"></div>
          <p class="detail-note">현재 환율 기준 · 개인 알림용 · 세금 판정 아님</p></details>
          <button class="btn secondary" type="submit">배당 설정 저장</button>
        </form></div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">종목별 설정</div><div class="sub-number">종목 구분 · 목표 · 색상</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><div class="list settings-project-list">${activeProjects().map((project)=>`<div class="list-row"><div><div class="row-title"><span class="project-color-dot" style="background:${projectColors(project)[0]}"></span>${esc(project.symbol)}</div><div class="row-sub">${esc(categoryLabel(project.category))} · 목표 ${fmtShares(project.targetUnits)}주</div></div><button class="mini-icon" data-settings-project="${project.id}">수정</button></div>`).join('')}</div></div></details>
        </div><div class="settings-group-label">앱 관리</div><div class="settings-group">

        <details class="card settings-section settings-connection" name="settings"><summary><div><div class="card-title">토스증권 읽기 전용</div><div class="sub-number">보유주식 · 현재가 · 체결 대조</div></div><span class="status-pill ${toss.status==='connected'?'positive':''}">${tossStatus}</span><b class="chev">⌄</b></summary><div class="settings-section-body">
          <p class="tiny muted">${esc(tossDescription)}</p>
          <p class="tiny muted toss-capability-note">보유주식·현재가·체결을 조회해요. 배당 입금은 직접 기록해야 해요. 매매 주문은 실행하지 않아요.</p>
          ${nativeToss.available?`<div class="toss-setup"><div class="setup-step"><span>${nativeToss.configured?'✓':'1'}</span><div><strong>${nativeToss.configured?'토스 키 저장됨':'최초 1회 키 저장'}</strong><small>${nativeToss.configured?'키는 이 기기 보안 저장소에 암호화되어 있습니다.':'Client ID와 Secret은 입력 후 화면에 다시 표시하지 않습니다.'}</small></div></div>${(nativeToss.publicIp||nativeToss.lastPublicIp)?`<div class="setup-step"><span>IP</span><div><strong>${esc(nativeToss.publicIp||nativeToss.lastPublicIp)}</strong><small>${nativeToss.publicIp&&nativeToss.lastPublicIp&&nativeToss.publicIp!==nativeToss.lastPublicIp?'변경됨 · 갱신을 누르면 등록을 안내합니다.':'마지막으로 확인한 공인 IP'}</small></div></div>`:''}</div>`:`<div class="toss-setup"><div class="setup-step"><span>1</span><div><strong>무료 일회성 조회</strong><small>Cloud Shell에서 현재 IP 등록 → JSON 생성 → 이 앱에서 불러오기 → 후보 검토 순서입니다.</small></div></div></div>`}
          ${autoImportReason?`<div class="toss-sync-warning"><strong>조회 완료 · 거래 저장 보류</strong><p>${esc(autoImportReason)}</p><span>확인되지 않은 거래는 기존 장부에 반영하지 않았습니다.</span></div>`:''}

          <details class="toss-details"><summary><strong>계좌 대조 · 조회 상세</strong><b class="chev">⌄</b></summary>
          <p class="tiny muted">마지막 조회 ${esc(syncTime(toss.lastSyncAt))}<br>마지막 전체 성공 ${esc(syncTime(toss.lastSuccessfulAt))}${toss.lastAttemptAt?`<br>마지막 연결 시도 ${esc(syncTime(toss.lastAttemptAt))}`:''}</p>
          ${toss.accountLabel?`<div class="row-sub">${esc(toss.accountLabel)}${toss.lastSyncAt?` · ${fmtDate(toss.lastSyncAt.slice(0,10))} 조회`:''}</div>`:''}
          ${tossComparisons.length?`<div class="list" style="margin-top:12px">${tossComparisons.map((row)=>`<div class="list-row"><div><div class="row-title">${esc(row.symbol)} · ${fmtShares(row.shares)}주</div><div class="row-sub">${Array.isArray(row.accounts)&&row.accounts.length>1?`${row.accounts.length}계좌 합산 · `:''}앱 ${fmtShares(row.appShares)}주${row.supported?'':' · 원화 종목은 대조만'}</div></div><div class="row-value ${Math.abs(n(row.difference))<.0001?'positive':''}">${Math.abs(n(row.difference))<.0001?'일치':`${n(row.difference)>0?'+':''}${fmtShares(row.difference)}주`}</div></div>`).join('')}</div>`:''}
          ${toss.unsupportedCurrencyCount?`<p class="tiny muted">원화 체결 ${toss.unsupportedCurrencyCount}건은 USD 원장에 섞지 않고 제외했습니다.</p>`:''}
          ${toss.matchedExistingCount?`<p class="tiny muted">수동 거래와 유사한 토스 체결 ${toss.matchedExistingCount}건은 자동 병합하지 않고 검토 후보로 표시했습니다.</p>`:''}${toss.matchedExistingDividendCount?`<p class="tiny muted">수동 배당과 유사한 토스 입금 ${toss.matchedExistingDividendCount}건은 자동 병합하지 않고 검토 후보로 표시했습니다.</p>`:''}
          ${toss.failedAccountCount?`<p class="tiny negative">계좌 ${toss.failedAccountCount}개 조회 실패 · 성공한 계좌만 반영</p>`:''}
          ${(records(toss.correctionCandidates).length||records(toss.dividendCorrectionCandidates).length)?`<div class="toss-setup"><div class="setup-step"><span>!</span><div><strong>토스 원본 변경 ${(records(toss.correctionCandidates).length||0)+(records(toss.dividendCorrectionCandidates).length||0)}건</strong><small>기존 원장은 자동 수정·삭제하지 않았습니다. 토스 앱 원본을 확인한 뒤 알림을 정리하세요.</small></div></div><button class="btn soft small" data-clear-toss-corrections>확인 처리</button></div>`:''}
          ${(toss.sourceLedger?.orders?.length||toss.sourceLedger?.dividends?.length)?`<p class="tiny positive">기기 보존 원본 · 매수 ${tossBuys}건 · 매도 ${tossSells}건${toss.lastSuccessfulAt?' · 마지막 성공 '+fmtDate(toss.lastSuccessfulAt.slice(0,10)):''}</p><p class="tiny muted">배당 · ${toss.capabilities?.dividends?`${toss.sourceLedger.dividends.length}건 조회`:'토스 공식 API 미지원 · 실제 입금은 직접 기록'}</p>`:''}
          ${toss.historyTruncated?'<p class="tiny negative">체결 기록이 10,000건을 넘어 일부만 조회됐습니다. 기간을 나눠 다시 조회해야 합니다.</p>':''}
          </details>
          ${nativeToss.available?`<div class="action-row" style="margin-top:12px"><button class="btn ${nativeToss.configured?'soft':'secondary'}" data-configure-toss ${tossBusy?'disabled':''}>${nativeToss.configured?'키 변경':'최초 설정'}</button></div>${nativeToss.configured?'<button class="text-link" style="margin-top:12px" data-clear-toss-credentials>이 기기에 저장한 토스 키 삭제</button>':''}<details class="toss-details" style="margin-top:12px"><summary><div><strong>긴급 수동 불러오기</strong><small>APK 조회가 안 될 때만 JSON 사용</small></div><b class="chev">⌄</b></summary><div class="manual-tools-body"><button class="btn soft" data-import-toss ${tossBusy?'disabled':''}>토스 JSON 불러오기</button></div></details>`:`<div class="action-row" style="margin-top:12px"><button class="btn secondary" data-import-toss ${tossBusy?'disabled':''}>${tossBusy?'처리 중…':'토스 JSON 불러오기'}</button></div>`}
          <details class="toss-details"><summary><strong>연결 관리 · 거래 복구</strong><b class="chev">⌄</b></summary><div class="toss-management-actions">
          ${(records(toss.candidates).length||records(toss.dividendCandidates).length)?`<button class="btn soft" style="margin-top:9px" data-review-toss ${tossBusy?'disabled':''}>조회 기록 검토</button>`:''}
          ${(records(toss.candidates).length||records(toss.dividendCandidates).length||records(toss.correctionCandidates).length||records(toss.dividendCorrectionCandidates).length)?`<button class="btn soft" style="margin-top:9px" data-delete-toss-exceptions ${tossBusy?'disabled':''}>대기 목록 정리</button>`:''}
          ${records(toss.sourceLedger?.orders).some((row)=>String(row?.symbol||'').toUpperCase()==='MSTY')?'<button class="btn soft" style="width:100%;margin-top:9px" data-rebuild-msty-toss>MSTY를 토스 원본으로 다시 만들기</button>':''}
          ${toss.accountScopeId&&toss.status!=='not_connected'?'<button class="btn soft" style="margin-top:9px" data-disconnect-toss>화면 연결 해제</button>':''}          </div></details>

        </div></details>
        <details class="card settings-section settings-connection" name="settings"><summary><div><div class="card-title">클라우드</div><div class="sub-number">기기 간 저장 · 변경 충돌 확인</div></div><strong class="${getCurrentUser()?'positive':''}">${getCurrentUser()?'연결됨':'로그인 필요'}</strong><b class="chev">⌄</b></summary><div class="settings-section-body"><div class="sync-line"><span class="sync-dot" id="syncDot"></span><div><div class="row-title" id="syncStatusText">${getCurrentUser()?'연결됨':'로그인 필요'}</div><div class="row-sub">다른 기기에서 바뀐 기록은 확인 후 반영</div></div></div>${getCurrentUser()?'<button class="btn secondary" style="width:100%;margin-top:12px" data-review-cloud>클라우드 기록 확인</button><button class="btn soft" style="width:100%;margin-top:12px" data-logout>로그아웃</button>':'<button class="btn secondary" style="width:100%;margin-top:12px" data-show-login>클라우드 연결</button>'}</div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">백업·복원</div><div class="sub-number">ZIP 저장 · 기록 복원</div></div><b class="chev">⌄</b></summary><div class="settings-section-body advanced-settings">          <section><div class="card-title">백업 · 내보내기</div><p class="tiny muted">거래·배당·설정을 함께 보관합니다. 복원할 때 파일 손상과 기록을 확인합니다.</p><div class="action-row" style="margin-top:13px"><button class="btn primary" data-backup>ZIP 백업</button><button class="btn secondary" data-restore>ZIP 복원</button></div><div class="action-row" style="margin-top:9px"><button class="btn soft" data-csv>CSV 4개 내보내기</button><button class="btn soft" data-all-check>전체 점검</button></div><details class="initial-import-tools form-advanced" style="margin-top:12px"><summary><div><strong>처음 배당 내역 가져오기</strong><span>기존 배당을 전체 교체할 때만 사용</span></div><b class="chev">⌄</b></summary><div class="manual-tools-body"><button class="btn soft" data-replace-dividends>배당 교체 파일 불러오기</button></div></details></section>
          <section><div class="card-title">안전 사본</div><p class="tiny muted">자동 백업 ${autoBackup.count}개${autoBackup.lastAt?` · 최근 ${esc(autoBackup.lastAt.slice(0,16).replace('T',' '))}`:''}${autoBackup.error?` · ${esc(autoBackup.error)}`:''}. 최근 7개만 순환 보관하며 직접 받은 ZIP은 삭제하지 않습니다.</p><button class="btn soft" style="width:100%" data-restore-auto ${autoBackup.count?'':'disabled'}>최근 자동 백업 복원</button><button class="btn soft" style="width:100%;margin-top:9px" data-restore-safety>직전 안전 사본 되돌리기</button></section>
</div></details>
        ${appUpdate.available?`<details class="card settings-section" name="settings" ${appUpdate.updateAvailable?'open':''}><summary><div><div class="card-title">앱 업데이트</div><div class="sub-number">현재 ${esc(releaseLabel(appUpdate.currentVersion))} · 배포 ${esc(releaseLabel(appUpdate.latestVersion||'확인 전'))}</div></div><strong class="${appUpdate.updateAvailable?'positive':''}">${appUpdate.checking?'확인 중':appUpdate.error?'확인 실패':!appUpdate.latestVersion?'확인 전':appUpdate.updateAvailable?'업데이트 있음':appUpdate.latestVersion!==appUpdate.currentVersion?'설치 버전이 더 최신':'최신 버전'}</strong><b class="chev">⌄</b></summary><div class="settings-section-body"><p class="tiny muted">화면과 계산 기능은 앱 안에서 교체하며 거래·배당·토스 키는 그대로 유지합니다. 적용 실패 시 기존 버전으로 자동 복구합니다.</p>${appUpdate.error?`<p class="tiny negative">${esc(appUpdate.error)}</p>`:''}<div class="action-row" style="margin-top:12px">${appUpdate.updateAvailable?`<button class="btn primary" data-install-hot-update ${appUpdate.checking?'disabled':''}>${appUpdate.nativeUpdateRequired?'보안 업데이트 안내':'지금 업데이트'}</button>`:''}<button class="btn soft" data-check-hot-update ${appUpdate.checking?'disabled':''}>다시 확인</button></div></div></details>`:''}
        </div>
        ${archivedProjects.length?`<article class="card"><div class="card-title">보관한 프로젝트</div><div class="list" style="margin-top:12px">${archivedProjects.map((project)=>`<div class="list-row"><div><div class="row-title">${esc(project.symbol)}</div><div class="row-sub">${esc(project.name)}</div></div><button class="mini-icon" data-restore-project="${project.id}">복원</button></div>`).join('')}</div></article>`:''}
        <details class="card settings-section settings-advanced" name="settings"><summary><div><div class="card-title">고급 설정</div><div class="sub-number">데이터 이전 · 초기화</div></div><b class="chev">⌄</b></summary><div class="settings-section-body advanced-settings">
          <section><div class="card-head"><div><div class="card-title">V3.2.1 데이터 이전</div><div class="sub-number">원본 읽기 전용 · V4 복사</div></div><span class="status-pill ${migration?.passed?'positive':''}">${migration?.passed?'대조 통과':migrationAvailable?'이전 가능':'대기'}</span></div>${migration?.passed?`<div class="list"><div class="list-row"><div><div class="row-title">이전 결과</div><div class="row-sub">거래 ${migration.source.tradeCount}건 · 배당 ${migration.source.dividendCount}건 · 분할 ${migration.source.splitCount}건</div></div><div class="row-value positive">전부 일치</div></div></div>`:`<p class="tiny muted">${migrationAvailable?'이 기기의 V3.2.1 기록을 발견했습니다. 숫자를 먼저 대조한 뒤 복사합니다.':'V3.2.1 기록 또는 로그인된 기존 클라우드를 확인하면 활성화됩니다.'}</p>${migrationAvailable?'<button class="btn primary" style="width:100%" data-migrate-v3>V3 이전값 점검</button>':''}`}</section>
          <section class="danger-zone"><div class="card-title">초기화</div><p class="tiny muted">V4 데이터만 지웁니다. V3.2.1 저장소는 삭제하지 않습니다.</p><button class="btn soft" style="width:100%" data-reset>V4 전체 초기화</button></section>
        </div></details>
      </div><div class="detail-note">원화는 설정 환율로 환산한 참고 금액입니다. 관리기준은 사용자 알림용이며 세금 판정이 아닙니다.</div><div class="app-version">DividendOS ${releaseLabel(APP_VERSION)}${state.meta.migratedFrom?` · ${esc(state.meta.migratedFrom)}에서 이전`:''}</div>`;
    container.querySelectorAll?.<HTMLDetailsElement>('details').forEach((section,index)=>{
      const summary=section.querySelector(':scope > summary');
      const key=summary?.querySelector('.card-title')?.textContent||summary?.querySelector('strong')?.textContent||String(index);
      section.dataset.settingsKey=key;
      if(hadSections)section.open=opened.has(key);
    });
    if(typeof window!=='undefined'&&container.classList.contains('active')&&document.body.style.position!=='fixed')window.scrollTo(0,savedScroll);
    document.getElementById('page-settings')?.querySelectorAll?.<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea').forEach((input,index)=>{const label=input.closest('label')||input.closest('div')?.querySelector('label');if(label){input.id='settings-field-'+index;label.htmlFor=input.id;}});
  }

  return { renderHome, renderProjects, renderGoals, renderSettings };
}
