import type {AppState,Project,ProjectCategory,RecoveryPlan} from '../types/domain.js';
import { PROJECT_COLORS } from './constants.js';
import { clone, isRecord, n, todayISO, uid } from './utils.js';

export function blankRecovery(): RecoveryPlan {
  return { locked:false, basis:0, startDate:'', targetReachedDate:'', calculatedBasisAtLock:0, confirmedAt:'', method:'withdrawnOnly' };
}

const HIGH_YIELD_SYMBOLS = new Set(['MSTY','CONY','NVDY','TSLY','ULTY','YMAX','YMAG','AMZY','APLY','GOOY','NFLY','OARK']);
const DIVIDEND_GROWTH_SYMBOLS = new Set(['SCHD','VIG','DGRO','DGRW','NOBL','KO','PEP','PG','JNJ','MCD','O','LOW','HD']);
export function inferProjectCategory(symbol: unknown =''): ProjectCategory {
  const normalized=String(symbol).toUpperCase();
  if(HIGH_YIELD_SYMBOLS.has(normalized))return 'highYield';
  if(DIVIDEND_GROWTH_SYMBOLS.has(normalized))return 'growth';
  return 'dividend';
}

export function blankProject(symbol: string = 'MSTY', name: string = 'YieldMax MSTR Option Income'): Project {
  const id=`p-${symbol.toLowerCase()}-${Date.now()}`;
  return {
    id, securityId:`local:${id}`,
    symbol: symbol.toUpperCase(), name, tag:'배당 프로젝트',
    targetUnits:500, monthlyPlanShares:0, projectStart:todayISO(),
    currentPrice:0, priceSource:'manual', priceUpdatedAt:'', distributionFrequency:symbol === 'MSTY' ? 'weekly' : 'monthly', distributionFrequencyMode:'auto',
    initialDividendBalance:0, initialDividendBalanceDate:'', afterGoalMode:'cashflow',
    recovery:blankRecovery(), category:inferProjectCategory(symbol), brokerLinks:[], status:'active', corporateActions:[], colorIndex:0, archived:false
  };
}

export function blankState(): AppState {
  const project = blankProject();
  return {
    version:4, schemaVersion:4,
    settings:{ exchangeRate:1370, exchangeRateMode:'manual', displayCurrency:'KRW', targetMonthlyDividend:500, warningKRW:18000000, thresholdKRW:20000000, appearance:'system' },
    projects:[project], trades:[], dividends:[], splits:[], cashAdjustments:[],
    integrations:{ toss:{ status:'not_connected', lastSyncAt:'', lastSuccessfulAt:'', lastPartialAt:'', lastAttemptAt:'', lastError:'', accountLabel:'', accountScopeId:'', syncCursor:{ordersThrough:''}, syncStatus:'', accountResults:[], failedAccountCount:0, capabilities:{orders:false,holdings:false,prices:false,dividends:false}, candidates:[], dividendCandidates:[], correctionCandidates:[], dividendCorrectionCandidates:[], holdings:[], comparisons:[], ignoredCount:0, matchedExistingCount:0, matchedExistingDividendCount:0, unsupportedCurrencyCount:0, historyTruncated:false, syncSequence:0, sourceLedger:{orders:[],dividends:[]} } },
    meta:{ createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), lastBackupAt:'', lastLocalSaveAt:'', lastCloudSaveAt:'', migratedFrom:'', migrationCheckedAt:'', celebratedMilestones:[] }
  };
}

type RawRecord = Record<string, unknown>;
const record = (value: unknown): RawRecord => isRecord(value)?value:{};
const legacyRows = (value: unknown): RawRecord[] => Array.isArray(value)?value.filter(isRecord):[];

export function repairLegacy(input: unknown) {
  const raw=record(input);
  if (!raw || record(raw.meta).ledgerRepairV321) return raw;
  const dividends = legacyRows(raw.dividends);
  const trades = legacyRows(raw.trades);
  const near = (a: unknown,b: unknown) => Math.abs(n(a)-n(b)) <= .011;
  const hasDividend = (date: unknown, amount: unknown) => dividends.some((d) => d.date===date && near(d.amountUSD,amount));
  const t1 = trades.find((t) => t.type==='buy' && t.date==='2026-07-25' && t.buyType==='mixed' && near(t.reinvestAmountUSD,40.77) && near(n(t.shares)*n(t.price),49.32));
  const t2 = trades.find((t) => t.type==='buy' && t.date==='2026-08-05' && t.buyType==='reinvest' && near(n(t.shares)*n(t.price),38.49));
  const t3 = trades.find((t) => t.type==='buy' && t.date==='2026-08-13' && t.buyType==='reinvest' && near(n(t.shares)*n(t.price),36.51));
  if (!(hasDividend('2026-07-24',40.77) && hasDividend('2026-07-31',41.36) && hasDividend('2026-08-07',39.30) && t1 && t2 && t3)) return raw;
  raw.settings = {...record(raw.settings),initialDividendBalance:10.78,initialDividendBalanceDate:'2026-07-23'};
  Object.assign(t1,{date:'2026-07-28',buyType:'reinvest',shares:4,price:12.3475,reinvestAmountUSD:0});
  Object.assign(t2,{date:'2026-08-07',buyType:'reinvest',shares:3,price:12.84,reinvestAmountUSD:0});
  Object.assign(t3,{date:'2026-08-17',buyType:'reinvest',shares:3,price:12.19,reinvestAmountUSD:0});
  raw.meta = {...record(raw.meta), ledgerRepairV321:new Date().toISOString()};
  return raw;
}

export function migrateLegacy(input: unknown) {
  const raw = repairLegacy(clone(input));
  const state = blankState();
  const settings=record(raw.settings);
  const project = state.projects[0];
  project.id = 'p-msty';
  project.securityId = 'local:p-msty';
  project.targetUnits = Math.max(.000001,n(settings.targetUnits) || 500);
  project.monthlyPlanShares = Math.max(0,n(settings.monthlyPlanShares));
  project.projectStart = String(settings.projectStart || todayISO());
  project.currentPrice = Math.max(0,n(settings.currentPrice));
  project.initialDividendBalance = Math.max(0,n(settings.initialDividendBalance));
  project.initialDividendBalanceDate = String(settings.initialDividendBalanceDate || '');
  project.recovery = {...blankRecovery(), ...record(raw.recovery)};
  state.settings.exchangeRate = Math.max(0,n(settings.exchangeRate) || 1370);
  state.settings.displayCurrency = settings.showKRW === false ? 'USD' : 'KRW';
  state.settings.warningKRW = Math.max(0,n(settings.warningKRW) || 18000000);
  state.settings.thresholdKRW = Math.max(1,n(settings.thresholdKRW) || 20000000);
  const appearance=settings.appearance;
  state.settings.appearance = appearance==='light'||appearance==='dark'?appearance:'system';
  const attachProject=(rows: unknown)=>(Array.isArray(rows)?rows as unknown[]:[]).map(row=>({...record(row),projectId:project.id,symbol:'MSTY'}));
  const trades=attachProject(raw.trades),dividends=attachProject(raw.dividends),splits=attachProject(raw.splits);
  state.meta = {...state.meta, ...record(raw.meta), migratedFrom:'legacy-v3.2.1', migrationCheckedAt:new Date().toISOString()};
  state.version = 4;
  return {...state,trades,dividends,splits};
}

export function normalizeV4(input: unknown) {
  const raw=record(input);
  const base = blankState();
  const result: RawRecord = {...base, ...raw};
  result.version = 4;
  result.schemaVersion = 4;
  result.settings = {...base.settings, ...record(raw.settings)};
  result.projects = Array.isArray(raw.projects) ? raw.projects.map((value: unknown,index: number) => {
    if(!isRecord(value))return value;
    const project=record(value);
    const id=project.id||uid('p'),links=Array.isArray(project.brokerLinks)?project.brokerLinks.filter(isRecord).filter(link=>link.provider&&link.assetKey):[];
    const linkedSecurityId=links.find((link)=>link.securityId)?.securityId;
    return {
      ...blankProject(String(project.symbol || `ASSET${index+1}`),String(project.name || project.symbol || '배당 종목')), ...project,
      id,securityId:String(project.securityId||linkedSecurityId||`local:${id}`),symbol:String(project.symbol || `ASSET${index+1}`).toUpperCase(),tag:/^PROJECT\s*1000$/i.test(String(project.tag||''))?'배당 프로젝트':(project.tag||'배당 프로젝트'),
      recovery:{...blankRecovery(), ...record(project.recovery)},category:['dividend','growth','highYield'].includes(String(project.category))?project.category:inferProjectCategory(project.symbol),distributionFrequencyMode:project.distributionFrequencyMode==='manual'?'manual':'auto',brokerLinks:links,status:['active','inactive','liquidated'].includes(String(project.status))?project.status:'active',corporateActions:Array.isArray(project.corporateActions)?project.corporateActions:[],colorIndex:typeof project.colorIndex==='number'&&Number.isInteger(project.colorIndex) ? project.colorIndex : index % PROJECT_COLORS.length
    };
  }) : base.projects;
  const rows=(key: string): unknown[]=>Array.isArray(raw[key])?raw[key]:[];
  const trades=rows('trades'),dividends=rows('dividends'),splits=rows('splits'),cashAdjustments=rows('cashAdjustments');
  const toss=record(record(raw.integrations).toss);
  result.integrations = {toss:{...base.integrations.toss,...toss,syncCursor:{...base.integrations.toss.syncCursor,...record(toss.syncCursor)},capabilities:{...base.integrations.toss.capabilities,...record(toss.capabilities)},sourceLedger:{...base.integrations.toss.sourceLedger,...record(toss.sourceLedger)}}};
  result.meta = {...base.meta, ...record(raw.meta)};
  return {...result,meta:{...base.meta,...record(raw.meta)},trades,dividends,splits,cashAdjustments};
}

export function migrate(raw: unknown) {
  if (!isRecord(raw)) return blankState();
  if (Array.isArray(raw.projects) || n(raw.version) >= 4) return normalizeV4(raw);
  if (Array.isArray(raw.trades) && Array.isArray(raw.dividends)) return migrateLegacy(raw);
  return blankState();
}
