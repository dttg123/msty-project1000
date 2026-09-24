import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoState } from '../modules/demo.js';
import { createPortfolioEngine } from '../modules/portfolio.js';
import { createFormatters } from '../modules/format.js';
import { createViews } from '../modules/views.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const output=path.join('/workspace/scratch/a518a2dc4424','mobile-qa');
await fs.mkdir(output,{recursive:true});

const elements=new Map(['page-home','page-projects','page-goal','page-settings'].map(id=>[id,{id,innerHTML:''}]));
globalThis.document={
  getElementById:id=>elements.get(id)||null,
  querySelector:()=>null
};

const state=demoState(new Date('2026-09-23T12:00:00Z'));
let selectedProjectId='demo-msty';
let chartMode='month';
let chartSelection='';
let homeMode='month';
let homeYearRange='6';
let cashflowMonthKey='';
let portfolioCategory='highYield';
const portfolio=createPortfolioEngine(()=>state,()=>selectedProjectId);
const formatters=createFormatters(()=>state);
const views=createViews({
  getState:()=>state,
  getSelectedProjectId:()=>selectedProjectId,
  setSelectedProjectId:value=>{selectedProjectId=value;},
  getChartMode:()=>chartMode,
  getChartSelection:()=>chartSelection,
  getHomeCashflowMode:()=>homeMode,
  getHomeYearRange:()=>homeYearRange,
  getHistoryLimit:()=>10,
  getHistoryFilter:()=>({}),
  getChartMonth:()=>'2026-09',
  getChartYear:()=>'',
  getCashflowMonthKey:()=>cashflowMonthKey,
  getPortfolioCategory:()=>portfolioCategory,
  setPortfolioCategory:value=>{portfolioCategory=value;},
  getCurrentUser:()=>null,
  isTossBridgeConfigured:()=>false,
  getTossConnectionMode:()=> 'none',
  getTossLocalConfig:()=>({clientId:'',clientSecret:''}),
  getTossSetup:()=>({ip:'',busy:'',message:''}),
  ...portfolio,
  ...formatters
});

const styles=`${await fs.readFile(path.join(root,'styles.css'),'utf8')}\n${await fs.readFile(path.join(root,'styles-refined.css'),'utf8')}`;
const icon=(name)=>name==='home'?'<path d="M3 11.5 12 4l9 7.5M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6"/>':name==='projects'?'<rect x="3" y="4" width="7" height="7" rx="2"/><rect x="14" y="4" width="7" height="7" rx="2"/><rect x="3" y="15" width="7" height="5" rx="2"/><rect x="14" y="15" width="7" height="5" rx="2"/>':'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M22 12h-3"/>';
function shell(active,body){
  return `<!doctype html><html lang="ko" data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>DividendOS ${active} QA</title><style>${styles}</style><body><main class="app"><header class="topbar"><div class="brand-wrap"><div class="eyebrow">Dividend Recovery &amp; Income</div><h1 class="brand">Dividend <span>OS</span></h1></div><div class="topbar-actions"><div class="currency-picker"><button>$</button><button class="active">원</button></div><div class="save-pill">테스트</div><button class="top-icon-btn" aria-label="설정">⚙</button></div></header><section class="page active">${body}</section></main><nav class="bottom-nav">${[['home','홈'],['projects','포트폴리오'],['goal','목표']].map(([key,label])=>`<button class="nav-btn ${active===key?'active':''}"><svg viewBox="0 0 24 24">${icon(key)}</svg><span>${label}</span></button>`).join('')}</nav></body></html>`;
}

views.renderHome();
await fs.writeFile(path.join(output,'home.html'),shell('home',elements.get('page-home').innerHTML));
views.renderProjects();
await fs.writeFile(path.join(output,'portfolio-high-yield.html'),shell('projects',elements.get('page-projects').innerHTML));
portfolioCategory='growth';selectedProjectId='demo-schd';views.renderProjects();
await fs.writeFile(path.join(output,'portfolio-growth.html'),shell('projects',elements.get('page-projects').innerHTML));
portfolioCategory='dividend';selectedProjectId='demo-ko';views.renderProjects();
await fs.writeFile(path.join(output,'portfolio-dividend.html'),shell('projects',elements.get('page-projects').innerHTML));
homeMode='year';homeYearRange='all';views.renderHome();
await fs.writeFile(path.join(output,'home-years.html'),shell('home',elements.get('page-home').innerHTML));
views.renderGoals();
await fs.writeFile(path.join(output,'goal.html'),shell('goal',elements.get('page-goal').innerHTML));

console.log(output);
