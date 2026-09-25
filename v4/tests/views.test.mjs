import assert from 'node:assert/strict';
import { blankProject, blankState } from '../modules/state.js';
import { createPortfolioEngine } from '../modules/portfolio.js';
import { createFormatters } from '../modules/format.js';
import { createViews } from '../modules/views.js';

const elements = new Map(['page-home','page-projects','page-goal','page-settings'].map(id => [id,{id,innerHTML:''}]));
globalThis.document = { getElementById:id => elements.get(id) || null };

const state=blankState();
state.meta.legacyMigrationAvailable=true;
state.projects[0].id='p-msty'; state.projects[0].currentPrice=12; state.projects[0].targetUnits=1000;
const cony=blankProject('CONY','CONY Fund'); cony.id='p-cony'; cony.currentPrice=8; cony.targetUnits=500; cony.colorIndex=1;
state.projects.push(cony);
state.trades.push({id:'t1',projectId:'p-msty',date:'2026-01-01',type:'buy',buyType:'direct',shares:20,price:10});
state.dividends.push({id:'d1',projectId:'p-msty',date:'2026-01-15',amountUSD:15,note:'첫 배당'});

let selectedProjectId='p-msty';
let chartMode='month';
let homeMode='month';
let homeYearRange='6';
let portfolioGroup='highYield';
const portfolio=createPortfolioEngine(()=>state,()=>selectedProjectId);
const formatters=createFormatters(()=>state);
const views=createViews({
  getState:()=>state,
  getSelectedProjectId:()=>selectedProjectId,
  setSelectedProjectId:value=>{selectedProjectId=value;},
  getChartMode:()=> chartMode,
  getChartSelection:()=> '',
  getHomeCashflowMode:()=>homeMode,
  getHomeYearRange:()=>homeYearRange,
  getCashflowMonthKey:()=> '',
  getPortfolioGroup:()=>portfolioGroup,
  setPortfolioGroup:value=>{portfolioGroup=value;},
  getCurrentUser:()=> null,
  isTossBridgeConfigured:()=> false,
  ...portfolio,
  ...formatters
});

views.renderHome();
views.renderProjects();
views.renderGoals();
views.renderSettings();

assert.match(elements.get('page-home').innerHTML,/MSTY/);
assert.match(elements.get('page-home').innerHTML,/이번 달 받은 배당/);
assert.match(elements.get('page-home').innerHTML,/올해 받은 배당/);
assert.match(elements.get('page-home').innerHTML,/최근 3개월 월평균/);
assert.match(elements.get('page-home').innerHTML,/배당 현금흐름/);
assert.match(elements.get('page-home').innerHTML,/data-home-cashflow-mode="year"/);
assert.match(elements.get('page-home').innerHTML,/data-cashflow-period=/);
assert.doesNotMatch(elements.get('page-home').innerHTML,/이번 달 종목별 배당/);
assert.doesNotMatch(elements.get('page-home').innerHTML,/다음 배당/);
assert.doesNotMatch(elements.get('page-home').innerHTML,/남은 예상|월말 예상/);
assert.match(elements.get('page-home').innerHTML,/다음 목표/);
assert.equal((elements.get('page-home').innerHTML.match(/<article class="card/g)||[]).length,3,'home must stay at three cards');
assert.doesNotMatch(elements.get('page-home').innerHTML,/[①②③④⑤⑥]/);
homeMode='year';views.renderHome();
assert.match(elements.get('page-home').innerHTML,/data-home-year-range="6"/);
assert.match(elements.get('page-home').innerHTML,/data-home-year-range="10"/);
assert.match(elements.get('page-home').innerHTML,/data-home-year-range="all"/);
homeMode='month';views.renderHome();
assert.match(elements.get('page-projects').innerHTML,/포트폴리오/);
assert.match(elements.get('page-projects').innerHTML,/첫 배당/);
assert.match(elements.get('page-projects').innerHTML,/2건 · 거래·배당·인출·분할/);
assert.match(elements.get('page-projects').innerHTML,/고배당주/);
assert.match(elements.get('page-projects').innerHTML,/data-portfolio-group="highYield"/);
assert.match(elements.get('page-projects').innerHTML,/data-portfolio-group="dividend"/);
assert.doesNotMatch(elements.get('page-projects').innerHTML,/운용 성격으로 좁혀보기/);
assert.match(elements.get('page-projects').innerHTML,/주당 실제 지급액/);
assert.match(elements.get('page-projects').innerHTML,/매입금 기준/);
assert.match(elements.get('page-projects').innerHTML,/투입금 대비/);
assert.match(elements.get('page-projects').innerHTML,/누적 배당률/);
assert.doesNotMatch(elements.get('page-projects').innerHTML,/배당 포함 성과/);
assert.match(elements.get('page-projects').innerHTML,/다음 목표/);
assert.match(elements.get('page-projects').innerHTML,/class="card record-center"/);
assert.match(elements.get('page-projects').innerHTML,/data-view-record="dividend:d1"/);
assert.doesNotMatch(elements.get('page-projects').innerHTML,/data-delete-record=/,'history rows must not expose delete');
assert.doesNotMatch(elements.get('page-projects').innerHTML,/class="card record-center" open/);
assert.doesNotMatch(elements.get('page-projects').innerHTML,/상세정보 · 기록/);
assert.match(elements.get('page-projects').innerHTML,/이번 달 실제 배당/);
assert.doesNotMatch(elements.get('page-projects').innerHTML,/월 예상 배당/);
assert.match(elements.get('page-projects').innerHTML,/배당 분석/);
assert.match(elements.get('page-projects').innerHTML,/portfolio-income-hero/);
assert.match(elements.get('page-projects').innerHTML,/payment-spark/);
assert.equal((elements.get('page-projects').innerHTML.match(/data-chart-key=/g)||[]).length,12,'monthly chart must show all 12 calendar months including zero months');
assert.match(elements.get('page-projects').innerHTML,/달력 월별 실제 입금/);
assert.match(elements.get('page-projects').innerHTML,/data-chart-year-shift="-1"/);
assert.doesNotMatch(elements.get('page-projects').innerHTML,/<select[^>]+data-chart-year/,'long year dropdown must not return');
assert.match(elements.get('page-projects').innerHTML,/2026년 01월 실제 입금/);
assert.equal((elements.get('page-projects').innerHTML.match(/data-add-dividend>/g)||[]).length,1,'manual dividend fallback must remain available');
assert.match(elements.get('page-projects').innerHTML,/class="manual-tools embedded-tools"/);
assert.match(elements.get('page-projects').innerHTML,/토스 미연동·누락 기록만 보정/);
assert.ok(elements.get('page-projects').innerHTML.indexOf('data-add-dividend>')>elements.get('page-projects').innerHTML.indexOf('실제 입금 흐름'),'manual entry must stay inside the final record center');
assert.doesNotMatch(elements.get('page-projects').innerHTML,/class="price-shortcut"/);
assert.match(elements.get('page-projects').innerHTML,/data-income-project="p-msty"/);
assert.doesNotMatch(elements.get('page-home').innerHTML,/cashflow-selected/,'do not repeat monthly totals below chart');
assert.doesNotMatch(elements.get('page-home').innerHTML,/월말 예상 합계/);
assert.match(elements.get('page-home').innerHTML,/최근 3개월 월평균/);
assert.ok(elements.get('page-projects').innerHTML.indexOf('value-line')<elements.get('page-projects').innerHTML.indexOf('holding-row'),'valuation must precede holding stats');
assert.match(elements.get('page-goal').innerHTML,/250주 목표/);
assert.doesNotMatch(elements.get('page-goal').innerHTML,/500주 목표/);
assert.doesNotMatch(elements.get('page-goal').innerHTML,/<details class="card goal-step-card" open/);
assert.match(elements.get('page-goal').innerHTML,/최근 12개월 실제/);
assert.match(elements.get('page-goal').innerHTML,/필요 매수금/);
assert.match(elements.get('page-goal').innerHTML,/계획상 달성 시점/);
assert.match(elements.get('page-settings').innerHTML,/DividendOS 0\.12\.5/);
assert.match(elements.get('page-settings').innerHTML,/id="displaySettingsForm"/);
assert.match(elements.get('page-settings').innerHTML,/id="dividendSettingsForm"/);
assert.doesNotMatch(elements.get('page-settings').innerHTML,/<details class="card settings-section" open/);
assert.match(elements.get('page-settings').innerHTML,/종목별 설정/);
assert.match(elements.get('page-settings').innerHTML,/연동 시 자동/);
assert.match(elements.get('page-settings').innerHTML,/토스증권 읽기 전용/);
assert.match(elements.get('page-settings').innerHTML,/설정 필요/);
assert.match(elements.get('page-settings').innerHTML,/현재 IP 확인/);
assert.match(elements.get('page-settings').innerHTML,/토스 연결 시험/);
assert.match(elements.get('page-settings').innerHTML,/클라우드 연결/);
state.integrations.toss={...state.integrations.toss,status:'connected',accountLabel:'토스증권 •1234',lastSyncAt:'2026-09-13T10:00:00Z',comparisons:[{symbol:'MSTY',shares:22,appShares:20,difference:2,supported:true}],candidates:[{externalId:'x'}],matchedExistingCount:3};
views.renderSettings();
assert.match(elements.get('page-settings').innerHTML,/토스증권 •1234/);
assert.match(elements.get('page-settings').innerHTML,/기존 수동 거래와 일치한 토스 체결 3건/);
assert.match(elements.get('page-settings').innerHTML,/후보 1건 검토/);
assert.match(elements.get('page-settings').innerHTML,/\+2주/);
assert.match(elements.get('page-settings').innerHTML,/V3\.2\.1 데이터 이전/);
assert.match(elements.get('page-settings').innerHTML,/V3 이전값 점검/);
cony.archived=true;
views.renderSettings();
assert.match(elements.get('page-settings').innerHTML,/보관한 프로젝트/);
assert.match(elements.get('page-settings').innerHTML,/data-restore-project="p-cony"/);
cony.archived=false;
state.trades.push({id:'goal',projectId:'p-msty',date:'2026-02-01',type:'buy',buyType:'direct',shares:980,price:10});
views.renderGoals();
assert.match(elements.get('page-goal').innerHTML,/원금회수 기준 확정/);
assert.match(elements.get('page-goal').innerHTML,/주수 목표 달성/);
assert.doesNotMatch(elements.get('page-goal').innerHTML,/data-goal-mode=/);
state.projects[0].recovery={locked:true,basis:10000,startDate:'2026-02-01',targetReachedDate:'2026-02-01',method:'withdrawnOnly'};
state.cashAdjustments.push({id:'w1',projectId:'p-msty',date:'2026-02-02',amountUSD:-2500,purpose:'recoveryWithdrawal',label:'배당금 인출'});
views.renderProjects();views.renderGoals();
assert.match(elements.get('page-projects').innerHTML,/원금 회수 중/);
assert.match(elements.get('page-projects').innerHTML,/실제 인출 회수/);
assert.match(elements.get('page-projects').innerHTML,/data-add-withdrawal="p-msty"/);
assert.doesNotMatch(elements.get('page-projects').innerHTML,/고배당주 · 다음 목표/);
assert.match(elements.get('page-goal').innerHTML,/원금 회수 중/);
assert.match(elements.get('page-goal').innerHTML,/25\.0%/);
console.log('DividendOS v0.12.5 view QA: PASS');
