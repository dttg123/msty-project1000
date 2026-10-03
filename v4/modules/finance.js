const finiteNonNegative = (value) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
export function tradeCashBreakdown(trade) {
    const shares = finiteNonNegative(trade.shares), price = finiteNonNegative(trade.price), executionAmountUSD = shares * price;
    const feeUSD = finiteNonNegative(trade.feeUSD), taxUSD = finiteNonNegative(trade.taxUSD);
    return { executionAmountUSD, feeUSD, taxUSD, grossBuyCostUSD: trade.type === 'buy' ? executionAmountUSD + feeUSD + taxUSD : 0, netSellProceedsUSD: trade.type === 'sell' ? Math.max(0, executionAmountUSD - feeUSD - taxUSD) : 0 };
}
const hasAmount = (value) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
export function dividendCashBreakdown(record) {
    const status = record.status === 'confirmed' || record.status === 'estimated' ? record.status : 'actual';
    if (record.currency === 'KRW')
        return { grossUSD: 0, withholdingTaxUSD: 0, feeUSD: 0, netUSD: 0, netKRW: finiteNonNegative(record.amountKRW), rocUSD: 0, incomeUSD: 0, status };
    const legacyNet = finiteNonNegative(record.amountUSD), tax = finiteNonNegative(record.withholdingTaxUSD ?? record.taxUSD), fee = finiteNonNegative(record.feeUSD);
    const explicitGross = finiteNonNegative(record.grossAmountUSD), explicitNet = finiteNonNegative(record.netAmountUSD);
    const netUSD = hasAmount(record.netAmountUSD) ? explicitNet : hasAmount(record.amountUSD) ? legacyNet : Math.max(0, explicitGross - tax - fee);
    const grossUSD = hasAmount(record.grossAmountUSD) ? explicitGross : netUSD + tax + fee;
    const explicitRoc = finiteNonNegative(record.rocAmountUSD), rocPercent = Math.min(100, finiteNonNegative(record.rocPercent));
    const rocUSD = Math.min(netUSD, hasAmount(record.rocAmountUSD) ? explicitRoc : (rocPercent > 0 ? netUSD * rocPercent / 100 : 0));
    return { grossUSD, withholdingTaxUSD: tax, feeUSD: fee, netUSD, rocUSD, incomeUSD: Math.max(0, netUSD - rocUSD), status };
}
export function isPostedDividend(record, asOf) {
    const cash = dividendCashBreakdown(record);
    return record.date <= asOf && cash.status === 'actual' && (cash.netUSD > 0 || (cash.netKRW || 0) > 0);
}
// View-only conversion: never persist a fabricated USD receipt or fund the USD cash ledger with it.
export function reportingDividends(rows, rate) {
    return rows.map(row => row.currency === 'KRW' ? { ...row, currency: 'USD', amountUSD: (dividendCashBreakdown(row).netKRW || 0) / Math.max(.000001, rate), netAmountUSD: undefined, grossAmountUSD: undefined, taxUSD: 0, withholdingTaxUSD: 0, feeUSD: 0, rocPercent: undefined, rocAmountUSD: 0, sharesAtPayment: 0 } : row);
}
export const OFFICIAL_DISTRIBUTIONS_URL = 'https://raw.githubusercontent.com/dttg123/msty-project1000/main/v4/data/dividend-announcements.json';
export const MSTY_OFFICIAL_SOURCE = 'https://yieldmaxetfs.com/our-etfs/msty/';
const validISODate = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T12:00:00Z')) && new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) === date;
export function parseOfficialDistributionFeed(value) {
    if (!value || typeof value !== 'object')
        throw new Error('공시 자료 형식 오류');
    const raw = value;
    if (raw.format !== 'dividend-os-official-distributions-v1' || raw.symbol !== 'MSTY' || raw.sourceURL !== MSTY_OFFICIAL_SOURCE || typeof raw.retrievedAt !== 'string' || !Number.isFinite(Date.parse(raw.retrievedAt)) || !Array.isArray(raw.rows) || !raw.rows.length || raw.rows.length > 16)
        throw new Error('공시 출처 또는 형식 오류');
    const dates = new Set();
    const rows = raw.rows.map((row) => {
        if (!row || !validISODate(row.declaredDate) || !validISODate(row.exDate) || !validISODate(row.payDate) || row.declaredDate > row.exDate || row.exDate > row.payDate || row.declaredDate > raw.retrievedAt.slice(0, 10) || dates.has(row.payDate) || typeof row.amountPerShareUSD !== 'number' || !Number.isFinite(row.amountPerShareUSD) || row.amountPerShareUSD <= 0 || row.amountPerShareUSD > 10000)
            throw new Error('공시 날짜 또는 금액 오류');
        dates.add(row.payDate);
        return { declaredDate: row.declaredDate, exDate: row.exDate, payDate: row.payDate, amountPerShareUSD: row.amountPerShareUSD };
    }).sort((a, b) => b.payDate.localeCompare(a.payDate));
    return { format: raw.format, symbol: raw.symbol, sourceURL: raw.sourceURL, retrievedAt: raw.retrievedAt, rows };
}
// Only the declared distribution table is accepted; generic annual calendars are not declarations.
export function parseMSTYDistributionTable(html, retrievedAt) {
    const table = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].find(match => match[0].includes('DISTRIBUTION PER SHARE'))?.[0];
    if (!table || !['DECLARED DATE', 'EX DATE', 'PAYABLE DATE'].every(header => table.includes(header)))
        throw new Error('운용사 공시 표를 찾지 못했습니다.');
    const iso = (value) => { const parts = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return parts ? `${parts[3]}-${parts[1]}-${parts[2]}` : ''; };
    const rows = [], dates = new Set();
    for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1].replace(/<[^>]*>/g, '').trim());
        if (!cells.length)
            continue;
        if (cells.length !== 6 || !/^\$\d+(?:\.\d+)?$/.test(cells[0]))
            throw new Error('운용사 공시 표 형식이 변경되었습니다.');
        const payDate = iso(cells[4]);
        if (dates.has(payDate))
            continue;
        dates.add(payDate);
        rows.push({ declaredDate: iso(cells[1]), exDate: iso(cells[2]), payDate, amountPerShareUSD: Number(cells[0].slice(1)) });
        if (rows.length === 16)
            break;
    }
    return parseOfficialDistributionFeed({ format: 'dividend-os-official-distributions-v1', symbol: 'MSTY', sourceURL: MSTY_OFFICIAL_SOURCE, retrievedAt, rows });
}
export function parseDividendReplacement(input, today) {
    const raw = input;
    if (raw?.format !== 'dividend-os-dividend-replacement-v1' || raw.scope !== 'all-dividends' || typeof raw.symbol !== 'string' || !/^[A-Z0-9.-]{1,16}$/.test(raw.symbol) || !Array.isArray(raw.rows) || !raw.rows.length || raw.rows.length > 5000 || raw.currency !== undefined && !['KRW', 'USD'].includes(String(raw.currency)))
        throw new Error('올바른 배당 교체 파일이 아닙니다.');
    const currency = raw.currency === 'USD' ? 'USD' : 'KRW', dates = new Set();
    const rows = raw.rows.map((value) => {
        const row = value;
        const amount = currency === 'KRW' ? row?.amountKRW : row?.amountUSD;
        if (typeof row?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date + 'T12:00:00Z')) || new Date(row.date + 'T12:00:00Z').toISOString().slice(0, 10) !== row.date || row.date > today || dates.has(row.date) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e12 || (currency === 'KRW' ? !Number.isSafeInteger(amount) : Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6))
            throw new Error('날짜·중복·입금 금액을 확인해 주세요.');
        dates.add(row.date);
        return currency === 'KRW' ? { date: row.date, amountKRW: amount } : { date: row.date, amountUSD: amount };
    }).sort((a, b) => a.date.localeCompare(b.date));
    return { symbol: raw.symbol, currency, rows, totalKRW: rows.reduce((sum, row) => sum + (row.amountKRW || 0), 0), totalUSD: Math.round(rows.reduce((sum, row) => sum + (row.amountUSD || 0), 0) * 100) / 100 };
}
export function economicTotalReturn({ marketValueUSD, buyCashOutUSD, sellCashInUSD, dividendCashInUSD }) {
    return finiteNonNegative(marketValueUSD) + finiteNonNegative(sellCashInUSD) + finiteNonNegative(dividendCashInUSD) - finiteNonNegative(buyCashOutUSD);
}
export function applyRocToBasis(costBasisUSD, rocUSD) {
    const basis = finiteNonNegative(costBasisUSD), roc = finiteNonNegative(rocUSD), basisReductionUSD = Math.min(basis, roc);
    return { costBasisUSD: basis - basisReductionUSD, basisReductionUSD, excessRocUSD: Math.max(0, roc - basisReductionUSD) };
}
export function parseReferenceExchangeRate(data, now = new Date()) {
    const rate = Number(data?.rate), date = String(data?.date || '');
    const day = Date.parse(date + 'T00:00:00Z'), age = now.getTime() - day;
    if (data?.base !== 'USD' || data?.quote !== 'KRW' || !Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date || age < -86400000 || age > 7 * 86400000)
        throw new Error('유효한 최신 달러·원 참고 환율이 아닙니다.');
    return { rate, date };
}
export async function fetchReferenceExchangeRate() {
    const response = await fetch('https://api.frankfurter.dev/v2/rate/USD/KRW', { signal: AbortSignal.timeout(10000), credentials: 'omit', cache: 'no-store' });
    if (!response.ok)
        throw new Error('환율 조회에 실패했습니다.');
    return parseReferenceExchangeRate(await response.json());
}
