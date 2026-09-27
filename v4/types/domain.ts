export type Currency = 'USD' | 'KRW';
export type ProjectCategory = 'dividend' | 'growth' | 'highYield';
export type DistributionFrequency = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';
export type DividendStatus = 'actual' | 'confirmed' | 'estimated';
export type ImportProvider = 'manual' | 'toss';

export interface SourceRef {
  provider: ImportProvider;
  externalId?: string;
  rawExternalId?: string;
  accountId?: string;
  assetKey?: string;
  importedAt?: string;
}

export interface BuyTrade {
  id: string;
  projectId: string;
  date: string;
  type: 'buy';
  buyType: 'direct' | 'reinvest' | 'mixed' | 'opening';
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

export interface DividendRecord {
  id: string;
  projectId: string;
  date: string;
  status: DividendStatus;
  grossAmountUSD?: number;
  withholdingTaxUSD?: number;
  feeUSD?: number;
  netAmountUSD: number;
  rocAmountUSD?: number;
  sharesAtPayment?: number;
  source?: SourceRef;
}

export interface BackupEnvelope<TState> {
  product: 'DividendOS';
  appVersion: string;
  dataSchemaVersion: number;
  exportedAt: string;
  format: 'portable-app-backup-v1';
  state: TState;
}
