import type {decodeAppState} from '../modules/state-decoder.js';
import type { AppState, Trade } from './domain.js';
import type { createPortfolioEngine, ProjectCalculation } from '../modules/portfolio.js';
import type { incomeEstimate } from '../modules/income.js';
import type { readStateFromBackupFile } from '../backup.js';
import type { TossSnapshotPayload } from '../toss-client.js';
import type { normalizeTossOrder, normalizeTossDividend, buildTossSync } from '../modules/toss.js';
import type { ViewContext } from '../modules/views.js';
import type { summarizeLegacyState } from '../modules/migration.js';
import type { User } from 'firebase/auth';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends (1 & T) ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
// Prevent a future refactor from silently reopening these boundaries with unchecked types.
type StateIsTyped = Assert<Equal<IsAny<AppState>, false>>;
type TradeQuantityIsNumeric = Assert<Equal<Trade['shares'], number>>;
type EngineInputIsState = Assert<Equal<ReturnType<Parameters<typeof createPortfolioEngine>[0]>, AppState>>;
type CalculationIsTyped = Assert<Equal<IsAny<ProjectCalculation>, false>>;
type CalculatedSharesAreNumeric = Assert<Equal<ProjectCalculation['shares'], number>>;
type CalculatedTradesAreTyped = Assert<Equal<ProjectCalculation['trades'], Trade[]>>;
type IncomePaymentIsTyped = Assert<Equal<IsAny<ReturnType<typeof incomeEstimate>['payments'][number]>, false>>;
type RestoredDataNeedsValidation = Assert<Equal<Awaited<ReturnType<typeof readStateFromBackupFile>>, unknown>>;
type TossRawRowNeedsValidation = Assert<Equal<TossSnapshotPayload['orders'][number], Record<string, unknown>>>;
type GoogleIdentityIsTyped = Assert<Equal<IsAny<User['uid']>, false>>;

type TossNormalizerAcceptsUnknown = Assert<Equal<Parameters<typeof normalizeTossOrder>[0], unknown>>;
type TossSharesAreNumeric = Assert<Equal<NonNullable<ReturnType<typeof normalizeTossOrder>>['shares'], number>>;
type TossDividendAmountIsNumeric = Assert<Equal<NonNullable<ReturnType<typeof normalizeTossDividend>>['amountUSD'], number>>;
type TossCandidateIsTyped = Assert<Equal<IsAny<ReturnType<typeof buildTossSync>['candidates'][number]>, false>>;
type ViewStateIsTyped = Assert<Equal<ReturnType<ViewContext['getState']>, AppState>>;
type LegacyAuditBasisIsNumeric = Assert<Equal<ReturnType<typeof summarizeLegacyState>['costBasis'], number>>;
type DecoderAcceptsUnknown = Assert<Equal<Parameters<typeof decodeAppState>[0],unknown>>;
type DecoderProducesState = Assert<Equal<ReturnType<typeof decodeAppState>,AppState>>;
export {};
