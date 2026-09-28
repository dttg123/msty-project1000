const ticker = (value) => String(value ?? '').trim().toUpperCase();
const amount = (value) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; };
export function tickerChange(project, toSymbol, effectiveDate, id, createdAt = new Date().toISOString()) {
    const fromSymbol = ticker(project.symbol), next = ticker(toSymbol);
    if (!next || next === fromSymbol)
        return null;
    const action = { id, type: 'tickerChange', effectiveDate, fromSymbol, toSymbol: next, createdAt };
    project.corporateActions = [...(project.corporateActions || []), action];
    project.symbol = next;
    return action;
}
export function liquidationCashBreakdown(action) {
    const grossUSD = amount(action.grossProceedsUSD), feeUSD = amount(action.feeUSD), taxUSD = amount(action.taxUSD);
    return { grossUSD, feeUSD, taxUSD, netUSD: Math.max(0, grossUSD - feeUSD - taxUSD) };
}
export function recordLiquidation(project, input) {
    const cash = liquidationCashBreakdown(input);
    const action = { id: input.id, type: 'liquidation', effectiveDate: input.effectiveDate, grossProceedsUSD: cash.grossUSD, feeUSD: cash.feeUSD, taxUSD: cash.taxUSD, createdAt: input.createdAt || new Date().toISOString() };
    project.corporateActions = [...(project.corporateActions || []), action];
    project.status = 'liquidated';
    return action;
}
export function securityStateAt(project, asOf) {
    let symbol = ticker(project.symbol), status = 'active', liquidationNetUSD = 0;
    const actions = [...(project.corporateActions || [])].filter(action => action.effectiveDate <= asOf).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const firstTicker = actions.find(action => action.type === 'tickerChange')?.fromSymbol;
    if (firstTicker)
        symbol = firstTicker;
    for (const action of actions) {
        if (action.type === 'tickerChange' && action.toSymbol)
            symbol = action.toSymbol;
        if (action.type === 'liquidation') {
            status = 'liquidated';
            liquidationNetUSD += liquidationCashBreakdown(action).netUSD;
        }
    }
    if (!(project.corporateActions || []).length)
        status = project.status || 'active';
    return { symbol, status, liquidationNetUSD };
}
