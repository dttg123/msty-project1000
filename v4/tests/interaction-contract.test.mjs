import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoState } from '../modules/demo.js';
import { createPortfolioEngine } from '../modules/portfolio.js';
import { createFormatters } from '../modules/format.js';
import { createViews } from '../modules/views.js';

const elements=new Map(['page-home','page-projects','page-goal','page-settings'].map(id=>[id,{id,innerHTML:''}]));
globalThis.document={getElementById:id=>elements.get(id)||null,querySelector:()=>null};
const state=demoState(new Date('2026-09-23T12:00:00Z'));
let selectedProjectId='demo-msty',chartMode='month',chartSelection='',homeMode='month',homeYearRange='6',cashflowMonthKey='';
const portfolio=createPortfolioEngine(()=>state,()=>selectedProjectId),formatters=createFormatters(()=>state);
const views=createViews({
  getState:()=>state,getSelectedProjectId:()=>selectedProjectId,setSelectedProjectId:value=>selectedProjectId=value,
  getChartMode:()=>chartMode,getChartSelection:()=>chartSelection,getHomeCashflowMode:()=>homeMode,getHomeYearRange:()=>homeYearRange,
  getHistoryLimit:()=>10,getHistoryFilter:()=>({}),getChartMonth:()=>'2026-09',getChartYear:()=>'',getCashflowMonthKey:()=>cashflowMonthKey,
  getCurrentUser:()=>null,isTossBridgeConfigured:()=>false,
  getTossConnectionMode:()=>'none',getTossLocalConfig:()=>({clientId:'',hasSecret:false}),getTossSetup:()=>({ip:'',busy:'',message:''}),
  ...portfolio,...formatters
});

views.renderHome();
assert.match(elements.get('page-home').innerHTML,/data-home-cashflow-mode="year"/);
homeMode='year';homeYearRange='all';cashflowMonthKey='2022';views.renderHome();
assert.match(elements.get('page-home').innerHTML,/2022년/);
assert.match(elements.get('page-home').innerHTML,/data-home-year-range="all"/);

for(const symbol of ['MSTY','SCHD','KO']){
  selectedProjectId=`demo-${symbol.toLowerCase()}`;views.renderProjects();
  const html=elements.get('page-projects').innerHTML;
  assert.match(html,new RegExp(symbol));
  assert.doesNotMatch(html,/data-portfolio-category/);
  assert.match(html,/data-project-select/);
}
selectedProjectId='demo-cony';
for(const mode of ['week','month','year','monthWeeks']){
  chartMode=mode;chartSelection='';views.renderProjects();
  const html=elements.get('page-projects').innerHTML;
  assert.match(html,new RegExp(`data-chart-mode="${mode}" class="active"`));
}
views.renderGoals();views.renderSettings();
assert.match(elements.get('page-goal').innerHTML,/demo-msty:cashflow|목표 · 월 매수계획 설정/);
assert.match(elements.get('page-settings').innerHTML,/토스증권 읽기 전용/);

const app=readFileSync(resolve(import.meta.dirname,'../app.js'),'utf8');
const routed=['page','currency','chartKey','incomeMonth','historyReset','historyMore','chartMode','homeCashflowMode','homeYearRange','cashflowPeriod','goalDetail','settingsProject','openProject','selectProject','addProject','projectSettings','editPrice','addTrade','addDividend','addCash','addSplit','viewRecord','editRecord','deleteFromEdit','projectCheck','allCheck','goalMode','lockRecovery','editRecovery','restoreProject','backup','restore','csv','syncToss','reviewToss','closeModal'];
for(const action of routed)assert.ok(app.includes(`button.dataset.${action}`)||app.includes(`'${action}'in button.dataset`),`${action} must have a click route`);

console.log(`Interaction contract PASS: ${routed.length} click routes, one stock selector, 4 chart modes`);
