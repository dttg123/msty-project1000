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
  rawExternalId?: string;
  sourceIdKind?: 'source' | 'fingerprint';
  sourceFingerprint?: string;
  status?: string;
  accountId?: string;
  assetKey?: string;
  market?: string;
  securityId?: string;
  importedAt?: string;
}

export interface BuyTrade {
  id: string;
  projectId: string;
  date: string;
  type: 'buy';
  buyType: BuyType;
  shares: number;
  price: number;
  feeUSD?: number;
  taxUSD?: number;
  source?: SourceRef;
}

export interface SellTrade {
  id: string;
  projectId: string;
  date: string;
  type: 'sell';
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
  afterGoalMode: 'cashflow' | 'continue';
  recovery: RecoveryPlan;
  brokerLinks: Array<{provider:'toss';assetKey:string;market?:string;securityId?:string}>;
  status: SecurityStatus;
  corporateActions: CorporateAction[];
  dividendAnnouncement?: {exDate:string;payDate:string;sourceURL:string;recordedAt:string;verification:'user'};
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

export interface DividendRecord {
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
  rocPercent?: number;
  rocStatus?: 'none' | 'estimated' | 'confirmed' | 'final';
  sharesAtPayment?: number;
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

export interface SplitRecord {
  id: string;
  projectId: string;
  symbol?: string;
  date: string;
  from: number;
  to: number;
  createdAt?: string;
}

export interface CashAdjustment {
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
  settings: Record<string, unknown>;
  projects: Project[];
  trades: Trade[];
  dividends: DividendRecord[];
  splits: SplitRecord[];
  cashAdjustments: CashAdjustment[];
  integrations: {toss: TossIntegrationState};
  meta: Record<string, unknown>;
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
  status: 'not_connected' | 'connected' | 'error';
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
