import { PROJECT_COLORS } from './constants.js';
import { clone, n, todayISO, uid } from './utils.js';

export function blankRecovery(): any {
  return { locked:false, basis:0, startDate:'', targetReachedDate:'', calculatedBasisAtLock:0, confirmedAt:'', method:'withdrawnOnly' };
}

const HIGH_YIELD_SYMBOLS: any = new Set(['MSTY','CONY','NVDY','TSLY','ULTY','YMAX','YMAG','AMZY','APLY','GOOY','NFLY','OARK']);
const DIVIDEND_GROWTH_SYMBOLS: any = new Set(['SCHD','VIG','DGRO','DGRW','NOBL','KO','PEP','PG','JNJ','MCD','O','LOW','HD']);
export function inferProjectCategory(symbol: any =''): any {
  const normalized: any=String(symbol).toUpperCase();
  if(HIGH_YIELD_SYMBOLS.has(normalized))return 'highYield';
  if(DIVIDEND_GROWTH_SYMBOLS.has(normalized))return 'growth';
  return 'dividend';
}

export function blankProject(symbol: any = 'MSTY', name: any = 'YieldMax MSTR Option Income'): any {
  const id: any=`p-${symbol.toLowerCase()}-${Date.now()}`;
  return {
    id, securityId:`local:${id}`,
    symbol: symbol.toUpperCase(), name, tag:'배당 프로젝트',
    targetUnits:500, monthlyPlanShares:0, projectStart:todayISO(),
    currentPrice:0, priceSource:'manual', priceUpdatedAt:'', distributionFrequency:symbol === 'MSTY' ? 'weekly' : 'monthly', distributionFrequencyMode:'auto',
    initialDividendBalance:0, initialDividendBalanceDate:'', afterGoalMode:'cashflow',
    recovery:blankRecovery(), category:inferProjectCategory(symbol), brokerLinks:[], status:'active', corporateActions:[], colorIndex:0, archived:false
  };
}

export function blankState(): any {
  const project: any = blankProject();
  return {
    version:4, schemaVersion:4,
    settings:{ exchangeRate:1370, exchangeRateMode:'manual', displayCurrency:'KRW', targetMonthlyDividend:500, warningKRW:18000000, thresholdKRW:20000000, appearance:'system' },
    projects:[project], trades:[], dividends:[], splits:[], cashAdjustments:[],
    integrations:{ toss:{ status:'not_connected', lastSyncAt:'', lastSuccessfulAt:'', lastPartialAt:'', lastAttemptAt:'', lastError:'', accountLabel:'', accountScopeId:'', syncCursor:{ordersThrough:''}, syncStatus:'', accountResults:[], failedAccountCount:0, capabilities:{orders:false,holdings:false,prices:false,dividends:false}, candidates:[], dividendCandidates:[], correctionCandidates:[], dividendCorrectionCandidates:[], holdings:[], comparisons:[], ignoredCount:0, matchedExistingCount:0, matchedExistingDividendCount:0, unsupportedCurrencyCount:0, historyTruncated:false, syncSequence:0, sourceLedger:{orders:[],dividends:[]} } },
    meta:{ createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), lastBackupAt:'', lastLocalSaveAt:'', lastCloudSaveAt:'', migratedFrom:'', migrationCheckedAt:'', celebratedMilestones:[] }
  };
}

export function repairLegacy(raw: any): any {
  if (!raw || raw.meta?.ledgerRepairV321) return raw;
  const dividends: any = Array.isArray(raw.dividends) ? raw.dividends : [];
  const trades: any = Array.isArray(raw.trades) ? raw.trades : [];
  const near: any = (a: any,b: any) => Math.abs(n(a)-n(b)) <= .011;
  const hasDividend: any = (date: any, amount: any) => dividends.some((d: any) => d.date===date && near(d.amountUSD,amount));
  const t1: any = trades.find((t: any) => t.type==='buy' && t.date==='2026-07-25' && t.buyType==='mixed' && near(t.reinvestAmountUSD,40.77) && near(n(t.shares)*n(t.price),49.32));
  const t2: any = trades.find((t: any) => t.type==='buy' && t.date==='2026-08-05' && t.buyType==='reinvest' && near(n(t.shares)*n(t.price),38.49));
  const t3: any = trades.find((t: any) => t.type==='buy' && t.date==='2026-08-13' && t.buyType==='reinvest' && near(n(t.shares)*n(t.price),36.51));
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

export function migrateLegacy(input: any): any {
  const raw: any = repairLegacy(clone(input));
  const state: any = blankState();
  const project: any = state.projects[0];
  project.id = 'p-msty';
  project.securityId = 'local:p-msty';
  project.targetUnits = Math.max(.000001,n(raw.settings?.targetUnits) || 500);
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
  state.trades = (raw.trades || []).map((row: any) => ({...row, projectId:project.id, symbol:'MSTY'}));
  state.dividends = (raw.dividends || []).map((row: any) => ({...row, projectId:project.id, symbol:'MSTY'}));
  state.splits = (raw.splits || []).map((row: any) => ({...row, projectId:project.id, symbol:'MSTY'}));
  state.meta = {...state.meta, ...(raw.meta || {}), migratedFrom:'legacy-v3.2.1', migrationCheckedAt:new Date().toISOString()};
  state.version = 4;
  return state;
}

export function normalizeV4(raw: any): any {
  const base: any = blankState();
  const result: any = {...base, ...raw};
  result.version = 4;
  result.schemaVersion = 4;
  result.settings = {...base.settings, ...(raw.settings || {})};
  result.projects = Array.isArray(raw.projects) ? raw.projects.map((project: any,index: any) => {
    const id: any=project.id||uid('p'),links=Array.isArray(project.brokerLinks)?project.brokerLinks.filter((link: any)=>link&&link.provider&&link.assetKey):[];
    const linkedSecurityId: any=links.find((link: any)=>link.securityId)?.securityId;
    return {
      ...blankProject(project.symbol || `ASSET${index+1}`,project.name || project.symbol || '배당 종목'), ...project,
      id,securityId:String(project.securityId||linkedSecurityId||`local:${id}`),symbol:String(project.symbol || `ASSET${index+1}`).toUpperCase(),tag:/^PROJECT\s*1000$/i.test(String(project.tag||''))?'배당 프로젝트':(project.tag||'배당 프로젝트'),
      recovery:{...blankRecovery(), ...(project.recovery || {})},category:['dividend','growth','highYield'].includes(project.category)?project.category:inferProjectCategory(project.symbol),distributionFrequencyMode:project.distributionFrequencyMode==='manual'?'manual':'auto',brokerLinks:links,status:['active','inactive','liquidated'].includes(project.status)?project.status:'active',corporateActions:Array.isArray(project.corporateActions)?project.corporateActions:[],colorIndex:Number.isInteger(project.colorIndex) ? project.colorIndex : index % PROJECT_COLORS.length
    };
  }) : base.projects;
  for (const key of ['trades','dividends','splits','cashAdjustments']) result[key] = Array.isArray(raw[key]) ? raw[key] : [];
  result.integrations = {toss:{...base.integrations.toss, ...(raw.integrations?.toss || {}),syncCursor:{...base.integrations.toss.syncCursor,...(raw.integrations?.toss?.syncCursor||{})},capabilities:{...base.integrations.toss.capabilities,...(raw.integrations?.toss?.capabilities||{})},sourceLedger:{...base.integrations.toss.sourceLedger,...(raw.integrations?.toss?.sourceLedger||{})}}};
  result.meta = {...base.meta, ...(raw.meta || {})};
  return result;
}

export function migrate(raw: any): any {
  if (!raw || typeof raw !== 'object') return blankState();
  if (Array.isArray(raw.projects) || n(raw.version) >= 4) return normalizeV4(raw);
  if (Array.isArray(raw.trades) && Array.isArray(raw.dividends)) return migrateLegacy(raw);
  return blankState();
}
