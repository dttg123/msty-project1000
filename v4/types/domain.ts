export type Currency = 'USD' | 'KRW';
export type ProjectCategory = 'dividend' | 'growth' | 'highYield';
export type DistributionFrequency = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';
export type DividendStatus = 'actual' | 'confirmed' | 'estimated';
export type ImportProvider = 'manual' | 'toss';
export type BuyType = 'direct' | 'reinvest' | 'mixed' | 'opening';
export type SecurityStatus = 'active' | 'inactive' | 'liquidated';

export interface SourceRef {
  provider: ImportProvider;
  externalId?: string;
  sourceId?: string;
  rawExternalId?: string;
  sourceIdKind?: 'source' | 'fingerprint';
  sourceFingerprint?: string;
  status?: string;
  accountId?: string;
  assetKey?: string;
  market?: string;
  securityId?: string;
  importedAt?: string;
  filledAt?: string;
  adoptedManual?: boolean;
}

export interface LedgerRow {
  source?: SourceRef;
  symbol?: string;
  note?: string;
  createdAt?: string;
  importSource?: string;
  sourceId?: string;
}

export interface BuyTrade extends LedgerRow {
  id: string;
  projectId: string;
  date: string;
  type: 'buy';
  buyType: BuyType;
  reinvestAmountUSD?: number;
  shares: number;
  price: number;
  feeUSD?: number;
  taxUSD?: number;
  source?: SourceRef;
}

export interface SellTrade extends LedgerRow {
  id: string;
  projectId: string;
  date: string;
  type: 'sell';
  buyType?: BuyType | '';
  reinvestAmountUSD?: number;
  shares: number;
  price: number;
  feeUSD?: number;
  taxUSD?: number;
  source?: SourceRef;
}

export type Trade = BuyTrade | SellTrade;

export interface RecoveryPlan {
  locked: boolean;
  basis: number;
  startDate: string;
  targetReachedDate: string;
  calculatedBasisAtLock: number;
  confirmedAt: string;
  method: 'withdrawnOnly';
}

export interface Project {
  id: string;
  securityId: string;
  symbol: string;
  name: string;
  tag: string;
  currency?: Currency;
  category: ProjectCategory;
  targetUnits: number;
  monthlyPlanShares: number;
  projectStart: string;
  currentPrice: number;
  priceSource: 'manual' | 'toss';
  priceUpdatedAt: string;
  distributionFrequency: DistributionFrequency;
  distributionFrequencyMode: 'auto' | 'manual';
  initialDividendBalance: number;
  initialDividendBalanceDate: string;
  afterGoalMode: 'cashflow' | 'reinvest';
  recovery: RecoveryPlan;
  brokerLinks: Array<{provider:'toss';assetKey:string;market?:string;securityId?:string}>;
  status: SecurityStatus;
  corporateActions: CorporateAction[];
  dividendAnnouncement?: {exDate:string;payDate:string;sourceURL:string;recordedAt:string;verification:'user'} | null;
  colorIndex: number;
  archived: boolean;
}

export interface CorporateAction {
  id: string;
  type: 'tickerChange' | 'liquidation';
  effectiveDate: string;
  fromSymbol?: string;
  toSymbol?: string;
  grossProceedsUSD?: number;
  feeUSD?: number;
  taxUSD?: number;
  createdAt: string;
}

export interface DividendRecord extends LedgerRow {
  id: string;
  projectId: string;
  date: string;
  status?: DividendStatus;
  amountUSD: number;
  currency?: Currency;
  amountKRW?: number;
  grossAmountUSD?: number;
  withholdingTaxUSD?: number;
  feeUSD?: number;
  netAmountUSD?: number;
  taxUSD?: number;
  rocAmountUSD?: number;
  rocPercent?: number | null;
  rocStatus?: 'none' | 'estimated' | 'confirmed' | 'final';
  sharesAtPayment?: number;
  referencePrice?: number;
  source?: SourceRef;
}

export interface TradeCashBreakdown {
  executionAmountUSD: number;
  feeUSD: number;
  taxUSD: number;
  grossBuyCostUSD: number;
  netSellProceedsUSD: number;
}

export interface DividendCashBreakdown {
  netKRW?: number;
  grossUSD: number;
  withholdingTaxUSD: number;
  feeUSD: number;
  netUSD: number;
  rocUSD: number;
  incomeUSD: number;
  status: DividendStatus;
}

export interface SplitRecord extends LedgerRow {
  type?: 'forward'|'reverse'|'split';
  id: string;
  projectId: string;
  symbol?: string;
  date: string;
  from: number;
  to: number;
  createdAt?: string;
}

export interface CashAdjustment extends LedgerRow {
  id: string;
  projectId: string;
  symbol?: string;
  date: string;
  amountUSD: number;
  purpose?: 'recoveryWithdrawal' | 'balanceAdjustment';
  label?: string;
  note?: string;
  createdAt?: string;
}

export interface AppState {
  version: 4;
  schemaVersion: 4;
  settings: AppSettings;
  projects: Project[];
  trades: Trade[];
  dividends: DividendRecord[];
  splits: SplitRecord[];
  cashAdjustments: CashAdjustment[];
  integrations: {toss: TossIntegrationState};
  meta: AppMetadata;
}

export interface TossSnapshot {
  accountScopeId: string;
  syncStatus: 'complete' | 'partial';
  syncCursor: Record<string, unknown>;
  capabilities: Record<string, boolean>;
  holdings: unknown[];
  prices: unknown[];
  orders: unknown[];
  dividends: unknown[];
  accountResults: unknown[];
}

export interface TossIntegrationState {
  status: 'not_connected' | 'connected' | 'error' | 'syncing' | 'partial';
  lastSyncAt: string;
  lastSuccessfulAt: string;
  lastPartialAt: string;
  lastAttemptAt: string;
  lastError: string;
  accountScopeId: string;
  syncCursor: Record<string, unknown>;
  syncStatus: '' | 'complete' | 'partial';
  capabilities: Record<string, boolean>;
  sourceLedger: {orders: unknown[];dividends: unknown[]};
  candidates: Record<string,unknown>[];
  dividendCandidates: Record<string,unknown>[];
  correctionCandidates: Record<string,unknown>[];
  dividendCorrectionCandidates: Record<string,unknown>[];
  holdings: Record<string,unknown>[];
  comparisons: Record<string,unknown>[];
  accountResults: Record<string,unknown>[];
  failedAccountCount: number;
  historyTruncated: boolean;
  dismissedExceptionKeys?: string[];
  syncMilestones?: string[];
  [key: string]: unknown;
}

export interface CloudRevisionManifest {
  storageFormat: string;
  revision: number;
  revisionId: string;
  stateHash: string;
  segmentCount: number;
  createdAt: string;
}

export interface BackupEnvelope<TState> {
  product: 'DividendOS';
  appVersion: string;
  dataSchemaVersion: number;
  exportedAt: string;
  format: 'portable-app-backup-v1' | 'portable-app-backup-v2';
  counts?: { securities: number; trades: number; dividends: number; splits: number; cashAdjustments: number };
  integrity?: { algorithm: 'SHA-256'; hash: string };
  state: TState;
}

export interface AppSettings {
  exchangeRate: number;
  exchangeRateMode: 'manual' | 'auto';
  displayCurrency: Currency;
  targetMonthlyDividend: number;
  warningKRW: number;
  thresholdKRW: number;
  appearance: 'system' | 'light' | 'dark';
  exchangeRateDate?: string;
  exchangeRateUpdatedAt?: string;
  exchangeRateSource?: string;
}
export interface AppMetadata {
  createdAt: string;
  updatedAt: string;
  lastBackupAt: string;
  lastLocalSaveAt: string;
  lastCloudSaveAt: string;
  migratedFrom: string;
  migrationCheckedAt: string;
  celebratedMilestones: string[];
  lastBackupPreparedAt?: string;
  lastCloudAttemptAt?: string;
  lastDividendReplacementFingerprint?: string;
  legacyMigrationAvailable?: boolean;
  migrationAudit?: import('../modules/migration.js').MigrationAudit | null;
  ledgerRepairV321?: string;
  demo?: boolean;
  demoAsOf?: string;
  lastAuthoritativeMstyImportAt?: string;
}
export type LedgerCollection = 'trades'|'dividends'|'splits'|'cashAdjustments';
export type DatedRow = {id:string;date:string;createdAt?:string};
export type PortfolioEvent = (Trade & {eventType:'trade'}) | (SplitRecord & {eventType:'split'}) | (DividendRecord & {eventType:'roc'});
export type MilestoneDates = Record<25|50|75|100,string>;
