import { isRecord } from './utils.js';
import { isDate, n, todayISO, uid } from './utils.js';
const record = (value) => isRecord(value) ? value : {};
const records = (value) => Array.isArray(value) ? value.filter(isRecord) : [];
const arrayValues = (value) => Array.isArray(value) ? value : [];
const present = (value) => value !== null;
const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,16}$/;
function symbolOf(value) {
    const symbol = String(value || '').trim().toUpperCase();
    return SYMBOL_PATTERN.test(symbol) ? symbol : '';
}
function dateOf(value) {
    const text = String(value || '');
    const match = text.match(/^\d{4}-\d{2}-\d{2}/);
    return match && isDate(match[0]) ? match[0] : '';
}
function orderIdOf(input) {
    const order = record(input);
    const source = order && Object.hasOwn(order, 'rawExternalId') ? order.rawExternalId : (order?.externalId || order?.orderId || order?.id || '');
    const value = String(source || '').trim();
    return value.length <= 256 ? value : '';
}
function fingerprint(value) {
    let hash = 14695981039346656037n;
    for (const char of String(value)) {
        hash ^= BigInt(char.codePointAt(0) ?? 0);
        hash = BigInt.asUintN(64, hash * 1099511628211n);
    }
    return hash.toString(16).padStart(16, '0');
}
function sourceId(rawExternalId, identity, signature) {
    const base = rawExternalId || `fp-${fingerprint([identity.accountId, identity.instrumentKey, signature].join('|'))}`;
    return identity.accountId ? `${identity.accountId}:${base}` : base;
}
function accountIdOf(input) {
    const row = record(input);
    return String(row?.accountId ?? row?.accountSeq ?? '').trim().slice(0, 128);
}
function marketOf(input) {
    const row = record(input);
    return String(row?.market ?? row?.exchange ?? row?.exchangeCode ?? '').trim().toUpperCase().slice(0, 32);
}
function securityIdOf(input) {
    const row = record(input);
    return String(row?.securityId ?? row?.instrumentId ?? row?.stockCode ?? row?.productCode ?? row?.isin ?? '').trim().toUpperCase().slice(0, 64);
}
export function tossIdentityOf(input) {
    const row = record(input);
    const symbol = symbolOf(row?.symbol), currency = String(row?.currency || '').toUpperCase(), market = marketOf(row), securityId = securityIdOf(row), accountId = accountIdOf(row);
    const instrumentKey = securityId ? `${market || 'UNKNOWN'}:${securityId}` : `${market || 'UNKNOWN'}:${symbol}:${currency || 'UNKNOWN'}`;
    return { accountId, market, securityId, instrumentKey, assetKey: `toss:${instrumentKey}` };
}
function tradeSignature(input) {
    const row = record(input);
    const symbol = symbolOf(row?.symbol), date = dateOf(row?.date), type = String(row?.type || '').toLowerCase();
    const shares = Math.max(0, n(row?.shares)), price = Math.max(0, n(row?.price));
    if (!symbol || !date || !['buy', 'sell'].includes(type) || shares <= 0 || price <= 0)
        return '';
    return [symbol, date, type, shares.toFixed(8), price.toFixed(4)].join('|');
}
function dividendSignature(input) {
    const row = record(input);
    const symbol = symbolOf(row?.symbol), date = dateOf(row?.date), amount = Math.max(0, n(row?.amountUSD));
    if (!symbol || !date || amount <= 0)
        return '';
    return [symbol, date, amount.toFixed(2)].join('|');
}
function orderVersionFingerprint(input) {
    const row = record(input);
    return fingerprint([row?.status, row?.symbol, row?.date, row?.type, n(row?.shares).toFixed(8), n(row?.price).toFixed(8), n(row?.feeUSD).toFixed(8), n(row?.taxUSD).toFixed(8), row?.currency].join('|'));
}
function dividendVersionFingerprint(input) {
    const row = record(input);
    return fingerprint([row?.symbol, row?.date, n(row?.amountUSD).toFixed(8), n(row?.grossAmountUSD).toFixed(8), n(row?.withholdingTaxUSD).toFixed(8), n(row?.feeUSD).toFixed(8), row?.currency].join('|'));
}
export function normalizeTossHolding(input) {
    const row = record(input);
    const symbol = symbolOf(row?.symbol);
    if (!symbol)
        return null;
    const identity = tossIdentityOf(row);
    return {
        ...identity,
        accountLabel: String(row?.accountLabel || '').trim().slice(0, 64),
        symbol,
        name: String(row?.name || symbol).trim() || symbol,
        currency: String(row?.currency || '').toUpperCase(),
        shares: Math.max(0, n(row?.shares ?? row?.quantity)),
        avgPrice: Math.max(0, n(row?.avgPrice ?? row?.averagePurchasePrice)),
        lastPrice: Math.max(0, n(row?.lastPrice)),
        marketValue: Math.max(0, n(record(row.marketValue).amount ?? row.marketValue))
    };
}
export function normalizeTossPrice(input) {
    const row = record(input);
    const symbol = symbolOf(row?.symbol), currency = String(row?.currency || '').toUpperCase(), lastPrice = Math.max(0, n(row?.lastPrice));
    if (!symbol || !currency || lastPrice <= 0)
        return null;
    return { ...tossIdentityOf(row), symbol, currency, lastPrice, timestamp: String(row?.timestamp || '') };
}
export function normalizeTossOrder(input) {
    const order = record(input);
    const execution = record(order.execution);
    const rawExternalId = orderIdOf(order), symbol = symbolOf(order?.symbol), identity = tossIdentityOf(order);
    const shares = Math.max(0, n(order?.shares ?? execution.filledQuantity ?? order?.filledQuantity));
    const price = Math.max(0, n(order?.priceFilled ?? execution.averageFilledPrice ?? order?.averageFilledPrice ?? order?.price));
    const date = dateOf(order?.date ?? execution.filledAt ?? order?.filledAt ?? order?.orderedAt);
    const side = String(order?.type ?? order?.side ?? '').toUpperCase();
    const type = side === 'SELL' || side === '매도' ? 'sell' : side === 'BUY' || side === '매수' ? 'buy' : '';
    const currency = String(order?.currency || '').toUpperCase();
    const feeUSD = Math.max(0, n(order?.feeUSD ?? execution.commission ?? order?.commission)), taxUSD = Math.max(0, n(order?.taxUSD ?? execution.tax ?? order?.tax));
    const status = String(order?.status || 'FILLED').trim().toUpperCase().slice(0, 32);
    if (!symbol || !date || date > todayISO() || !type || !['USD', 'KRW'].includes(currency) || shares <= 0 || shares > 1e9 || price <= 0 || price > 1e9 || feeUSD > 1e9 || taxUSD > 1e9)
        return null;
    const signature = [symbol, date, type, shares.toFixed(8), price.toFixed(8), currency].join('|');
    const externalId = sourceId(rawExternalId, identity, signature);
    const normalized = { sourceFingerprint: '',
        ...identity, externalId, rawExternalId, accountLabel: String(order?.accountLabel || '').trim().slice(0, 64), symbol, name: String(order?.name || symbol).trim() || symbol, date, type, shares, price, currency,
        status, feeUSD, taxUSD, filledAmount: Math.max(0, n(execution.filledAmount ?? order?.filledAmount)), filledAt: String((execution.filledAt ?? order?.filledAt) || ''), settlementDate: String((execution.settlementDate ?? order?.settlementDate) || ''),
        sourceIdKind: rawExternalId ? 'source' : 'fingerprint', buyType: type === 'buy' ? 'direct' : '', reinvestAmountUSD: 0, note: '토스 체결 승인 가져오기' };
    normalized.sourceFingerprint = orderVersionFingerprint(normalized);
    return normalized;
}
export function normalizeTossDividend(input) {
    const row = record(input);
    const rawExternalId = orderIdOf(row), symbol = symbolOf(row?.symbol), date = dateOf(row?.date ?? row?.paidAt ?? row?.paymentDate), identity = tossIdentityOf(row);
    const grossAmountUSD = Math.max(0, n(row?.grossAmountUSD ?? row?.grossAmount)), withholdingTaxUSD = Math.max(0, n(row?.withholdingTaxUSD ?? row?.tax)), feeUSD = Math.max(0, n(row?.feeUSD ?? row?.fee));
    const explicitAmount = row?.amountUSD ?? row?.netAmountUSD ?? row?.netAmount ?? row?.amount;
    const amountUSD = Math.max(0, n(explicitAmount ?? (grossAmountUSD - withholdingTaxUSD - feeUSD)));
    const currency = String(row?.currency || '').toUpperCase();
    if (!symbol || !date || date > todayISO() || !['USD', 'KRW'].includes(currency) || amountUSD <= 0 || amountUSD > 1e9 || grossAmountUSD > 1e9 || withholdingTaxUSD > 1e9 || feeUSD > 1e9)
        return null;
    const externalId = sourceId(rawExternalId, identity, [symbol, date, amountUSD.toFixed(8), currency].join('|'));
    const normalized = { sourceFingerprint: '', ...identity, externalId, rawExternalId, sourceIdKind: rawExternalId ? 'source' : 'fingerprint', accountLabel: String(row?.accountLabel || '').trim().slice(0, 64), symbol, name: String(row?.name || symbol).trim() || symbol, date, amountUSD, grossAmountUSD: grossAmountUSD || amountUSD + withholdingTaxUSD + feeUSD, withholdingTaxUSD, feeUSD, currency };
    normalized.sourceFingerprint = dividendVersionFingerprint(normalized);
    return normalized;
}
function normalizeTossOrderSource(input) {
    const order = record(input);
    const importable = normalizeTossOrder(order);
    if (importable)
        return { ...importable, importable: true };
    const rawExternalId = orderIdOf(order), symbol = symbolOf(order?.symbol), identity = tossIdentityOf(order), execution = record(order.execution);
    const date = dateOf(order?.date ?? execution.filledAt ?? order?.filledAt ?? order?.orderedAt), side = String(order?.type ?? order?.side ?? '').toUpperCase(), type = side === 'SELL' ? 'sell' : side === 'BUY' ? 'buy' : '', currency = String(order?.currency || '').toUpperCase();
    if (!rawExternalId || !symbol || !date || !type || !['USD', 'KRW'].includes(currency))
        return null;
    const normalized = { sourceFingerprint: '', ...identity, externalId: sourceId(rawExternalId, identity, ''), rawExternalId, symbol, date, type, currency, status: String(order?.status || '').toUpperCase().slice(0, 32), shares: Math.max(0, n(execution.filledQuantity ?? order?.filledQuantity)), price: Math.max(0, n(execution.averageFilledPrice ?? order?.averageFilledPrice)), feeUSD: Math.max(0, n(execution.commission ?? order?.commission)), taxUSD: Math.max(0, n(execution.tax ?? order?.tax)), importable: false };
    normalized.sourceFingerprint = orderVersionFingerprint(normalized);
    return normalized;
}
export function mergeTossSourceLedger(currentInput = {}, snapshotInput = {}, observedAt = new Date().toISOString()) {
    const current = record(currentInput), snapshot = record(snapshotInput);
    const revisionOf = (row) => ({ observedAt, status: String(row?.status || ''), date: String(row?.date || ''), shares: Math.max(0, n(row?.shares)), price: Math.max(0, n(row?.price)), feeUSD: Math.max(0, n(row?.feeUSD)), taxUSD: Math.max(0, n(row?.taxUSD)), amountUSD: Math.max(0, n(row?.amountUSD)), sourceFingerprint: String(row?.sourceFingerprint || '') });
    const merge = (existing, incoming, normalizer) => {
        const map = new Map(records(existing).filter(row => row.externalId).map(row => [String(row.externalId), row]));
        for (const raw of records(incoming)) {
            const row = normalizer(raw);
            if (!row)
                continue;
            const previous = map.get(row.externalId);
            const changed = !!(previous?.sourceFingerprint && row.sourceFingerprint && previous.sourceFingerprint !== row.sourceFingerprint);
            const revisions = changed ? [...records(previous?.revisions), revisionOf(previous)].slice(-10) : records(previous?.revisions);
            map.set(row.externalId, { ...(previous || {}), ...row, revisions, firstSeenAt: previous?.firstSeenAt || observedAt, lastSeenAt: observedAt, lastChangedAt: changed ? observedAt : (previous?.lastChangedAt || ''), revisionCount: Math.max(1, n(previous?.revisionCount) || 1) + (changed ? 1 : 0) });
        }
        return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.externalId).localeCompare(String(b.externalId)));
    };
    return {
        orders: merge(current.orders, snapshot.orders, normalizeTossOrderSource),
        dividends: merge(current.dividends, snapshot.dividends, normalizeTossDividend)
    };
}
export function buildTossSync(snapshotInput, { existingTrades = [], existingDividends = [], appPositions = [] } = {}) {
    const snapshot = record(snapshotInput);
    const existingById = new Map();
    for (const row of existingTrades.filter((item) => item?.source?.provider === 'toss'))
        for (const id of [row.source?.externalId, row.source?.rawExternalId].map(value => String(value || '')).filter(Boolean))
            existingById.set(id, row);
    const manualBySignature = new Map();
    for (const trade of existingTrades.filter((row) => row?.source?.provider !== 'toss')) {
        const signature = tradeSignature(trade);
        if (signature)
            manualBySignature.set(signature, [...(manualBySignature.get(signature) || []), trade.id]);
    }
    const normalizedHoldings = records(snapshot.holdings).map(normalizeTossHolding).filter(present);
    const holdingMap = new Map();
    for (const row of normalizedHoldings) {
        const previous = holdingMap.get(row.assetKey);
        if (previous) {
            previous.shares += row.shares;
            previous.marketValue += row.marketValue;
            previous.accounts = [...new Set([...previous.accounts, row.accountId].filter(Boolean))];
        }
        else
            holdingMap.set(row.assetKey, { ...row, accounts: row.accountId ? [row.accountId] : [] });
    }
    const holdings = [...holdingMap.values()];
    const prices = records(snapshot.prices).map(normalizeTossPrice).filter(present);
    const appMap = new Map();
    for (const row of appPositions) {
        const key = String(row?.assetKey || '');
        if (key)
            appMap.set(key, Math.max(0, n(row.shares)));
        else
            appMap.set(`symbol:${symbolOf(row.symbol)}`, Math.max(0, n(row.shares)));
    }
    const comparisons = holdings.map((row) => ({
        ...row,
        appShares: appMap.get(row.assetKey) ?? appMap.get(`symbol:${row.symbol}`) ?? 0,
        difference: row.shares - (appMap.get(row.assetKey) ?? appMap.get(`symbol:${row.symbol}`) ?? 0),
        supported: row.currency === 'USD'
    }));
    const seen = new Set(), ignored = [];
    let matchedExistingCount = 0;
    const candidates = [], correctionCandidates = [];
    for (const raw of arrayValues(snapshot.orders)) {
        const sourceRow = normalizeTossOrderSource(raw);
        const row = normalizeTossOrder(raw);
        if (!row) {
            const existing = sourceRow && (existingById.get(sourceRow.externalId) || existingById.get(sourceRow.rawExternalId));
            if (existing && sourceRow && sourceRow.currency === 'USD') {
                const previousFingerprint = existing.source?.sourceFingerprint || orderVersionFingerprint({ ...existing, status: existing.source?.status || 'FILLED', currency: 'USD', feeUSD: existing.feeUSD, taxUSD: existing.taxUSD });
                if (previousFingerprint !== sourceRow.sourceFingerprint)
                    correctionCandidates.push({ ...sourceRow, existingRecordId: existing.id, previousFingerprint, changeType: 'voided' });
            }
            else
                ignored.push({ reason: sourceRow ? 'not-importable' : 'invalid' });
            continue;
        }
        if (row.currency !== 'USD') {
            ignored.push({ ...row, reason: 'currency' });
            continue;
        }
        if (seen.has(row.externalId))
            continue;
        seen.add(row.externalId);
        const existing = existingById.get(row.externalId) || existingById.get(row.rawExternalId);
        if (existing) {
            const previousFingerprint = existing.source?.sourceFingerprint || orderVersionFingerprint({ ...existing, status: existing.source?.status || 'FILLED', currency: 'USD', feeUSD: existing.feeUSD, taxUSD: existing.taxUSD });
            if (previousFingerprint !== row.sourceFingerprint)
                correctionCandidates.push({ ...row, existingRecordId: existing.id, previousFingerprint, changeType: 'changed' });
            continue;
        }
        const signature = tradeSignature(row), manualMatchIds = manualBySignature.get(signature) || [];
        if (manualMatchIds.length) {
            matchedExistingCount++;
            manualBySignature.set(signature, manualMatchIds.slice(1));
        }
        candidates.push({ ...row, possibleManualDuplicate: manualMatchIds.length > 0, manualMatchIds: manualMatchIds.slice(0, 5) });
    }
    const existingDividendById = new Map();
    for (const row of existingDividends.filter((item) => item?.source?.provider === 'toss'))
        for (const id of [row.source?.externalId, row.source?.rawExternalId].map(value => String(value || '')).filter(Boolean))
            existingDividendById.set(id, row);
    const manualDividendBySignature = new Map();
    for (const dividend of existingDividends.filter((row) => row?.source?.provider !== 'toss')) {
        const signature = dividendSignature(dividend);
        if (signature)
            manualDividendBySignature.set(signature, [...(manualDividendBySignature.get(signature) || []), dividend.id]);
    }
    const seenDividends = new Set(), dividendCandidates = [], dividendCorrectionCandidates = [];
    let matchedExistingDividendCount = 0;
    for (const raw of arrayValues(snapshot.dividends)) {
        const row = normalizeTossDividend(raw);
        if (!row) {
            ignored.push({ reason: 'invalid-dividend' });
            continue;
        }
        if (row.currency !== 'USD') {
            ignored.push({ ...row, reason: 'currency' });
            continue;
        }
        if (seenDividends.has(row.externalId))
            continue;
        seenDividends.add(row.externalId);
        const existing = existingDividendById.get(row.externalId) || existingDividendById.get(row.rawExternalId);
        if (existing) {
            const previousFingerprint = existing.source?.sourceFingerprint || dividendVersionFingerprint({ ...existing, currency: 'USD' });
            if (previousFingerprint !== row.sourceFingerprint)
                dividendCorrectionCandidates.push({ ...row, existingRecordId: existing.id, previousFingerprint, changeType: 'changed' });
            continue;
        }
        const signature = dividendSignature(row), manualMatchIds = manualDividendBySignature.get(signature) || [];
        if (manualMatchIds.length) {
            matchedExistingDividendCount++;
            manualDividendBySignature.set(signature, manualMatchIds.slice(1));
        }
        dividendCandidates.push({ ...row, possibleManualDuplicate: manualMatchIds.length > 0, manualMatchIds: manualMatchIds.slice(0, 5) });
    }
    candidates.sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId));
    dividendCandidates.sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId));
    correctionCandidates.sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId));
    dividendCorrectionCandidates.sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId));
    return {
        accountLabel: String(snapshot?.accountLabel || '토스증권 계좌'),
        fetchedAt: String(snapshot?.fetchedAt || new Date().toISOString()),
        accountScopeId: String(snapshot?.accountScopeId || ''), syncStatus: snapshot?.syncStatus === 'partial' ? 'partial' : 'complete', syncCursor: record(snapshot.syncCursor), accountResults: records(snapshot.accountResults), capabilities: Object.fromEntries(Object.entries(record(snapshot.capabilities)).filter((entry) => typeof entry[1] === 'boolean')), failedAccountCount: Math.max(0, n(snapshot?.failedAccountCount)),
        holdings, prices, comparisons, candidates, dividendCandidates, correctionCandidates, dividendCorrectionCandidates,
        ignoredCount: ignored.length, matchedExistingCount, matchedExistingDividendCount, historyTruncated: !!snapshot?.historyTruncated,
        unsupportedCurrencyCount: ignored.filter(row => row.reason === 'currency').length
    };
}
export function mergeTossCandidates(current = [], incoming = []) {
    const map = new Map();
    for (const raw of [...records(current), ...records(incoming)]) {
        const row = normalizeTossOrder(raw), id = String(row?.externalId || '');
        if (row?.currency === 'USD' && id)
            map.set(id, { ...(map.get(id) || {}), ...raw, ...row });
    }
    return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.externalId).localeCompare(String(b.externalId)));
}
export function mergeTossCorrectionCandidates(current = [], incoming = []) {
    const map = new Map();
    for (const raw of [...records(current), ...records(incoming)]) {
        const row = normalizeTossOrderSource(raw), id = String(row?.externalId || '');
        if (row?.currency === 'USD' && id)
            map.set(id, { ...(map.get(id) || {}), ...raw, ...row, existingRecordId: raw?.existingRecordId || map.get(id)?.existingRecordId || '' });
    }
    return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.externalId).localeCompare(String(b.externalId)));
}
export function mergeTossDividendCandidates(current = [], incoming = []) {
    const map = new Map();
    for (const raw of [...records(current), ...records(incoming)]) {
        const row = normalizeTossDividend(raw), id = String(row?.externalId || '');
        if (row?.currency === 'USD' && id)
            map.set(id, { ...(map.get(id) || {}), ...raw, ...row });
    }
    return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.externalId).localeCompare(String(b.externalId)));
}
export function tossCandidateToTrade(candidate, { projectId, id, createdAt = new Date().toISOString() } = {}) {
    const row = normalizeTossOrder(candidate);
    if (!row || row.currency !== 'USD' || !projectId || !id)
        return null;
    const base = {
        id, projectId, symbol: row.symbol, date: row.date,
        shares: row.shares, price: row.price, feeUSD: row.feeUSD, taxUSD: row.taxUSD, reinvestAmountUSD: 0, note: row.note, createdAt,
        source: { provider: 'toss', externalId: row.externalId, rawExternalId: row.rawExternalId, sourceIdKind: row.sourceIdKind, sourceFingerprint: row.sourceFingerprint, status: row.status, filledAt: row.filledAt, accountId: row.accountId, assetKey: row.assetKey, market: row.market, securityId: row.securityId, importedAt: createdAt }
    };
    return row.type === 'buy' ? { ...base, type: 'buy', buyType: 'direct' } : { ...base, type: 'sell', buyType: undefined };
}
// Recover only missing execution metadata from an unchanged, uniquely identified
// broker original. Financial values and existing timestamps remain untouched.
export function restoreTossExecutionTimes(trades, orders) {
    const byId = new Map();
    for (const input of orders) {
        const row = normalizeTossOrder(input);
        if (!row)
            continue;
        byId.set(row.externalId, [...(byId.get(row.externalId) || []), row]);
    }
    const counts = new Map();
    for (const trade of trades)
        if (trade.source?.provider === 'toss' && trade.source.externalId)
            counts.set(trade.source.externalId, (counts.get(trade.source.externalId) || 0) + 1);
    return trades.map(trade => {
        const source = trade.source;
        if (source?.provider !== 'toss' || source.filledAt || !source.externalId || !source.sourceFingerprint || counts.get(source.externalId) !== 1)
            return trade;
        const matches = byId.get(source.externalId);
        if (matches?.length !== 1)
            return trade;
        const row = matches[0];
        if (row.currency !== 'USD' || row.sourceFingerprint !== source.sourceFingerprint || row.accountId !== (source.accountId || '') ||
            (source.assetKey && source.assetKey !== row.assetKey) || (source.market && source.market !== row.market) || (source.securityId && source.securityId !== row.securityId) ||
            row.symbol !== trade.symbol || row.date !== trade.date || row.type !== trade.type || row.shares !== trade.shares || row.price !== trade.price ||
            row.feeUSD !== (trade.feeUSD || 0) || row.taxUSD !== (trade.taxUSD || 0) || row.status !== (source.status || 'FILLED') ||
            row.filledAt.slice(0, 10) !== trade.date || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row.filledAt) || !Number.isFinite(Date.parse(row.filledAt)))
            return trade;
        return { ...trade, source: { ...source, filledAt: row.filledAt } };
    });
}
export function tossCandidateToDividend(candidate, { projectId, id, sharesAtPayment = 0, createdAt = new Date().toISOString() } = {}) {
    const row = normalizeTossDividend(candidate);
    if (!row || row.currency !== 'USD' || !projectId || !id)
        return null;
    return {
        id, projectId, symbol: row.symbol, date: row.date, amountUSD: row.amountUSD, grossAmountUSD: row.grossAmountUSD, withholdingTaxUSD: row.withholdingTaxUSD, feeUSD: row.feeUSD, sharesAtPayment: Math.max(0, n(sharesAtPayment)),
        referencePrice: 0, rocPercent: null, rocStatus: 'estimated', note: '토스 배당 승인 가져오기', createdAt,
        source: { provider: 'toss', externalId: row.externalId, rawExternalId: row.rawExternalId, sourceIdKind: row.sourceIdKind, sourceFingerprint: row.sourceFingerprint, accountId: row.accountId, assetKey: row.assetKey, market: row.market, securityId: row.securityId, importedAt: createdAt }
    };
}
export function rebuildProjectFromTossSource({ project, sourceLedger, currentTrades = [], currentDividends = [], capabilities = {}, syncStatus = '', failedAccountCount = 0, historyTruncated = false, makeId = uid, createdAt = new Date().toISOString(), sharesAtDate = () => 0 } = {}) {
    if (!project?.id || !symbolOf(project.symbol))
        return { ok: false, reason: 'project' };
    if (syncStatus !== 'complete' || Math.max(0, n(failedAccountCount)) > 0)
        return { ok: false, reason: 'partial' };
    if (historyTruncated)
        return { ok: false, reason: 'truncated' };
    const symbol = symbolOf(project.symbol);
    const unique = (rows, normalizer) => {
        const map = new Map();
        for (const raw of records(rows)) {
            const row = normalizer(raw);
            if (row?.symbol === symbol && row.currency === 'USD' && row.externalId)
                map.set(row.externalId, row);
        }
        return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId));
    };
    const orders = unique(sourceLedger?.orders, normalizeTossOrder);
    if (!orders.length)
        return { ok: false, reason: 'empty-orders' };
    const rebuiltTrades = orders.map((row) => tossCandidateToTrade(row, { projectId: project.id, id: makeId('t'), createdAt })).filter(present);
    const projectTrades = currentTrades.filter((row) => row.projectId === project.id);
    const keepTrades = currentTrades.filter((row) => row.projectId !== project.id);
    const dividendSourceSupported = capabilities?.dividends === true;
    const projectDividends = currentDividends.filter((row) => row.projectId === project.id);
    const keepDividends = currentDividends.filter((row) => row.projectId !== project.id);
    let rebuiltDividends = projectDividends;
    if (dividendSourceSupported) {
        const rows = unique(sourceLedger?.dividends, normalizeTossDividend);
        rebuiltDividends = rows.map((row) => tossCandidateToDividend(row, { projectId: project.id, id: makeId('d'), sharesAtPayment: Math.max(0, n(sharesAtDate(row.date))), createdAt })).filter(present);
    }
    return {
        ok: true, reason: '', trades: [...keepTrades, ...rebuiltTrades], dividends: [...keepDividends, ...rebuiltDividends],
        importedTrades: rebuiltTrades.length, replacedTrades: projectTrades.length,
        importedDividends: dividendSourceSupported ? rebuiltDividends.length : 0, replacedDividends: dividendSourceSupported ? projectDividends.length : 0,
        preservedDividends: dividendSourceSupported ? 0 : projectDividends.length, dividendSourceSupported
    };
}
export function nextTossSyncFrom(input = {}, fallback = '2020-01-01', overlapDays = 14) {
    const toss = record(input);
    const cursor = dateOf(record(toss.syncCursor).ordersThrough) || dateOf(toss?.lastSuccessfulAt);
    if (!cursor)
        return dateOf(fallback) || '2020-01-01';
    const date = new Date(`${cursor}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - Math.max(1, Math.min(90, n(overlapDays) || 14)));
    const candidate = date.toISOString().slice(0, 10), minimum = dateOf(fallback) || '2020-01-01';
    return candidate < minimum ? minimum : candidate;
}
export function accountScopeChanged(previous, next) { return !!(previous && next && String(previous) !== String(next)); }
export function tossSyncProgress(previousInput = {}, resultInput = {}) {
    const previous = record(previousInput), result = record(resultInput);
    const complete = result.syncStatus === 'complete', accountsComplete = Math.max(0, n(result.failedAccountCount)) === 0;
    return { syncCursor: accountsComplete ? record(result.syncCursor || previous.syncCursor) : record(previous.syncCursor), lastSuccessfulAt: complete ? String(result.fetchedAt || '') : String(previous.lastSuccessfulAt || ''), lastPartialAt: complete ? String(previous.lastPartialAt || '') : String(result.fetchedAt || previous.lastPartialAt || '') };
}
// Keep all broker originals, but import only managed securities and current USD holdings.
// Closed, unmanaged history can lack splits or opening balances and must not block a live portfolio.
export function scopeAutomaticTossImport(input, projects) {
    const toss = record(input), managed = projects.filter(project => !project.archived);
    const holdings = records(toss.holdings).filter(row => row.currency === 'USD' && n(row.shares) > 0);
    const inScope = (row) => managed.some(project => project.symbol === row.symbol || (project.brokerLinks || []).some(link => link.provider === 'toss' && link.assetKey && link.assetKey === row.assetKey)) || holdings.some(holding => holding.assetKey && row.assetKey ? holding.assetKey === row.assetKey : holding.symbol === row.symbol);
    return { ...toss, ...Object.fromEntries(['candidates', 'dividendCandidates', 'correctionCandidates', 'dividendCorrectionCandidates'].map(key => [key, records(toss[key]).filter(inScope)])) };
}
export function automaticTossImportPlan(input = {}) {
    const toss = record(input);
    const candidates = records(toss.candidates);
    const dividendCandidates = records(toss.dividendCandidates);
    const corrections = [...records(toss.correctionCandidates), ...records(toss.dividendCorrectionCandidates)];
    const total = candidates.length + dividendCandidates.length;
    if (toss.syncStatus !== 'complete' || Math.max(0, n(toss.failedAccountCount)) > 0)
        return { eligible: false, reason: 'partial', candidates, dividendCandidates };
    if (toss.historyTruncated)
        return { eligible: false, reason: 'truncated', candidates, dividendCandidates };
    if (corrections.length)
        return { eligible: false, reason: 'correction', candidates, dividendCandidates };
    if (!total)
        return { eligible: false, reason: 'empty', candidates, dividendCandidates };
    // Existing manual matches stay pending; they must not block unrelated new receipts.
    // The caller still validates chronology and reconciles the resulting holdings before saving.
    const newTrades = candidates.filter((row) => !row?.possibleManualDuplicate);
    const newDividends = dividendCandidates.filter((row) => !row?.possibleManualDuplicate);
    if (!newTrades.length && !newDividends.length)
        return { eligible: false, reason: 'duplicate', candidates: [], dividendCandidates: [] };
    return { eligible: true, reason: '', candidates: newTrades, dividendCandidates: newDividends };
}
export function refreshTossCandidateConflicts(toss = {}, existingTrades = [], existingDividends = []) {
    const manualTradeIds = new Set(existingTrades.filter((row) => row?.source?.provider !== 'toss').map((row) => String(row?.id || '')).filter(Boolean));
    const manualDividendIds = new Set(existingDividends.filter((row) => row?.source?.provider !== 'toss').map((row) => String(row?.id || '')).filter(Boolean));
    const refresh = (rows, ids) => records(rows).map((row) => {
        const matches = (Array.isArray(row?.manualMatchIds) ? row.manualMatchIds : []).map(String).filter((id) => ids.has(id));
        return { ...row, possibleManualDuplicate: matches.length > 0, manualMatchIds: matches };
    });
    toss.candidates = refresh(toss.candidates, manualTradeIds);
    toss.dividendCandidates = refresh(toss.dividendCandidates, manualDividendIds);
    return toss;
}
export function automaticTossDividendAdoptions(candidates = []) {
    const used = new Set(), adoptions = [];
    for (const row of records(candidates)) {
        const matches = Array.isArray(row?.manualMatchIds) ? row.manualMatchIds.filter((id) => typeof id === 'string' && !!id) : [];
        if (!row?.possibleManualDuplicate || matches.length !== 1 || used.has(matches[0]))
            continue;
        used.add(matches[0]);
        adoptions.push({ candidate: row, manualId: matches[0] });
    }
    return adoptions;
}
export function disconnectedTossState(toss) {
    return { ...toss, status: 'not_connected', lastError: '', accountLabel: '', holdings: [], comparisons: [], candidates: [], dividendCandidates: [], correctionCandidates: [], dividendCorrectionCandidates: [], accountResults: [], failedAccountCount: 0 };
}
export const TOSS_EXCEPTION_FIELDS = ['candidates', 'dividendCandidates', 'correctionCandidates', 'dividendCorrectionCandidates'];
export function tossExceptionKey(field, input, scope = '') {
    const row = record(input);
    return JSON.stringify([scope, field, String(row?.externalId || ''), String(row?.sourceFingerprint || '')]);
}
export function filterDismissedTossExceptions(toss, keys = Array.isArray(toss.dismissedExceptionKeys) ? toss.dismissedExceptionKeys.filter((key) => typeof key === 'string') : []) {
    const dismissed = new Set(keys), keep = (field) => records(toss[field]).filter(row => !dismissed.has(tossExceptionKey(field, row, String(toss.accountScopeId || ''))));
    return { ...toss, candidates: keep('candidates'), dividendCandidates: keep('dividendCandidates'), correctionCandidates: keep('correctionCandidates'), dividendCorrectionCandidates: keep('dividendCorrectionCandidates') };
}
export function dismissTossExceptions(toss, selectedKeys) {
    const available = new Set(TOSS_EXCEPTION_FIELDS.flatMap(field => records(toss[field]).map((row) => tossExceptionKey(field, row, String(toss.accountScopeId || '')))));
    const dismissedExceptionKeys = [...new Set([...(Array.isArray(toss.dismissedExceptionKeys) ? toss.dismissedExceptionKeys.filter((key) => typeof key === 'string') : []), ...selectedKeys.filter(key => available.has(key))])];
    return filterDismissedTossExceptions({ ...toss, dismissedExceptionKeys });
}
