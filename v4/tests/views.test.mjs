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
let portfolioCategory='highYield';
const portfolio=createPortfolioEngine(()=>state,()=>selectedProjectId);
const formatters=createFormatters(()=>state);
const views=createViews({
  getState:()=>state,
  getSelectedProjectId:()=>selectedProjectId,
  setSelectedProjectId:value=>{selectedProjectId=value;},
  getChartMode:()=> chartMode,
  getRecordsExpanded:()=> false,
  getPortfolioDetailsExpanded:()=> false,
  getPortfolioCategory:()=>portfolioCategory,
  setPortfolioCategory:value=>{portfolioCategory=value;},
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
assert.match(elements.get('page-home').innerHTML,/이번 달 배당/);
assert.match(elements.get('page-home').innerHTML,/올해 받은 배당/);
assert.match(elements.get('page-home').innerHTML,/현재 배당 페이스/);
assert.match(elements.get('page-home').innerHTML,/배당 현금흐름/);
assert.match(elements.get('page-home').innerHTML,/다음 배당/);
assert.match(elements.get('page-home').innerHTML,/다음 목표/);
assert.doesNotMatch(elements.get('page-home').innerHTML,/[①②③④⑤⑥]/);
assert.match(elements.get('page-projects').innerHTML,/포트폴리오/);
assert.doesNotMatch(elements.get('page-projects').innerHTML,/첫 배당/);
assert.match(elements.get('page-projects').innerHTML,/기록 2건 보기/);
assert.match(elements.get('page-projects').innerHTML,/고배당주/);
assert.match(elements.get('page-projects').innerHTML,/상세정보 · 기록/);
assert.match(elements.get('page-projects').innerHTML,/최근 월환산/);
assert.match(elements.get('page-projects').innerHTML,/배당 현금흐름/);
assert.match(elements.get('page-projects').innerHTML,/26\.01/);
assert.match(elements.get('page-goal').innerHTML,/250주 목표/);
assert.doesNotMatch(elements.get('page-goal').innerHTML,/500주 목표/);
assert.match(elements.get('page-goal').innerHTML,/현재 월 현금흐름/);
assert.match(elements.get('page-settings').innerHTML,/DividendOS 0\.9\.8/);
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
assert.match(elements.get('page-goal').innerHTML,/원금회수 시작/);
assert.match(elements.get('page-goal').innerHTML,/data-goal-mode="p-msty:cashflow" class="active"/);
console.log('DividendOS v0.9.8 view QA: PASS');
