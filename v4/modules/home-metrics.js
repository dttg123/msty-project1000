import { isDate, n, todayISO } from './utils.js';
import { dividendCashBreakdown } from './finance.js';
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
export function nextMilestone(calc) {
    const target = Math.max(1, n(calc.currentTarget));
    const thresholds = [.25, .5, .75, 1].map(ratio => ({ ratio, shares: target * ratio }));
    const next = thresholds.find((item) => calc.shares < item.shares - .000001);
    return next ? { ...next, remaining: Math.max(0, next.shares - calc.shares), reached: false } : { ratio: 1, shares: target, remaining: 0, reached: true };
}
export function buildHomeMetrics(calcs, dividendRows, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), todayString = iso(today), currentMonth = monthKey(today), currentYear = String(today.getFullYear());
    const actual = (dividendRows || []).filter((row) => isDate(row.date) && row.date <= todayString && dividendCashBreakdown(row).status === 'actual' && dividendCashBreakdown(row).netUSD > 0);
    const sum = (rows) => rows.reduce((total, row) => total + dividendCashBreakdown(row).netUSD, 0);
    const monthRows = actual.filter((row) => row.date.startsWith(currentMonth));
    const yearRows = actual.filter((row) => row.date.startsWith(currentYear));
    const previousMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12), previousMonthKey = monthKey(previousMonthDate);
    const previousMonth = sum(actual.filter((row) => row.date.startsWith(previousMonthKey)));
    const previousYear = sum(actual.filter((row) => row.date.startsWith(String(today.getFullYear() - 1))));
    const months = Array.from({ length: 12 }, (_, index) => {
        const key = `${currentYear}-${String(index + 1).padStart(2, '0')}`, rows = actual.filter((row) => row.date.startsWith(key));
        return { key, label: `${index + 1}월`, actual: sum(rows), estimated: 0, count: rows.length };
    });
    const yearMap = new Map();
    actual.forEach((row) => { const key = row.date.slice(0, 4), item = yearMap.get(key) || { key, label: key, actual: 0, count: 0 }; item.actual += dividendCashBreakdown(row).netUSD; item.count++; yearMap.set(key, item); });
    const firstYear = yearMap.size ? Math.min(...[...yearMap.keys()].map(Number)) : null;
    const years = firstYear === null ? [] : Array.from({ length: Number(currentYear) - firstYear + 1 }, (_, index) => {
        const key = String(firstYear + index);
        return yearMap.get(key) || { key, label: key, actual: 0, count: 0 };
    });
    const trailingMonths = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(today.getFullYear(), today.getMonth() - 6 + index, 1, 12), key = monthKey(date);
        return { key, value: sum(actual.filter((row) => row.date.startsWith(key))) };
    });
    const previous3 = trailingMonths.slice(0, 3).reduce((a, b) => a + b.value, 0) / 3, recent3 = trailingMonths.slice(3).reduce((a, b) => a + b.value, 0) / 3;
    const firstRecordedMonth = actual.map(row => row.date.slice(0, 7)).sort()[0] || '';
    const recentAvailable = !!firstRecordedMonth && firstRecordedMonth <= trailingMonths[3].key;
    const comparisonAvailable = !!firstRecordedMonth && firstRecordedMonth <= trailingMonths[0].key;
    const projectMonth = calcs.map((calc) => ({
        projectId: calc.project.id,
        symbol: calc.project.symbol,
        actual: sum(monthRows.filter((row) => row.projectId === calc.project.id)),
        count: monthRows.filter((row) => row.projectId === calc.project.id).length
    })).filter((row) => row.actual > 0).sort((a, b) => b.actual - a.actual);
    const goals = calcs.map((calc) => ({ calc, milestone: nextMilestone(calc) })).sort((a, b) => {
        if (a.milestone.reached !== b.milestone.reached)
            return a.milestone.reached ? 1 : -1;
        return a.milestone.remaining / Math.max(1, a.calc.currentTarget) - b.milestone.remaining / Math.max(1, b.calc.currentTarget);
    });
    const ownedGoals = goals.filter((item) => item.calc.shares > 0);
    const monthActual = sum(monthRows), yearActual = sum(yearRows);
    return {
        month: { actual: monthActual, count: monthRows.length, previous: previousMonth, change: previousMonth > 0 ? (monthActual / previousMonth - 1) * 100 : null, remaining: 0, total: monthActual },
        year: { actual: yearActual, count: yearRows.length, previous: previousYear, change: previousYear > 0 ? (yearActual / previousYear - 1) * 100 : null, remaining: 0, total: yearActual },
        pace: { monthly: recent3, annualized: recent3 * 12, change: comparisonAvailable && previous3 > 0 ? (recent3 / previous3 - 1) * 100 : null, available: recentAvailable, recentFrom: trailingMonths[3].key, recentTo: trailingMonths[5].key, previousFrom: trailingMonths[0].key, previousTo: trailingMonths[2].key },
        months, years, projectMonth, nextDividend: null, forecast: [], missingEstimateCount: 0, nextGoal: (ownedGoals.length ? ownedGoals : goals)[0] || null
    };
}
// Inputs are actual posted receipts, converted for display at the saved reference rate.
export function dividendGoalStatus(settings, monthUSD, yearUSD) {
    const target = Math.max(0, n(settings.targetMonthlyDividend)), rate = Math.max(0, n(settings.exchangeRate));
    const annual = Math.round(Math.max(0, n(yearUSD)) * rate), limit = Math.max(1, n(settings.thresholdKRW)), early = Math.min(limit, Math.max(0, n(settings.warningKRW)));
    return { target, monthActual: Math.max(0, n(monthUSD)), monthPct: target > 0 ? Math.max(0, n(monthUSD)) / target * 100 : null, monthRemaining: Math.max(0, target - n(monthUSD)), annual, limit, early, annualRemaining: Math.max(0, limit - annual), alert: settings.dividendAlertEnabled === false ? 'off' : annual >= limit ? 'reached' : early > 0 && annual >= early ? 'early' : 'normal' };
}
export function estimateShareGoal(remaining, monthlyPlan, trades, splits, today = todayISO(), historyComplete = true) {
    const [year, month] = today.split('-').map(Number);
    const monthAt = (offset) => new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
    const latest = monthAt(-1), oldest = monthAt(-3);
    const posted = trades.filter(row => isDate(row.date) && row.date <= today && row.shares > 0);
    const first = posted.reduce((date, row) => date && date < row.date ? date : row.date, '').slice(0, 7);
    const splitRows = splits.filter(row => isDate(row.date) && row.date >= oldest && row.date <= today && row.from > 0 && row.to > 0)
        .sort((a, b) => b.date.localeCompare(a.date));
    const monthly = new Map();
    let factor = 1, index = 0;
    for (const row of posted.filter(row => row.date >= oldest).sort((a, b) => b.date.localeCompare(a.date))) {
        while (index < splitRows.length && splitRows[index].date > row.date) {
            const split = splitRows[index++];
            factor *= split.to / split.from;
        }
        if (row.type === 'buy' && row.buyType === 'opening')
            continue;
        const key = row.date.slice(0, 7), shares = row.shares * factor * (row.type === 'sell' ? -1 : 1);
        monthly.set(key, (monthly.get(key) || 0) + shares);
    }
    const recent = [oldest, monthAt(-2), latest].map(key => ({ key, shares: monthly.get(key) || 0 }));
    const recentOne = recent.slice(-1);
    const windows = historyComplete && first ? (first <= oldest ? [recent, recentOne] : first <= latest ? [recentOne] : []) : [];
    const candidates = windows.map(months => ({ months, rate: months.reduce((sum, row) => sum + row.shares, 0) / months.length }));
    // A flat or negative three-month pace falls back to the last completed month.
    const automatic = candidates.find(({ rate }) => Number.isFinite(rate) && rate > 1e-8);
    const rate = automatic?.rate ?? monthlyPlan;
    const count = remaining > 0 && Number.isFinite(rate) && rate > 0 ? Math.max(1, Math.ceil(remaining / rate - 1e-9)) : 0;
    const eta = count > 0 && count < (10000 - year) * 12 - month + 1 ? monthAt(count) : '';
    return { eta, rate, months: automatic?.months ?? [], observedMonths: candidates[0]?.months ?? [], thisMonth: monthly.get(today.slice(0, 7)) || 0 };
}
