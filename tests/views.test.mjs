import assert from 'node:assert/strict';
import { blankProject, blankState } from '../modules/state.js';
import { createPortfolioEngine } from '../modules/portfolio.js';
import { createFormatters } from '../modules/format.js';
import { createViews } from '../modules/views.js';

const elements = new Map(['page-home','page-projects','page-goal','page-settings'].map(id => [id,{id,innerHTML:''}]));
globalThis.document = { getElementById:id => elements.get(id) || null };

const state=blankState();\nstate.meta.legacyMigrationAvailable=true;
state.projects[0].id='p-msty'; state.projects[0].currentPrice=12; state.projects[0].targetUnits=1000;
const cony=blankProject('CONY','CONY Fund'); cony.id='p-cony'; cony.currentPrice=8; cony.targetUnits=500; cony.colorIndex=1;
state.projects.push(cony);
state.trades.push({id:'t1',projectId:'p-msty',date:'2026-01-01',type:'buy',buyType:'direct',shares:20,price:10});
state.dividends.push({id:'d1',projectId:'p-msty',date:'2026-01-15',amountUSD:15,note:'첫 배당'});

let selectedProjectId='p-msty';
const portfolio=createPortfolioEngine(()=>state,()=>selectedProjectId);
const formatters=createFormatters(()=>state);
const views=createViews({
  getState:()=>state,
  getSelectedProjectId:()=>selectedProjectId,
  setSelectedProjectId:value=>{selectedProjectId=value;},
  getChartMode:()=> 'month',
  getRecordsExpanded:()=> false,
  getCurrentUser:()=> null,
  ...portfolio,
  ...formatters
});

views.renderHome();
views.renderProjects();
views.renderGoals();
views.renderSettings();

assert.match(elements.get('page-home').innerHTML,/2개 프로젝트/);
assert.match(elements.get('page-home').innerHTML,/MSTY/);
assert.match(elements.get('page-projects').innerHTML,/첫 배당/);
assert.match(elements.get('page-goal').innerHTML,/현금흐름 전환/);
assert.match(elements.get('page-settings').innerHTML,/DividendOS 0\.9/);
assert.match(elements.get('page-settings').innerHTML,/토스 읽기 전용/);\nassert.match(elements.get('page-settings').innerHTML,/V3\\.2\\.1 데이터 이전/);\nassert.match(elements.get('page-settings').innerHTML,/V3 이전값 점검/);
console.log('DividendOS v0.9 view QA: PASS');
