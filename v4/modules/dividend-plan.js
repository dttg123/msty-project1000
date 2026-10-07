import { n } from './utils.js';
export function dividendPlanStatus(calc, now = Date.now()) {
    const mode = calc.project.dividendPlan?.mode || 'reinvest';
    const timestamp = Date.parse(calc.project.priceUpdatedAt || '');
    const fresh = calc.priceAvailable && calc.shares > 0 && Number.isFinite(timestamp) && now - timestamp >= -300000 && now - timestamp <= 7 * 86400000;
    const pnl = calc.priceUnrealized;
    const suggested = fresh && Math.abs(pnl) > .005 ? (pnl > 0 ? 'outside' : 'reinvest') : null;
    return { mode, fresh, pnl, suggested: suggested !== mode ? suggested : null };
}
export function projectRecovery(calc) {
    const locked = calc.project.recovery.locked;
    const basis = locked ? Math.max(0, n(calc.project.recovery.basis)) : Math.max(0, calc.directBuyCost);
    const uses = calc.postedAdjustments.filter(row => (row.purpose === 'dividendUse' || row.purpose === 'recoveryWithdrawal') && row.amountUSD < 0 && (!locked || row.date >= calc.project.recovery.startDate));
    const total = uses.reduce((sum, row) => sum - row.amountUSD, 0);
    return { basis, total, remaining: Math.max(0, basis - total), profit: Math.max(0, total - basis), pct: basis > 0 ? total / basis * 100 : 0, locked, uses };
}
export function hasNewDividendDeficit(before, after) {
    const previous = new Map(before.cashDeficitEvents.map(row => [row.kind + ':' + row.id, row.balance]));
    return after.cashDeficitEvents.some(row => row.balance < (previous.get(row.kind + ':' + row.id) ?? 0) - .000001);
}
