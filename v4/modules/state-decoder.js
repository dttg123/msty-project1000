import { summarizeLegacyState } from './migration.js';
import { blankState, blankRecovery, migrate } from './state.js';
import { validateLedger } from './validation.js';
import { isRecord } from './utils.js';
const object = (value) => { if (!isRecord(value))
    throw new Error('기록의 객체 구조를 확인해 주세요.'); return value; };
const rows = (value) => { if (value === undefined || value === null)
    return []; if (!Array.isArray(value))
    throw new Error('기록 목록을 확인해 주세요.'); return value.map(object); };
const text = (value, fallback = '') => { if (value === undefined || value === null)
    return fallback; if (typeof value !== 'string')
    throw new Error('기록의 문자 값을 확인해 주세요.'); return value; };
const number = (value) => { if ((typeof value !== 'number' && typeof value !== 'string') || typeof value === 'string' && !value.trim() || !Number.isFinite(Number(value)))
    throw new Error('금액·수량은 유한한 숫자여야 합니다.'); return Number(value); };
const bool = (value, fallback = false) => { if (value === undefined || value === null)
    return fallback; if (typeof value !== 'boolean')
    throw new Error('기록의 선택 값을 확인해 주세요.'); return value; };
const choice = (value, values, fallback) => { if (value === undefined || value === null || value === '')
    return fallback; const found = values.find(item => item === value); if (found === undefined)
    throw new Error('기록의 종류를 확인해 주세요.'); return found; };
const strings = (value) => { if (value === undefined || value === null)
    return []; if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
    throw new Error('기록의 식별자 목록을 확인해 주세요.'); return value; };
function optionalText(row, keys) { for (const key of keys)
    if (row[key] !== undefined)
        row[key] = text(row[key]); }
function isAudit(value) {
    if (!isRecord(value) || typeof value.version !== 'number' || !Number.isFinite(value.version) || typeof value.checkedAt !== 'string' || typeof value.passed !== 'boolean' || !Array.isArray(value.checks) || !isRecord(value.source) || !isRecord(value.target))
        return false;
    const template = summarizeLegacyState({});
    const matches = (row) => Object.entries(template).every(([key, sample]) => typeof row[key] === typeof sample && (typeof sample !== 'number' || Number.isFinite(row[key])));
    return matches(value.source) && matches(value.target) && value.checks.every((check) => isRecord(check) && typeof check.key === 'string' && Object.hasOwn(template, check.key) && typeof check.passed === 'boolean' && ['number', 'string', 'boolean'].includes(typeof check.source) && ['number', 'string', 'boolean'].includes(typeof check.target) && (typeof check.source !== 'number' || Number.isFinite(check.source)) && (typeof check.target !== 'number' || Number.isFinite(check.target)));
}
function source(value) {
    if (value === undefined || value === null)
        return undefined;
    const row = object(value);
    return { ...row, provider: choice(row.provider, ['manual', 'toss'], 'manual'), ...Object.fromEntries(['externalId', 'sourceId', 'rawExternalId', 'sourceFingerprint', 'status', 'accountId', 'assetKey', 'market', 'securityId', 'importedAt'].filter(key => row[key] !== undefined).map(key => [key, text(row[key])])), ...(row.adoptedManual !== undefined ? { adoptedManual: bool(row.adoptedManual) } : {}), ...(row.sourceIdKind !== undefined ? { sourceIdKind: choice(row.sourceIdKind, ['source', 'fingerprint'], 'source') } : {}) };
}
function recovery(value) {
    const row = object(value), base = blankRecovery();
    return { ...row, locked: bool(row.locked), basis: number(row.basis ?? base.basis), startDate: text(row.startDate), targetReachedDate: text(row.targetReachedDate), calculatedBasisAtLock: number(row.calculatedBasisAtLock ?? 0), confirmedAt: text(row.confirmedAt), method: choice(row.method, ['withdrawnOnly'], 'withdrawnOnly') };
}
function action(row) { return { ...row, id: text(row.id), type: choice(row.type, ['tickerChange', 'liquidation'], 'tickerChange'), effectiveDate: text(row.effectiveDate), createdAt: text(row.createdAt), ...optionalNumbers(row, ['grossProceedsUSD', 'feeUSD', 'taxUSD']), ...(row.fromSymbol !== undefined ? { fromSymbol: text(row.fromSymbol) } : {}), ...(row.toSymbol !== undefined ? { toSymbol: text(row.toSymbol) } : {}) }; }
function optionalNumbers(row, keys) {
    const result = {};
    for (const key of keys)
        if (row[key] !== undefined)
            result[key] = row[key] === null || row[key] === '' ? undefined : number(row[key]);
    return result;
}
function project(row) {
    return { ...row, id: text(row.id), securityId: text(row.securityId), symbol: text(row.symbol), name: text(row.name), tag: text(row.tag), category: choice(row.category, ['dividend', 'growth', 'highYield'], 'dividend'), targetUnits: number(row.targetUnits), monthlyPlanShares: number(row.monthlyPlanShares), projectStart: text(row.projectStart), currentPrice: number(row.currentPrice), priceSource: choice(row.priceSource, ['manual', 'toss'], 'manual'), priceUpdatedAt: text(row.priceUpdatedAt), distributionFrequency: choice(row.distributionFrequency, ['weekly', 'monthly', 'quarterly', 'semiannual', 'annual'], 'monthly'), distributionFrequencyMode: choice(row.distributionFrequencyMode, ['auto', 'manual'], 'auto'), initialDividendBalance: number(row.initialDividendBalance), initialDividendBalanceDate: text(row.initialDividendBalanceDate), afterGoalMode: choice(row.afterGoalMode, ['cashflow', 'continue'], 'cashflow'), recovery: recovery(row.recovery), brokerLinks: rows(row.brokerLinks).map(link => ({ ...link, provider: choice(link.provider, ['toss'], 'toss'), assetKey: text(link.assetKey), ...(link.market !== undefined ? { market: text(link.market) } : {}), ...(link.securityId !== undefined ? { securityId: text(link.securityId) } : {}) })), status: choice(row.status, ['active', 'inactive', 'liquidated'], 'active'), corporateActions: rows(row.corporateActions).map(action), colorIndex: number(row.colorIndex), archived: bool(row.archived), ...(row.currency !== undefined ? { currency: choice(row.currency, ['USD', 'KRW'], 'USD') } : {}), ...(row.dividendAnnouncement !== undefined && row.dividendAnnouncement !== null ? { dividendAnnouncement: announcement(object(row.dividendAnnouncement)) } : {}) };
}
function announcement(row) { return { ...row, exDate: text(row.exDate), payDate: text(row.payDate), sourceURL: text(row.sourceURL), recordedAt: text(row.recordedAt), verification: choice(row.verification, ['user'], 'user') }; }
function common(row) { return { ...row, id: text(row.id), projectId: text(row.projectId), date: text(row.date), ...(row.symbol !== undefined ? { symbol: text(row.symbol) } : {}), ...(row.note !== undefined ? { note: text(row.note) } : {}), ...(row.importSource !== undefined ? { importSource: text(row.importSource) } : {}), ...(row.sourceId !== undefined ? { sourceId: text(row.sourceId) } : {}), ...(row.createdAt !== undefined ? { createdAt: text(row.createdAt) } : {}), ...(row.source !== undefined ? { source: source(row.source) } : {}) }; }
function trade(row) {
    const base = { ...common(row), shares: number(row.shares), price: number(row.price), ...optionalNumbers(row, ['feeUSD', 'taxUSD', 'reinvestAmountUSD']) };
    const type = choice(row.type, ['buy', 'sell'], 'buy');
    if (type === 'buy')
        return { ...base, type, buyType: choice(row.buyType, ['direct', 'reinvest', 'mixed', 'opening'], 'direct') };
    return { ...base, type, ...(row.buyType !== undefined && row.buyType !== '' ? { buyType: choice(row.buyType, ['direct', 'reinvest', 'mixed', 'opening'], 'direct') } : { buyType: row.buyType === '' ? '' : undefined }) };
}
function dividend(row) { return { ...common(row), amountUSD: number(row.amountUSD), ...optionalNumbers(row, ['amountKRW', 'grossAmountUSD', 'withholdingTaxUSD', 'feeUSD', 'netAmountUSD', 'taxUSD', 'rocAmountUSD', 'sharesAtPayment', 'referencePrice']), ...(row.currency !== undefined ? { currency: choice(row.currency, ['USD', 'KRW'], 'USD') } : {}), ...(row.status !== undefined ? { status: choice(row.status, ['actual', 'confirmed', 'estimated'], 'actual') } : {}), ...(row.rocStatus !== undefined ? { rocStatus: choice(row.rocStatus, ['none', 'estimated', 'confirmed', 'final'], 'none') } : {}), ...(row.rocPercent !== undefined ? { rocPercent: row.rocPercent === null ? null : number(row.rocPercent) } : {}) }; }
function split(row) { return { ...common(row), from: number(row.from), to: number(row.to), ...(row.type !== undefined ? { type: choice(row.type, ['forward', 'reverse', 'split'], 'forward') } : {}) }; }
function cash(row) { return { ...common(row), amountUSD: number(row.amountUSD), ...(row.purpose !== undefined ? { purpose: choice(row.purpose, ['recoveryWithdrawal', 'balanceAdjustment'], 'balanceAdjustment') } : {}), ...(row.label !== undefined ? { label: text(row.label) } : {}) }; }
function settings(row) { optionalText(row, ['exchangeRateDate', 'exchangeRateUpdatedAt', 'exchangeRateSource']); return { ...row, exchangeRate: number(row.exchangeRate), exchangeRateMode: choice(row.exchangeRateMode, ['manual', 'auto'], 'manual'), displayCurrency: choice(row.displayCurrency, ['USD', 'KRW'], 'KRW'), targetMonthlyDividend: number(row.targetMonthlyDividend), warningKRW: number(row.warningKRW), thresholdKRW: number(row.thresholdKRW), appearance: choice(row.appearance, ['system', 'light', 'dark'], 'system') }; }
// Migration remains a raw-payload operation. Only this checked numeric boundary produces live AppState.
export function decodeAppState(input) {
    const incoming = object(input);
    if (!Array.isArray(incoming.projects) && !(Array.isArray(incoming.trades) && Array.isArray(incoming.dividends)))
        throw new Error('복원할 기록의 구조를 확인해 주세요.');
    for (const key of ['projects', 'trades', 'dividends', 'splits', 'cashAdjustments'])
        if (incoming[key] !== undefined && !Array.isArray(incoming[key]))
            throw new Error('기록 목록을 확인해 주세요.');
    const migrated = migrate(incoming);
    // Old JSON backups used null for absent optional amounts. Copy rows before normalizing absence.
    const optionalAmounts = ['feeUSD', 'taxUSD', 'reinvestAmountUSD', 'amountKRW', 'grossAmountUSD', 'withholdingTaxUSD', 'netAmountUSD', 'rocAmountUSD', 'sharesAtPayment', 'referencePrice'];
    const legacyRows = (items) => items.map(value => { if (!isRecord(value))
        return value; const row = { ...value }; for (const key of optionalAmounts)
        if (row[key] === null || row[key] === '')
            delete row[key]; return row; });
    const compatible = { ...migrated, trades: legacyRows(migrated.trades), dividends: legacyRows(migrated.dividends) };
    const errors = validateLedger(compatible);
    if (errors.length)
        throw new Error(errors.join(' '));
    const raw = object(compatible), base = blankState(), meta = object(raw.meta), toss = object(object(raw.integrations).toss);
    optionalText(meta, ['lastBackupPreparedAt', 'lastCloudAttemptAt', 'lastDividendReplacementFingerprint', 'ledgerRepairV321', 'demoAsOf', 'lastAuthoritativeMstyImportAt']);
    for (const key of ['legacyMigrationAvailable', 'demo'])
        if (meta[key] !== undefined)
            meta[key] = bool(meta[key]);
    if (meta.migrationAudit !== undefined && meta.migrationAudit !== null && !isAudit(meta.migrationAudit)) {
        meta.legacyMigrationAudit = meta.migrationAudit;
        meta.migrationAudit = null;
        meta.legacyMigrationAvailable = true;
    }
    const decodedMeta = { ...base.meta, ...meta, createdAt: text(meta.createdAt), updatedAt: text(meta.updatedAt), lastBackupAt: text(meta.lastBackupAt), lastLocalSaveAt: text(meta.lastLocalSaveAt), lastCloudSaveAt: text(meta.lastCloudSaveAt), migratedFrom: text(meta.migratedFrom), migrationCheckedAt: text(meta.migrationCheckedAt), celebratedMilestones: strings(meta.celebratedMilestones) };
    return { ...raw, version: 4, schemaVersion: 4, settings: settings(object(raw.settings)), projects: rows(raw.projects).map(project), trades: rows(raw.trades).map(trade), dividends: rows(raw.dividends).map(dividend), splits: rows(raw.splits).map(split), cashAdjustments: rows(raw.cashAdjustments).map(cash), meta: decodedMeta, integrations: { toss: { ...base.integrations.toss, ...toss, status: choice(toss.status, ['not_connected', 'connected', 'error', 'syncing', 'partial'], 'not_connected'), lastSyncAt: text(toss.lastSyncAt), lastSuccessfulAt: text(toss.lastSuccessfulAt), lastPartialAt: text(toss.lastPartialAt), lastAttemptAt: text(toss.lastAttemptAt), lastError: text(toss.lastError), accountScopeId: text(toss.accountScopeId), syncStatus: choice(toss.syncStatus, ['', 'complete', 'partial'], ''), candidates: rows(toss.candidates), dividendCandidates: rows(toss.dividendCandidates), correctionCandidates: rows(toss.correctionCandidates), dividendCorrectionCandidates: rows(toss.dividendCorrectionCandidates), holdings: rows(toss.holdings), comparisons: rows(toss.comparisons), accountResults: rows(toss.accountResults), failedAccountCount: number(toss.failedAccountCount), historyTruncated: bool(toss.historyTruncated), ...(toss.dismissedExceptionKeys !== undefined ? { dismissedExceptionKeys: strings(toss.dismissedExceptionKeys) } : {}), ...(toss.syncMilestones !== undefined ? { syncMilestones: strings(toss.syncMilestones) } : {}), syncCursor: object(toss.syncCursor), capabilities: Object.fromEntries(Object.entries(object(toss.capabilities)).map(([key, value]) => [key, bool(value)])), sourceLedger: { orders: rows(object(toss.sourceLedger).orders), dividends: rows(object(toss.sourceLedger).dividends) } } } };
}
