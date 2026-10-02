import { PROJECT_COLORS } from './constants.js';
import { n } from './utils.js';
export function createFormatters(getState) {
    function displayCurrency() {
        return getState().settings.displayCurrency === 'KRW' ? 'KRW' : 'USD';
    }
    function fmtDividend(row, digits = 2) {
        if (row.currency === 'KRW')
            return displayCurrency() === 'KRW' ? `${Math.round(n(row.amountKRW)).toLocaleString('ko-KR')}원` : `≈ ${fmtMoney(n(row.amountKRW) / Math.max(.000001, n(getState().settings.exchangeRate)), digits)}`;
        return fmtMoney(row.amountUSD, digits);
    }
    function fmtMoney(usd, digits = 2) {
        const state = getState();
        if (displayCurrency() === 'KRW')
            return `${Math.round(n(usd) * Math.max(0, n(state.settings.exchangeRate))).toLocaleString('ko-KR')}원`;
        return `${n(usd) < 0 ? '-' : ''}$${Math.abs(n(usd)).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
    }
    const fmtSignedMoney = (usd) => `${n(usd) >= 0 ? '+' : '-'}${fmtMoney(Math.abs(n(usd)))}`;
    const fmtShares = (value) => n(value).toLocaleString('en-US', { maximumFractionDigits: 4 });
    const fmtPct = (value) => `${n(value).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    const fmtDate = (value) => {
        if (!value)
            return '-';
        const [year, month, day] = String(value).slice(0, 10).split('-');
        return `${year}.${month}.${day}`;
    };
    const signClass = (value) => n(value) > 0 ? 'positive' : n(value) < 0 ? 'negative' : '';
    const projectColors = (project) => PROJECT_COLORS[n(project?.colorIndex) % PROJECT_COLORS.length] || PROJECT_COLORS[0];
    return { fmtDividend, displayCurrency, fmtMoney, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors };
}
