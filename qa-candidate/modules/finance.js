const finiteNonNegative = (value) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
export function tradeCashBreakdown(trade) {
    const shares = finiteNonNegative(trade.shares), price = finiteNonNegative(trade.price), executionAmountUSD = shares * price;
    const feeUSD = finiteNonNegative(trade.feeUSD), taxUSD = finiteNonNegative(trade.taxUSD);
    return { executionAmountUSD, feeUSD, taxUSD, grossBuyCostUSD: trade.type === 'buy' ? executionAmountUSD + feeUSD + taxUSD : 0, netSellProceedsUSD: trade.type === 'sell' ? Math.max(0, executionAmountUSD - feeUSD - taxUSD) : 0 };
}
export function dividendCashBreakdown(record) {
    const status = record.status === 'confirmed' || record.status === 'estimated' ? record.status : 'actual';
    const legacyNet = finiteNonNegative(record.amountUSD), tax = finiteNonNegative(record.withholdingTaxUSD ?? record.taxUSD), fee = finiteNonNegative(record.feeUSD);
    const explicitGross = finiteNonNegative(record.grossAmountUSD), explicitNet = finiteNonNegative(record.netAmountUSD);
    const grossUSD = explicitGross || (explicitNet ? explicitNet + tax + fee : legacyNet + tax + fee);
    const netUSD = explicitNet || legacyNet || Math.max(0, grossUSD - tax - fee);
    const explicitRoc = finiteNonNegative(record.rocAmountUSD), rocPercent = Math.min(100, finiteNonNegative(record.rocPercent));
    const rocUSD = Math.min(netUSD, explicitRoc || (rocPercent > 0 ? netUSD * rocPercent / 100 : 0));
    return { grossUSD, withholdingTaxUSD: tax, feeUSD: fee, netUSD, rocUSD, incomeUSD: Math.max(0, netUSD - rocUSD), status };
}
export function isPostedDividend(record, asOf) {
    const cash = dividendCashBreakdown(record);
    return record.date <= asOf && cash.status === 'actual' && cash.netUSD > 0;
}
export function economicTotalReturn({ marketValueUSD, buyCashOutUSD, sellCashInUSD, dividendCashInUSD }) {
    return finiteNonNegative(marketValueUSD) + finiteNonNegative(sellCashInUSD) + finiteNonNegative(dividendCashInUSD) - finiteNonNegative(buyCashOutUSD);
}
export function applyRocToBasis(costBasisUSD, rocUSD) {
    const basis = finiteNonNegative(costBasisUSD), roc = finiteNonNegative(rocUSD), basisReductionUSD = Math.min(basis, roc);
    return { costBasisUSD: basis - basisReductionUSD, basisReductionUSD, excessRocUSD: Math.max(0, roc - basisReductionUSD) };
}
