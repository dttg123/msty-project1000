import { PROJECT_COLORS } from './constants.js';
import { clone, n, todayISO, uid } from './utils.js';

export function blankRecovery() {
  return { locked:false, basis:0, startDate:'', targetReachedDate:'', calculatedBasisAtLock:0, confirmedAt:'' };
}

const HIGH_YIELD_SYMBOLS = new Set(['MSTY','CONY','NVDY','TSLY','ULTY','YMAX','YMAG','AMZY','APLY','GOOY','NFLY','OARK']);
const DIVIDEND_GROWTH_SYMBOLS = new Set(['SCHD','VIG','DGRO','DGRW','NOBL','KO','PEP','PG','JNJ','MCD','O','LOW','HD']);
export function inferProjectCategory(symbol='') {
  const normalized=String(symbol).toUpperCase();
  if(HIGH_YIELD_SYMBOLS.has(normalized))return 'highYield';
  if(DIVIDEND_GROWTH_SYMBOLS.has(normalized))return 'growth';
  return 'dividend';
}

export function blankProject(symbol = 'MSTY', name = 'YieldMax MSTR Option Income') {
  return {
    id: `p-${symbol.toLowerCase()}-${Date.now()}`,
    symbol: symbol.toUpperCase(), name, tag: symbol === 'MSTY' ? 'PROJECT1000' : '배당 프로젝트',
    targetUnits: symbol === 'MSTY' ? 1000 : 500, monthlyPlanShares:0, projectStart:todayISO(),
    currentPrice:0, priceSource:'manual', priceUpdatedAt:'', distributionFrequency:symbol === 'MSTY' ? 'weekly' : 'monthly',
    initialDividendBalance:0, initialDividendBalanceDate:'', afterGoalMode:'cashflow',
    recovery:blankRecovery(), category:inferProjectCategory(symbol), colorIndex:0, archived:false
  };
}

export function blankState() {
  const project = blankProject();
  return {
    version:4,
    settings:{ exchangeRate:1370, exchangeRateMode:'manual', displayCurrency:'USD', targetMonthlyDividend:500, warningKRW:18000000, thresholdKRW:20000000, appearance:'system' },
    projects:[project], trades:[], dividends:[], splits:[], cashAdjustments:[],
    integrations:{ toss:{ status:'not_connected', lastSyncAt:'', lastSuccessfulAt:'', lastAttemptAt:'', lastError:'', accountLabel:'', candidates:[], dividendCandidates:[], holdings:[], comparisons:[], ignoredCount:0, matchedExistingCount:0, matchedExistingDividendCount:0, unsupportedCurrencyCount:0, historyTruncated:false, syncSequence:0, sourceLedger:{orders:[],dividends:[]} } },
    meta:{ createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), lastBackupAt:'', lastLocalSaveAt:'', lastCloudSaveAt:'', migratedFrom:'', migrationCheckedAt:'', celebratedMilestones:[] }
  };
}

export function repairLegacy(raw) {
  if (!raw || raw.meta?.ledgerRepairV321) return raw;
  const dividends = Array.isArray(raw.dividends) ? raw.dividends : [];
  const trades = Array.isArray(raw.trades) ? raw.trades : [];
  const near = (a,b) => Math.abs(n(a)-n(b)) <= .011;
  const hasDividend = (date, amount) => dividends.some(d => d.date===date && near(d.amountUSD,amount));
  const t1 = trades.find(t => t.type==='buy' && t.date==='2026-07-25' && t.buyType==='mixed' && near(t.reinvestAmountUSD,40.77) && near(n(t.shares)*n(t.price),49.32));
  const t2 = trades.find(t => t.type==='buy' && t.date==='2026-08-05' && t.buyType==='reinvest' && near(n(t.shares)*n(t.price),38.49));
  const t3 = trades.find(t => t.type==='buy' && t.date==='2026-08-13' && t.buyType==='reinvest' && near(n(t.shares)*n(t.price),36.51));
  if (!(hasDividend('2026-07-24',40.77) && hasDividend('2026-07-31',41.36) && hasDividend('2026-08-07',39.30) && t1 && t2 && t3)) return raw;
  raw.settings = raw.settings || {};
  raw.settings.initialDividendBalance = 10.78;
  raw.settings.initialDividendBalanceDate = '2026-07-23';
  Object.assign(t1,{date:'2026-07-28',buyType:'reinvest',shares:4,price:12.3475,reinvestAmountUSD:0});
  Object.assign(t2,{date:'2026-08-07',buyType:'reinvest',shares:3,price:12.84,reinvestAmountUSD:0});
  Object.assign(t3,{date:'2026-08-17',buyType:'reinvest',shares:3,price:12.19,reinvestAmountUSD:0});
  raw.meta = {...(raw.meta || {}), ledgerRepairV321:new Date().toISOString()};
  return raw;
}

export function migrateLegacy(input) {
  const raw = repairLegacy(clone(input));
  const state = blankState();
  const project = state.projects[0];
  project.id = 'p-msty';
  project.targetUnits = Math.max(.000001,n(raw.settings?.targetUnits) || 1000);
  project.monthlyPlanShares = Math.max(0,n(raw.settings?.monthlyPlanShares));
  project.projectStart = raw.settings?.projectStart || todayISO();
  project.currentPrice = Math.max(0,n(raw.settings?.currentPrice));
  project.initialDividendBalance = Math.max(0,n(raw.settings?.initialDividendBalance));
  project.initialDividendBalanceDate = raw.settings?.initialDividendBalanceDate || '';
  project.recovery = {...blankRecovery(), ...(raw.recovery || {})};
  state.settings.exchangeRate = Math.max(0,n(raw.settings?.exchangeRate) || 1370);
  state.settings.displayCurrency = raw.settings?.showKRW === false ? 'USD' : 'KRW';
  state.settings.warningKRW = Math.max(0,n(raw.settings?.warningKRW) || 18000000);
  state.settings.thresholdKRW = Math.max(1,n(raw.settings?.thresholdKRW) || 20000000);
  state.settings.appearance = raw.settings?.appearance || 'system';
  state.trades = (raw.trades || []).map(row => ({...row, projectId:project.id, symbol:'MSTY'}));
  state.dividends = (raw.dividends || []).map(row => ({...row, projectId:project.id, symbol:'MSTY'}));
  state.splits = (raw.splits || []).map(row => ({...row, projectId:project.id, symbol:'MSTY'}));
  state.meta = {...state.meta, ...(raw.meta || {}), migratedFrom:'MSTY PROJECT1000 V3.2.1', migrationCheckedAt:new Date().toISOString()};
  state.version = 4;
  return state;
}

export function normalizeV4(raw) {
  const base = blankState();
  const result = {...base, ...raw};
  result.version = 4;
  result.settings = {...base.settings, ...(raw.settings || {})};
  result.projects = Array.isArray(raw.projects) ? raw.projects.map((project,index) => ({
    ...blankProject(project.symbol || `ASSET${index+1}`,project.name || project.symbol || '배당 종목'), ...project,
    id:project.id || uid('p'), symbol:String(project.symbol || `ASSET${index+1}`).toUpperCase(),
    recovery:{...blankRecovery(), ...(project.recovery || {})}, category:['dividend','growth','highYield'].includes(project.category)?project.category:inferProjectCategory(project.symbol), colorIndex:Number.isInteger(project.colorIndex) ? project.colorIndex : index % PROJECT_COLORS.length
  })) : base.projects;
  for (const key of ['trades','dividends','splits','cashAdjustments']) result[key] = Array.isArray(raw[key]) ? raw[key] : [];
  result.integrations = {toss:{...base.integrations.toss, ...(raw.integrations?.toss || {}),sourceLedger:{...base.integrations.toss.sourceLedger,...(raw.integrations?.toss?.sourceLedger||{})}}};
  result.meta = {...base.meta, ...(raw.meta || {})};
  return result;
}

export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return blankState();
  if (Array.isArray(raw.projects) || n(raw.version) >= 4) return normalizeV4(raw);
  if (Array.isArray(raw.trades) && Array.isArray(raw.dividends)) return migrateLegacy(raw);
  return blankState();
}
