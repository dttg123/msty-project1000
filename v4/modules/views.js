import { dividendPlanStatus, projectRecovery } from './dividend-plan.js';
import { selectRecords, monthWeeks, historicalIncome } from './activity.js';
import { reportingDividends, isPostedDividend } from './finance.js';
import { APP_VERSION } from '../backup.js';
import { clamp, esc, isDate, n, todayISO } from './utils.js';
import { buildHomeMetrics, nextMilestone } from './home-metrics.js';
import { isRecord } from './utils.js';
const records = (value) => Array.isArray(value) ? value.filter(isRecord) : [];
export function createViews(context) {
    const { getState, getSelectedProjectId, setSelectedProjectId, getPortfolioGroup, setPortfolioGroup, getChartMode, getChartSelection, getHomeCashflowMode, getHomeYearRange, getHistoryLimit, getHistoryFilter, getChartMonth, getChartYear, getCashflowMonthKey, getCurrentUser, getAutoBackupStatus, getNativeTossStatus, getAppUpdateStatus, getExchangeRateStatus, getSaveSummary, getOfficialDistributionStatus, isTossBridgeConfigured, activeProjects, projectById, projectRows, computeProject, recoveryStats, totals, displayCurrency, fmtMoney, fmtDividend, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors } = context;
    const state = new Proxy({}, { get: (_, key) => Reflect.get(getState(), key) });
    function officialScheduleHTML(project) {
        const status = getOfficialDistributionStatus?.() || { feed: null, busy: false, error: '' }, feed = project.symbol === 'MSTY' ? status.feed : null;
        const manual = project.dividendAnnouncement, official = feed?.rows.find((row) => row.payDate >= todayISO()) || feed?.rows[0];
        const row = manual && manual.payDate >= todayISO() ? manual : official;
        const content = row ? `<p>${row.payDate >= todayISO() ? '공시 지급 예정' : '최근 공시 지급'} ${esc(row.payDate)} · 배당락 ${esc(row.exDate)}</p><p class="tiny muted">${row === manual ? '직접 기록한 공시' : '운용사 공시 · 세전 주당 $' + Number(('amountPerShareUSD' in row ? row.amountPerShareUSD : 0)).toFixed(4)} · 실제 계좌 입금일은 다를 수 있습니다.</p>${row === official && feed ? `<p class="tiny muted">자료 확인 ${esc(syncTime(feed.retrievedAt))}${Date.now() - Date.parse(feed.retrievedAt) > 3 * 86400000 ? ' · 최신 공시 재확인 필요' : ''}</p><a class="text-link" href="${esc(feed.sourceURL)}" target="_blank" rel="noopener noreferrer">운용사 원문 보기</a>` : ''}${row.payDate < todayISO() ? '<p class="tiny muted">다음 지급일은 아직 확인되지 않았습니다.</p>' : ''}` : '<p class="tiny muted">확인된 공시가 없습니다. 공시 지급일을 기록하면 여기에 표시합니다.</p>';
        return content + (project.symbol === 'MSTY' ? `<button class="text-link" style="margin-top:10px" data-refresh-official-distributions ${status.busy ? 'disabled' : ''}>${status.busy ? '공시 확인 중…' : '공시 갱신'}</button>${status.error ? `<p class="tiny muted">${esc(status.error)}</p>` : ''}` : '');
    }
    function syncTime(value) { const date = new Date(String(value || '')); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date) + ' (한국 시간)' : '기록 없음'; }
    function sectionTitle(title, note = '') { return `<div class="section-title-row"><h2 class="section-title">${esc(title)}</h2>${note ? `<span class="section-note">${esc(note)}</span>` : ''}</div>`; }
    function progress(value, color = '') { return `<div class="progress-track"><div class="progress-fill" style="width:${clamp(value, 0, 100)}%;${color ? `background:${color}` : ''}"></div></div>`; }
    function pricedMoney(calc, value, digits = 2) { return calc.priceAvailable ? fmtMoney(value, digits) : '—'; }
    const categoryLabel = (category) => category === 'highYield' ? '고배당주' : '배당주';
    const projectGroup = (project) => project?.category === 'highYield' ? 'highYield' : 'dividend';
    const finitePct = (value) => value === null || value === undefined || !Number.isFinite(value) ? '—' : fmtPct(value);
    function paymentTrendHTML(calc) {
        const rows = calc.income.payments.slice(0, 8), usePerShare = rows.length > 0 && rows.every((row) => row.known), ordered = [...rows].reverse(), values = ordered.map(row => usePerShare ? row.perShare : row.amount), max = Math.max(1, ...values), recent = rows.slice(0, 4), prior = rows.slice(4, 8), valueOf = (row) => usePerShare ? row.perShare : row.amount, average = (list) => list.length ? list.reduce((sum, row) => sum + valueOf(row), 0) / list.length : 0, recentAvg = average(recent), priorAvg = average(prior), change = recent.length === 4 && prior.length === 4 && priorAvg > 0 ? (recentAvg / priorAvg - 1) * 100 : null, perShare = usePerShare;
        if (!rows.length)
            return '<p class="empty-inline">실제 입금이 쌓이면 지급 추세를 보여줍니다.</p>';
        const latest = valueOf(rows[0]), previous = rows[1] ? valueOf(rows[1]) : 0, latestChange = previous > 0 ? (latest / previous - 1) * 100 : null;
        return `<div class="payment-trend-summary"><div><span>최근 지급</span><strong>${fmtMoney(latest, perShare ? 4 : 2)}${perShare ? ' / 주' : ''}</strong></div><div><span>직전 지급 대비</span><strong class="${latestChange === null ? '' : signClass(latestChange)}">${latestChange === null ? '비교 전' : `${latestChange >= 0 ? '+' : ''}${fmtPct(latestChange)}`}</strong></div></div><div class="payment-spark" aria-label="날짜별 실제 지급액">${ordered.map((row, index) => `<button type="button" ${row.ids?.[0] ? `data-view-record="dividend:${esc(row.ids[0])}"` : ''} aria-label="${esc(fmtDate(row.date))} ${esc(perShare ? fmtMoney(values[index], 4) + ' 주당' : fmtMoney(values[index], 2))}"><b>${esc(fmtMoney(values[index], perShare ? 4 : 0))}</b><i style="height:${Math.max(12, values[index] / max * 58)}px"></i><small>${esc(row.date.slice(5).replace('-', '.'))}</small></button>`).join('')}</div><div class="trend-sentence"><strong>${recent.length === 4 ? `최근 4회 평균 ${fmtMoney(recentAvg, perShare ? 4 : 2)}${perShare ? ' / 주' : ''}` : `최근 실제 지급 ${recent.length}회`}</strong><span class="${change === null ? '' : signClass(change)}">${change === null ? '각 막대를 누르면 해당 입금 기록을 확인합니다.' : `이전 4회 평균보다 ${change >= 0 ? '증가' : '감소'} ${fmtPct(Math.abs(change))}`}</span></div>${perShare ? '' : '<p class="detail-note">일부 기록에 지급 당시 주수가 없어 해당 회차는 실제 입금액으로 표시합니다.</p>'}`;
    }
    function annualDpsHTML(calc) {
        const analytics = calc.analytics, years = analytics.years.filter((row) => row.known && row.dps > 0).slice(-6), max = Math.max(1, ...years.map((row) => row.dps));
        const growthRates = [[3, analytics.cagr3], [5, analytics.cagr5], [10, analytics.cagr10]].filter(([, value]) => value !== null && value !== undefined && Number.isFinite(value));
        return `<div class="strategy-metrics two"><div><span>내 입력 기록 기준 배당률</span><strong>${analytics.trailingYoc === null ? '기록 부족' : fmtPct(analytics.trailingYoc)}</strong></div><div><span>입력 기록상 연속 증가</span><strong>${analytics.increaseStreak ? analytics.increaseStreak + '년' : '확인 전'}</strong></div></div>${years.length ? `<div class="annual-chart-heading"><strong>연도별 주당 세후 배당금</strong><span>입력된 주당 세후 금액 · 연간 누락 여부 미확인</span></div><div class="annual-dps-chart" aria-label="연도별 실제 주당 세후 배당금">${years.map((row) => `<div><small>${fmtMoney(row.dps, 2)}</small><b style="height:${Math.max(10, row.dps / max * 70)}px"></b><span>${row.year}년</span></div>`).join('')}</div>` : '<p class="empty-inline">완료된 연도 기록이 쌓이면 주당배당 성장을 보여줍니다.</p>'}${growthRates.length ? `<div class="growth-rate-heading">입력 기록상 연평균 증가율</div><div class="growth-rate-row">${growthRates.map(([period, value]) => `<span><b>최근 ${period}년</b><strong>${n(value) >= 0 ? '+' : ''}${fmtPct(value)}</strong></span>`).join('')}</div>` : ''}${analytics.cutCount ? `<p class="strategy-warning">기록상 배당 감소 ${analytics.cutCount}회</p>` : ''}`;
    }
    function strategyInsightHTML(calc) {
        if (calc.project.category === 'highYield')
            return `<div class="analysis-divider"><strong>${calc.income.payments.length && calc.income.payments.every((row) => row.known) ? '주당 실제 지급액' : '실제 입금액 추세'}</strong><span>최근 최대 8회</span></div>${paymentTrendHTML(calc)}<div class="strategy-metrics two easy-yield-metrics"><div><span>입력 기록 기준 배당률</span><strong>${calc.analytics.trailingYoc === null ? '기록 부족' : fmtPct(calc.analytics.trailingYoc)}</strong></div><div><span>투입금 대비 누적 배당률</span><strong>${calc.hasKRWDividends ? '달러 금액 미확인' : fmtPct(calc.lifetimeDividendRecoveryPct)}</strong></div></div><details class="metric-guide"><summary>지표 뜻 보기</summary><p><b>1년 배당률</b> 현재 보유분 매입금과 최근 1년 실제 세후 배당의 비율입니다.</p><p><b>누적 배당률</b> 직접 넣은 투자금과 지금까지 실제 세후 배당의 비율입니다. 원금 회수율은 아닙니다.</p></details>`;
        if (calc.project.category === 'growth')
            return `<div class="analysis-divider"><strong>주당배당 성장</strong><span>완료 연도 기준</span></div>${annualDpsHTML(calc)}<details class="metric-guide"><summary>계산 기준 보기</summary><p>분할을 보정한 실제 주당배당만 사용하며 진행 중인 연도는 성장률에서 제외합니다.</p></details>`;
        return `<div class="analysis-divider"><strong>배당 변화</strong><span>같은 기간 비교</span></div><div class="strategy-metrics two"><div><span>입력 기록 기준 배당률</span><strong>${calc.analytics.trailingYoc === null ? '기록 부족' : fmtPct(calc.analytics.trailingYoc)}</strong></div><div><span>전년 같은 기간 대비</span><strong class="${calc.analytics.ytdChange === null ? '' : signClass(calc.analytics.ytdChange)}">${finitePct(calc.analytics.ytdChange)}</strong></div></div><details class="metric-guide"><summary>지표 뜻 보기</summary><p>최근 1년 실제 세후 배당을 내 매입금과 비교하고, 올해 받은 배당을 지난해 같은 기간과 비교합니다.</p></details>`;
    }
    function dividendManagementHTML(calc) {
        const p = calc.project, status = dividendPlanStatus(calc), rec = projectRecovery(calc), reached = !!calc.targetReachedDate || rec.locked;
        const destination = { isa: 'ISA', otherDividend: '다른 배당주', living: '생활비', other: '기타' };
        return `<div class="detail-title"><strong>${reached ? '원금회수 현황' : '배당 사용 · 원금회수'}</strong><span class="phase-pill">${status.mode === 'reinvest' ? p.symbol + ' 재투자' : '외부 활용'}</span></div>
      ${status.suggested ? `<div class="dividend-plan-notice"><p>배당 제외 평가손익이 ${status.suggested === 'outside' ? '플러스' : '마이너스'}예요. ${status.suggested === 'outside' ? 'ISA·다른 배당주 활용' : '재투자 재개'}로 바꿀까요?</p><button class="btn primary small" data-dividend-mode="${esc(p.id)}:${status.suggested}">${status.suggested === 'outside' ? '외부 활용으로 변경' : '재투자로 변경'}</button></div>` : ''}
      <div class="recovery-hero"><span>${reached ? '남은 회수 원금' : '지금까지 외부 활용으로 회수'}</span><strong>${fmtMoney(reached ? rec.remaining : rec.total, 2)}</strong><small>${rec.basis > 0 ? fmtPct(rec.pct) + ' 회수' : '직접 투자금 기록 필요'} · ${rec.locked ? '기존 확정 기준 유지' : '직접 넣은 돈 기준'}</small></div>
      ${reached ? progress(rec.pct) : ''}
      <div class="lifecycle-actions"><button class="btn primary small" data-add-withdrawal="${esc(p.id)}">배당 사용 기록</button><button class="btn soft small" data-dividend-mode="${esc(p.id)}:${status.mode === 'reinvest' ? 'outside' : 'reinvest'}">${status.mode === 'reinvest' ? '외부 활용으로 변경' : '재투자로 변경'}</button></div>
      <details class="dividend-use-details"><summary>사용 내역 · 계산 기준</summary><div class="goal-info-rows"><div><span>${rec.locked ? '확정 회수 기준' : '직접 투자금 누계'}</span><strong>${fmtMoney(rec.basis, 2)}</strong></div><div><span>누적 세후배당 (USD 원본)</span><strong>${fmtMoney(calc.usdDividendsTotal, 2)}</strong></div><div><span>${esc(p.symbol)} 재투자 사용</span><strong>${fmtMoney(calc.reinvestAmount, 2)}</strong></div><div><span>외부 활용으로 회수</span><strong>${fmtMoney(rec.total, 2)}</strong></div><div><span>미사용 배당 잔액</span><strong>${fmtMoney(calc.dividendAvailable, 2)}</strong></div><div><span>남은 회수 원금</span><strong>${fmtMoney(rec.remaining, 2)}</strong></div>${rec.profit > 0 ? `<div><span>기준원금 초과 회수</span><strong>${fmtMoney(rec.profit, 2)}</strong></div>` : ''}<div><span>전환 판단용 평가손익</span><strong>${calc.priceAvailable ? fmtSignedMoney(status.pnl) : '현재가 필요'}</strong></div></div>
      <p class="detail-note">배당·ROC 조정 전 매입원가와 달러 시세로 판단합니다. 손익이 0이면 방향을 유지합니다. ${status.fresh ? '' : '시세가 없거나 7일 이상 지나 전환 안내를 보류합니다.'} 방향 변경은 실제 거래나 과거 기록을 바꾸지 않습니다.</p>
      <p class="detail-note">${esc(p.symbol)} 밖에서 사용한 배당만 회수에 포함합니다. ISA·다른 종목·생활비 사용을 기록하며 전체 계좌의 출금액을 뜻하지 않습니다. 재투자는 회수가 아닙니다. ${rec.locked ? '기존 확정 원금·시작일을 유지합니다.' : '새로 넣은 돈은 직접 투자금에 더해집니다. 매도대금은 이 배당 회수율에서 제외합니다.'} 잔액 보정은 회수로 계산하지 않습니다.</p>
      ${calc.hasKRWDividends ? '<p class="detail-note">원화 배당은 달러 사용 잔액에서 제외됩니다. 실제 달러 금액을 확인한 뒤 기록하세요.</p>' : ''}
      ${calc.unconfirmedFundingCount ? `<p class="detail-note funding-pending">토스 매수 ${calc.unconfirmedFundingCount}건의 자금 출처 미확인 · 직접 투자금은 잠정값입니다.</p><button class="btn soft small" data-review-funding="${esc(p.id)}">매수 자금 출처 확인</button>` : ''}
      ${rec.uses.length ? `<div class="list">${[...rec.uses].reverse().slice(0, 5).map(row => `<button class="list-row record-row-button" data-view-record="cash:${esc(row.id)}"><div><div class="row-title">${row.destination ? destination[row.destination] : '기존 배당 인출'}</div><div class="row-sub">${fmtDate(row.date)}</div></div><strong>${fmtMoney(-row.amountUSD, 2)}</strong></button>`).join('')}</div>` : ''}
      ${rec.locked ? `<button class="btn soft small" data-edit-recovery="${esc(p.id)}">기존 회수 기준 확인 · 수정</button>` : ''}
      ${p.dividendPlan?.history.length ? `<p class="detail-note">최근 방향 변경: ${p.dividendPlan.history.slice(-3).map(row => `${esc(row.confirmedAt.slice(0, 10))} ${row.mode === 'reinvest' ? '재투자' : '외부 활용'}`).join(' · ')}</p>` : ''}</details>`;
    }
    function lifecycleContent(calc) {
        return calc.project.category === 'highYield' ? dividendManagementHTML(calc) : '';
    }
    function periodKey(dateString, mode) {
        const date = new Date(`${dateString}T12:00:00`);
        if (Number.isNaN(date.getTime()))
            return '';
        if (mode === 'year')
            return String(date.getFullYear());
        if (mode === 'month')
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const day = (date.getDay() + 6) % 7;
        date.setDate(date.getDate() - day);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function chartSeries(projectId = null) {
        const today = todayISO(), rows = reportingDividends((projectId ? projectRows('dividends', projectId || '') : state.dividends).filter((row) => isDate(row.date) && isPostedDividend(row, today)), n(state.settings.exchangeRate));
        if (getChartMode() === 'month')
            return historicalIncome(rows, 'month', effectiveChartYear(rows), today);
        if (getChartMode() === 'year')
            return historicalIncome(rows, 'year', '', today);
        const grouped = new Map();
        rows.forEach((row) => { const key = periodKey(row.date, getChartMode()); if (key)
            grouped.set(key, (grouped.get(key) || 0) + n(row.amountUSD)); });
        const count = getChartMode() === 'year' ? 10 : 6;
        return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-count).map(([key, value]) => ({ key, label: getChartMode() === 'year' ? key : getChartMode() === 'month' ? `${key.slice(2, 4)}.${key.slice(5, 7)}` : `${key.slice(2, 4)}.${key.slice(5, 7)}/${key.slice(8, 10)}`, value }));
    }
    function effectiveChartYear(rows = []) {
        const chosen = String(getChartYear?.() || '');
        if (/^\d{4}$/.test(chosen))
            return chosen;
        return rows.map((row) => String(row.date || '').slice(0, 4)).filter((year) => /^\d{4}$/.test(year)).sort().at(-1) || todayISO().slice(0, 4);
    }
    function selectedChartRow(series, mode, chartMonth = '') {
        const chosen = series.find((row) => row.key === getChartSelection?.());
        if (chosen)
            return chosen;
        if (mode === 'month') {
            const current = todayISO().slice(0, 7), exact = series.find((row) => row.key === current && row.value > 0);
            return exact || [...series].reverse().find(row => row.value > 0) || series.at(-1);
        }
        if (mode === 'monthWeeks') {
            if (chartMonth === todayISO().slice(0, 7)) {
                const day = +todayISO().slice(8), index = Math.min(4, Math.floor((day - 1) / 7));
                return series[index] || series.at(-1);
            }
            return [...series].reverse().find(row => row.value > 0) || series.at(-1);
        }
        return series.at(-1);
    }
    function chartHTML(projectId = null) {
        const chartMonth = getChartMonth?.() || todayISO().slice(0, 7);
        const series = getChartMode() === 'monthWeeks' ? monthWeeks(reportingDividends(projectRows('dividends', projectId || '').filter((r) => isPostedDividend(r, todayISO())), n(state.settings.exchangeRate)), chartMonth).map((r) => ({ ...r, key: r.range })) : chartSeries(projectId), max = Math.max(1, ...series.map((x) => x.value));
        if (!series.length)
            return '<div class="empty">배당을 입력하면 실제 흐름이 표시됩니다.</div>';
        const selectedKey = selectedChartRow(series, getChartMode(), chartMonth)?.key || '';
        const chartMoney = (value) => {
            if (displayCurrency() === 'KRW') {
                const krw = n(value) * n(state.settings.exchangeRate);
                if (Math.abs(krw) >= 10000)
                    return `${(krw / 10000).toFixed(Math.abs(krw) >= 100000 ? 1 : 1)}만`;
                return `${Math.round(krw).toLocaleString('ko-KR')}원`;
            }
            return `$${n(value).toLocaleString('en-US', { minimumFractionDigits: value && Math.abs(value) < 1000 ? 2 : 0, maximumFractionDigits: Math.abs(value) < 1000 ? 2 : 0 })}`;
        };
        const modeClass = getChartMode() === 'month' ? 'month-chart' : getChartMode() === 'year' ? 'year-chart wide-chart' : 'fit-chart';
        return `<div class="column-chart compact-chart ${modeClass}">${series.map((x) => `<button class="column-item ${selectedKey === x.key ? 'active' : ''}" type="button" data-chart-key="${esc(x.key)}" aria-label="${esc(x.label)} 배당 ${esc(fmtMoney(x.value, 2))}"><div class="column-value" title="${esc(fmtMoney(x.value, 2))}">${esc(chartMoney(x.value))}</div><div class="column-track"><div class="column-fill" style="height:${x.value > 0 ? Math.max(7, x.value / max * 100) : 0}%"></div></div><div class="column-label">${esc(getChartMode() === 'month' ? `${+x.key.slice(5)}월` : getChartMode() === 'week' ? x.label.slice(3) : x.label)}</div></button>`).join('')}</div>`;
    }
    function chartSelectionHTML(projectId) {
        const chartMonth = getChartMonth?.() || todayISO().slice(0, 7), series = getChartMode() === 'monthWeeks' ? monthWeeks(reportingDividends(projectRows('dividends', projectId || '').filter((r) => isPostedDividend(r, todayISO())), n(state.settings.exchangeRate)), chartMonth).map((r) => ({ ...r, key: r.range })) : chartSeries(projectId);
        if (!series.length)
            return '';
        const mode = getChartMode(), selected = selectedChartRow(series, mode, chartMonth), label = mode === 'year' ? `${selected.key}년` : mode === 'month' ? `${selected.key.replace('-', '년 ')}월` : selected.label;
        const count = mode === 'year' || mode === 'month' ? projectRows('dividends', projectId || '').filter((row) => row.date <= todayISO() && row.date.startsWith(selected.key)).length : null;
        return `<div class="chart-selection-inline"><div><span>${esc(label)} 실제 입금</span><strong>${fmtMoney(selected.value, 2)}</strong>${count !== null ? `<small>${count}회</small>` : ''}</div>${mode === 'month' && count ? `<button class="btn soft small" data-income-month="${esc(selected.key)}" data-income-project="${esc(projectId)}">입금 ${count}건 보기</button>` : ''}</div>`;
    }
    function chartContextHTML(calc) {
        const mode = getChartMode();
        if (mode === 'month') {
            const year = effectiveChartYear(calc.postedDividends);
            return `<div class="chart-context-line year-stepper"><span>달력 월별 실제 입금</span><div><button type="button" data-chart-year-shift="-1" aria-label="이전 연도">‹</button><strong>${year}년</strong><button type="button" data-chart-year-shift="1" aria-label="다음 연도">›</button></div></div>`;
        }
        if (mode === 'monthWeeks')
            return `<div class="chart-context-line month-stepper"><label for="chartMonth">주차를 볼 월</label><input id="chartMonth" class="input" type="month" value="${esc(getChartMonth?.() || todayISO().slice(0, 7))}" data-chart-month></div>`;
        if (mode === 'year')
            return '<div class="chart-context-line"><span>연도별 실제 입금</span><b>좌우로 밀어 확인</b></div>';
        return '<div class="chart-context-line"><span>최근 지급 회차</span><b>최근 6회</b></div>';
    }
    function cashflowChart(items, selectedKey, mode) {
        const max = Math.max(1, ...items.map((item) => item.actual));
        return `<div class="cashflow-chart actual-only ${mode === 'year' ? 'year-bars' : ''}" aria-label="${mode === 'year' ? '연도별' : '월별'} 실제 배당">${items.map((item) => `<button class="cashflow-month ${item.key === selectedKey ? 'active' : ''}" type="button" data-cashflow-period="${esc(item.key)}" aria-label="${esc(item.label)} 실제 배당 ${esc(fmtMoney(item.actual, 2))}"><div class="cashflow-bars"><i class="cashflow-actual" style="height:${item.actual > 0 ? Math.max(5, item.actual / max * 112) : 0}px"></i></div><span>${esc(mode === 'year' ? item.label : item.label.replace('월', ''))}</span></button>`).join('')}</div>`;
    }
    function renderHome() {
        const reportRows = reportingDividends(state.dividends.filter((row) => isPostedDividend(row, todayISO())), n(state.settings.exchangeRate));
        const total = totals(), metrics = buildHomeMetrics(total.rows, reportRows), goal = metrics.nextGoal, paceChange = metrics.pace.change, currentMonth = todayISO().slice(0, 7), mode = getHomeCashflowMode?.() || 'month', yearRange = getHomeYearRange?.() || '6', yearCount = yearRange === 'all' ? metrics.years.length : Number(yearRange), series = mode === 'year' ? metrics.years.slice(-yearCount) : metrics.months, defaultKey = mode === 'year' ? (series.at(-1)?.key || String(new Date().getFullYear())) : currentMonth, selectedKey = series.some((item) => item.key === getCashflowMonthKey?.()) ? getCashflowMonthKey() : defaultKey, selected = series.find((item) => item.key === selectedKey) || { key: selectedKey, label: selectedKey, actual: 0, count: 0 };
        const selectedRows = reportRows.filter((row) => isDate(row.date) && row.date <= todayISO() && row.date.startsWith(selectedKey)), projectMap = new Map(activeProjects().map((project) => [project.id, project])), symbolRows = [...selectedRows.reduce((map, row) => { const project = projectMap.get(row.projectId), symbol = project?.symbol || '보관 종목', item = map.get(symbol) || { symbol, value: 0, project }; item.value += n(row.amountUSD); map.set(symbol, item); return map; }, new Map()).values()].sort((a, b) => b.value - a.value), topSymbols = symbolRows.slice(0, 4), other = symbolRows.slice(4).reduce((sum, row) => sum + row.value, 0), composition = other ? [...topSymbols, { symbol: '기타', value: other, project: null }] : topSymbols, compositionTotal = Math.max(1, composition.reduce((sum, row) => sum + row.value, 0)), compositionColor = (row, index) => row.project ? projectColors(row.project)[0] : `hsl(${225 + index * 24} 18% ${55 - index * 3}%)`;
        document.getElementById('page-home').innerHTML = `${sectionTitle('홈', '세후 배당')}
      <div class="stack home-flow home-redesign">
        <article class="card month-overview">
          <div class="overview-heading"><h3>이번 달 받은 배당</h3><span>${new Date().getMonth() + 1}월</span></div>
          <div class="hero-label">실제 세후 입금</div>${state.dividends.some((row) => row.currency === "KRW") ? '<p class="tiny muted">원화 확인액 보존 · 달러 표시는 현재 환율 참고값</p>' : ''}
          <div class="hero-amount">${fmtMoney(metrics.month.actual, 2)}</div>
          <div class="month-parts"><div><span>입금 횟수</span><strong>${metrics.month.count}회</strong></div><div><span>지난달 대비</span><strong class="${metrics.month.change === null ? '' : signClass(metrics.month.change)}">${metrics.month.change === null ? '비교 전' : fmtPct(metrics.month.change)}</strong></div></div>
        </article>
        <article class="card cashflow-card history-overview">
          <div class="overview-heading"><h3>배당 현금흐름</h3><div class="cashflow-mode"><button class="${mode === 'month' ? 'active' : ''}" data-home-cashflow-mode="month">월별</button><button class="${mode === 'year' ? 'active' : ''}" data-home-cashflow-mode="year">연도별</button></div></div>
          <p class="chart-instruction">막대를 누르면 해당 기간의 실제 입금 구성이 바뀝니다.</p>
          ${mode === 'year' ? `<div class="year-range-switch" aria-label="연도 표시 범위">${[['6', '최근 6년'], ['10', '10년'], ['all', '전체']].map(([value, label]) => `<button class="${yearRange === value ? 'active' : ''}" data-home-year-range="${value}">${label}</button>`).join('')}</div>` : ''}
          ${cashflowChart(series, selectedKey, mode)}
          ${mode === 'year' && yearRange === 'all' && metrics.years.length > 10 ? `<div class="five-year-summary">${Array.from({ length: Math.ceil(metrics.years.length / 5) }, (_, index) => metrics.years.slice(index * 5, index * 5 + 5)).map(group => `<div><span>${group[0].key}–${group.at(-1)?.key}</span><strong>${fmtMoney(group.reduce((sum, row) => sum + row.actual, 0), 0)}</strong></div>`).join('')}</div>` : ''}
          <div class="cashflow-selection"><div><span>${mode === 'year' ? `${selectedKey}년` : `${selectedKey.replace('-', '년 ')}월`}</span><strong>${fmtMoney(selected.actual, 2)}</strong><small>${selectedRows.length}회 입금</small></div>${composition.length > 1 ? `<div class="composition-bar" aria-label="종목별 실제 배당 비중">${composition.map((row, index) => `<i style="width:${row.value / compositionTotal * 100}%;--segment:${compositionColor(row, index)}" title="${esc(row.symbol)} ${esc(fmtMoney(row.value, 2))}"></i>`).join('')}</div><div class="composition-legend">${composition.map((row, index) => `<span><i style="--dot:${compositionColor(row, index)}"></i>${esc(row.symbol)} <b>${fmtMoney(row.value, 0)}</b></span>`).join('')}</div>` : '<p class="single-symbol-note">' + (composition[0] ? `${esc(composition[0].symbol)}에서 받은 실제 배당입니다.` : '이 기간의 입금 기록이 없습니다.') + '</p>'}</div>
          ${mode === 'month' ? `<button class="card-link" data-income-month="${selectedKey}"><span>날짜별 입금 상세</span><b>›</b></button>` : ''}
          <div class="cashflow-year-summary">
            <div><span>올해 받은 배당</span><strong>${fmtMoney(metrics.year.actual, 2)}</strong></div>
            <div><span>지난해 총 배당</span><strong>${fmtMoney(metrics.year.previous, 2)}</strong></div>
          </div>
          <div class="cashflow-pace-summary"><div><span>최근 3개월 월평균</span><strong>${metrics.pace.available ? fmtMoney(metrics.pace.monthly, 2) : '기록 부족'}</strong></div><div><span class="${paceChange === null ? '' : signClass(paceChange)}">${paceChange === null ? '비교 전' : fmtPct(paceChange)}</span><small>직전 3개월 대비</small></div></div>
        </article>
        <article class="card compact next-card ${goal ? 'interactive-card' : ''}" ${goal ? `data-goal-detail="${goal.calc.project.id}" tabindex="0" role="button"` : ''}><div class="card-kicker">다음 목표</div>${goal ? `<div class="next-line"><div><strong>${esc(goal.calc.project.symbol)} · ${goal.milestone.reached ? '목표 달성' : `${fmtShares(goal.milestone.shares)}주`}</strong><span>현재 ${fmtShares(goal.calc.shares)}주${goal.milestone.reached ? ' · 현금흐름 단계' : ` · ${fmtShares(goal.milestone.remaining)}주 남음`}</span></div><b>›</b></div>` : '<div class="empty-inline">종목을 추가하면 가장 가까운 목표를 보여줍니다.</div>'}</article>
      </div>`;
        if (mode === 'year' && typeof requestAnimationFrame === 'function')
            requestAnimationFrame(() => document.querySelector('#page-home .cashflow-month.active')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
    }
    function combinedRecords(calc) {
        return [
            ...calc.trades.map((row) => ({ ...row, kind: 'trade' })),
            ...calc.dividends.map((row) => ({ ...row, kind: 'dividend' })),
            ...projectRows('splits', calc.project.id).map((row) => ({ ...row, kind: 'split' })),
            ...calc.adjustments.map((row) => ({ ...row, kind: 'cash' }))
        ].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)));
    }
    function recordRow(row) {
        let title = '', sub = '', value = '', cls = '';
        const future = String(row.date) > todayISO();
        if (row.kind === 'trade') {
            title = row.type === 'buy' && row.dividendFunding && row.dividendFunding.sourceFingerprint === row.source?.sourceFingerprint ? (row.dividendFunding.amountUSD > 0 ? '매수 · 배당 사용 ' + fmtMoney(row.dividendFunding.amountUSD, 2) : '매수 · 직접 투자') : row.type === 'sell' ? '매도' : row.buyType === 'reinvest' ? '배당재투자' : row.buyType === 'mixed' ? '혼합매수' : row.buyType === 'opening' ? '초기보유' : '직접매수';
            sub = `${fmtDate(row.date)} · ${fmtShares(row.shares)}주 · 단가 ${fmtMoney(row.price)}${row.source?.provider === 'toss' ? ' · 토스 승인' : ''}`;
            value = `${row.type === 'sell' ? '+' : '-'}${fmtMoney(n(row.shares) * n(row.price))}`;
            cls = row.type === 'sell' ? 'positive' : '';
        }
        if (row.kind === 'dividend') {
            const perShare = row.currency !== 'KRW' && n(row.sharesAtPayment) > 0 ? n(row.amountUSD) / n(row.sharesAtPayment) : 0;
            title = '세후배당' + (row.rocPercent !== null && row.rocPercent !== undefined ? ` · ROC ${n(row.rocPercent)}% (${row.rocStatus === 'final' ? '확정' : '추정'})` : '');
            sub = `${fmtDate(row.date)}${perShare ? ` · 주당 ${fmtMoney(perShare, 4)}` : ''}${row.note ? ` · ${esc(row.note)}` : ''}`;
            value = `+${fmtDividend ? fmtDividend(row) : fmtMoney(row.amountUSD)}`;
            cls = 'positive';
        }
        if (row.kind === 'split') {
            title = row.type === 'reverse' ? '역분할' : '주식분할';
            sub = `${fmtDate(row.date)} · ${row.from}:${row.to}`;
            value = '비율 반영';
        }
        if (row.kind === 'cash') {
            const withdrawal = row.purpose === 'recoveryWithdrawal' || row.purpose === 'dividendUse';
            title = withdrawal ? esc(row.label || '배당금 인출') : esc(row.label || '배당 잔액 보정');
            sub = `${fmtDate(row.date)}${withdrawal ? ' · 원금회수 반영' : ''}`;
            value = withdrawal ? `-${fmtMoney(Math.abs(n(row.amountUSD)))}` : fmtSignedMoney(row.amountUSD);
            cls = withdrawal ? '' : n(row.amountUSD) >= 0 ? 'positive' : 'negative';
        }
        if (future)
            sub += `${sub ? ' · ' : ''}미래 기록 · 현재 계산 제외`;
        return `<button type="button" class="list-row record-row-button" data-view-record="${row.kind}:${row.id}" aria-label="${esc(title)} 기록 상세"><div><div class="row-title">${title}</div><div class="row-sub">${sub}</div></div><div class="record-value"><div class="row-value ${cls}">${value}</div><span class="record-chevron">상세 ›</span></div></button>`;
    }
    function renderProjects() {
        const allProjects = activeProjects(), group = getPortfolioGroup?.() === 'dividend' ? 'dividend' : 'highYield', projects = allProjects.filter((project) => projectGroup(project) === group), counts = { highYield: allProjects.filter((project) => projectGroup(project) === 'highYield').length, dividend: allProjects.filter((project) => projectGroup(project) === 'dividend').length };
        let selectedProjectId = getSelectedProjectId();
        if (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId)) {
            selectedProjectId = projects[0]?.id || '';
            setSelectedProjectId(selectedProjectId);
        }
        const calc = projects.length ? computeProject(selectedProjectId) : null, page = document.getElementById('page-projects'), groupTabs = `<div class="portfolio-group-tabs" aria-label="포트폴리오 분류"><button type="button" data-portfolio-group="highYield" class="${group === 'highYield' ? 'active' : ''}"><span>고배당주</span><b>${counts.highYield}</b></button><button type="button" data-portfolio-group="dividend" class="${group === 'dividend' ? 'active' : ''}"><span>배당주</span><b>${counts.dividend}</b></button></div>`;
        if (!page)
            return;
        if (!allProjects.length) {
            page.innerHTML = `${sectionTitle('포트폴리오')}<article class="card empty-project"><p>아직 등록된 종목이 없습니다.</p><button class="btn primary" data-add-project>종목 추가</button></article>`;
            return;
        }
        if (!calc) {
            page.innerHTML = `<div class="section-title-row"><h2 class="section-title">포트폴리오</h2><button class="btn soft small" data-add-project>＋ 종목</button></div>${groupTabs}<article class="card empty-project"><p>${group === 'highYield' ? '고배당주' : '배당주'}로 묶인 종목이 없습니다.</p><button class="btn primary" data-add-project>종목 추가</button></article>`;
            return;
        }
        if (!calc)
            return;
        const p = calc.project, colors = projectColors(p), rec = recoveryStats(calc), pct = calc.progress * 100, allRows = combinedRecords(calc), filter = getHistoryFilter?.() || {}, rows = selectRecords(allRows, filter), historyLimit = getHistoryLimit?.() || 10;
        const milestone = nextMilestone(calc), groupLabel = group === 'highYield' ? '고배당주' : '배당주';
        page.innerHTML = `
      <div class="section-title-row"><h2 class="section-title">포트폴리오</h2><button class="btn soft small" data-add-project>＋ 종목</button></div>
      ${groupTabs}
      ${projects.length === 1 ? '' : projects.length > 4 ? `<label class="project-select-label">종목 선택<select class="input" data-project-select>${projects.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.symbol)}</option>`).join('')}</select></label>` : `<div class="project-tabs">${projects.map((x) => `<button class="project-tab ${x.id === p.id ? 'active' : ''}" data-select-project="${x.id}">${esc(x.symbol)}</button>`).join('')}</div>`}
      <div class="stack portfolio-stack">
        <article class="card portfolio-summary" style="--project-a:${colors[0]};--project-b:${colors[1]}">
          <div class="portfolio-heading"><div><div class="project-symbol">${esc(p.symbol)}</div><div class="project-name">${esc(p.name)}</div><div class="project-tags"><span class="strategy-tag">${esc(categoryLabel(p.category))}</span>${(p.brokerLinks || []).some((link) => link.provider === 'toss') ? '<span class="sync-tag">토스 연결</span>' : ''}</div></div><button class="btn soft small project-settings-shortcut" data-project-settings aria-label="${esc(p.symbol)} 종목 설정">설정</button></div>
          <div class="value-line"><div class="value-caption"><span>평가금액</span><small>${calc.priceAvailable ? `시세 ${p.priceSource === 'toss' ? '토스' : '직접 입력'} · ${esc(syncTime(p.priceUpdatedAt))}` : '현재가 미입력'}</small></div><strong>${calc.priceAvailable ? fmtMoney(calc.marketValue) : '—'}</strong><small class="${calc.totalReturn !== null ? signClass(calc.totalReturn) : ''}">${calc.totalReturn !== null ? `배당 포함 총손익 ${fmtSignedMoney(calc.totalReturn)}` : calc.hasKRWDividends ? '총손익 보류 · 달러 배당액 미확인' : '현재가가 연결되면 총손익을 계산합니다.'}</small></div>
          <div class="holding-row"><div><span>보유주수</span><strong>${fmtShares(calc.shares)}주</strong></div><div><span>평균단가</span><strong>${fmtMoney(calc.avgCost)}</strong></div></div>
          <details class="performance-breakdown"><summary>배당 포함 총손익 구성 <b>⌄</b></summary><div class="performance-rows"><div><span>평가손익</span><strong class="${calc.priceAvailable ? signClass(calc.unrealized) : ''}">${pricedMoney(calc, calc.unrealized)}</strong></div><div><span>실현손익</span><strong class="${signClass(calc.realized)}">${fmtSignedMoney(calc.realized)}</strong></div><div><span>누적 세후배당</span><strong class="positive">${fmtMoney(calc.dividendsTotal)}</strong></div></div></details>
        </article>
        <article class="card portfolio-cashflow compact-income dividend-analysis-card">
          <div class="overview-heading"><h3>배당 분석</h3><button class="text-link" data-quick-dividend>＋ 입금 기록</button><span>${calc.income.spec.label}${calc.income.spec.automatic ? ' · 자동' : ''} · 세후</span></div>
          <div class="portfolio-income-hero"><span>이번 달 실제 배당</span><strong>${fmtMoney(calc.currentMonthDividends, 2)}</strong></div>
          <div class="cashflow-secondary"><div><span>누적 세후배당</span><strong>${fmtMoney(calc.dividendsTotal, 2)}</strong></div><div><span>최근 12개월 실제</span><strong>${fmtMoney(calc.analytics.trailingNet, 2)}</strong></div>${calc.hasKRWDividends ? '<div><span>달러 배당 잔액</span><strong>달러 금액 미확인</strong></div>' : Math.abs(calc.dividendAvailable - calc.dividendsTotal) > .01 ? `<div><span>남은 배당금</span><strong>${fmtMoney(calc.dividendAvailable, 2)}</strong></div>` : calc.reinvestAmount > 0 ? `<div><span>재투자 사용</span><strong>${fmtMoney(calc.reinvestAmount, 2)}</strong></div>` : ''}</div>
          <p class="detail-note">입력된 기록 ${calc.postedDividends.length}건${calc.postedDividends.length ? ` · ${esc(calc.postedDividends[0].date)}부터` : ""} · 누락 여부 미확인${calc.hasKRWDividends ? " · 원화 원본 보존, 달러 표시는 현재 환율 참고값" : ""}</p><details class="analysis-details"><summary>배당률 · 지급 추세 자세히 보기</summary>${strategyInsightHTML(calc)}</details>
        </article>
        ${p.category === 'highYield' ? `<article class="card dividend-management">${dividendManagementHTML(calc)}</article>` : ''}
        <button class="card-link" data-goal-detail="${p.id}"><span>${rec.stage !== 'accumulating' ? '달성 · 원금회수 관리' : '다음 목표 ' + fmtShares(milestone.shares) + '주'}</span><b>›</b></button>
        <article class="card compact"><div class="detail-title"><strong>공시 배당 일정</strong><button class="text-link" data-dividend-schedule="${p.id}">직접 기록</button></div>${officialScheduleHTML(p)}</article>
        <article class="card portfolio-section portfolio-flow-card"><div class="detail-title"><strong>실제 입금 흐름</strong><div class="chart-period">${[['week', '주'], ['month', '월'], ['year', '년'], ['monthWeeks', '주차']].map(([mode, label]) => `<button type="button" data-chart-mode="${mode}" class="${getChartMode() === mode ? 'active' : ''}">${label}</button>`).join('')}</div></div><div class="portfolio-chart-stage">${chartContextHTML(calc)}<div id="projectChart">${chartHTML(p.id)}</div>${chartSelectionHTML(p.id)}</div></article>
        <details class="card record-center">
          <summary><div><strong>기록</strong><span>${rows.length}건 · 거래·배당·인출·분할</span></div><b class="chev">⌄</b></summary>
          <div class="transaction-body"><form id="historyFilterForm" class="history-filter"><label>기간<input class="input" type="month" name="month" value="${esc(filter.month || '')}"></label><label>유형<select class="input" name="kind">${[['', '전체'], ['trade', '거래'], ['dividend', '배당'], ['split', '분할'], ['cash', '인출·잔액']].map(([value, label]) => `<option value="${value}" ${filter.kind === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="history-query">날짜 · 메모 · 금액<input class="input" type="search" name="query" value="${esc(filter.query || '')}" placeholder="기록 검색"></label><button class="btn soft" type="submit">조회</button><button class="btn soft" type="button" data-history-reset>전체 보기</button></form><p class="tiny muted">${rows.length}건 / 전체 ${allRows.length}건</p><div class="list records-list">${rows.slice(0, historyLimit).map(recordRow).join('') || '<div class="empty">조건에 맞는 기록이 없습니다.</div>'}</div>${rows.length > historyLimit ? `<button class="btn soft history-more" data-history-more>이전 기록 10건 더 보기 (${rows.length - historyLimit}건 남음)</button>` : ''}<details class="manual-tools embedded-tools"><summary><div><strong>직접 입력 · 보정</strong><span>토스 미연동·누락 기록만 보정</span></div><b class="chev">⌄</b></summary><div class="manual-tools-body"><div class="support-actions"><button class="btn soft small" data-edit-price>현재가</button><button class="btn soft small" data-add-trade>거래</button><button class="btn soft small" data-add-dividend>배당 입금</button><button class="btn soft small" data-add-cash>잔액 보정</button><button class="btn soft small" data-add-split>분할·역분할</button><button class="btn soft small" data-project-check>점검</button></div></div></details></div>
        </details>
      </div>`;
    }
    function estimatedDate(calc, targetShares = calc.currentTarget) {
        const plan = Math.max(0, n(calc.project.monthlyPlanShares)), remaining = Math.max(0, targetShares - calc.shares);
        if (remaining <= 0)
            return '달성 완료';
        if (plan <= 0)
            return '월 매수계획 필요';
        const now = new Date(), date = new Date(now.getFullYear(), now.getMonth() + Math.ceil(remaining / plan), 1);
        return `${date.getFullYear()}년 ${date.getMonth() + 1}월 예상`;
    }
    function renderGoals() {
        const rows = totals().rows;
        document.getElementById('page-goal').innerHTML = `${sectionTitle('다음 목표', '가장 가까운 단계만')}
      <div class="stack">${rows.map((calc) => {
            const p = calc.project, colors = projectColors(p), milestone = nextMilestone(calc), rec = p.category === 'highYield' && !p.recovery.locked && calc.targetReachedDate ? { ...recoveryStats(calc), ...projectRecovery(calc), stage: projectRecovery(calc).basis > 0 && projectRecovery(calc).pct >= 100 ? 'profit' : 'recovery' } : recoveryStats(calc), lifecycle = p.category === 'highYield' && rec.stage !== 'accumulating', goalPct = milestone.reached ? 100 : (calc.shares / Math.max(1, milestone.shares)) * 100, buyCost = calc.priceAvailable ? milestone.remaining * calc.currentPrice : 0, phaseLabel = rec.stage === 'setup' ? '목표 달성' : rec.stage === 'recovery' ? '원금 회수 중' : rec.stage === 'profit' ? '순수익 단계' : '';
            return `<details class="card goal-step-card ${lifecycle ? 'lifecycle-goal' : ''}" data-goal-project="${esc(p.id)}" style="--project-a:${colors[0]};--project-b:${colors[1]}">
        <summary><div><div class="goal-symbol-row"><span class="goal-symbol">${esc(p.symbol)}</span>${lifecycle ? `<em class="goal-achieved-badge">✓ ${fmtShares(calc.currentTarget)}주 달성</em>` : ''}</div><strong>${lifecycle ? phaseLabel : `${fmtShares(milestone.shares)}주 목표`}</strong><small>${lifecycle ? `현재 ${fmtShares(calc.shares)}주 · 달성일 ${fmtDate(rec.reachedDate)}` : `현재 ${fmtShares(calc.shares)}주${milestone.reached ? ' · 목표 달성' : ` · ${fmtShares(milestone.remaining)}주 남음`}`}</small></div><div class="goal-summary-status"><span>${lifecycle ? (rec.stage === 'setup' ? '주수 목표' : rec.stage === 'profit' ? '회수 후' : '원금 회수') : '달성률'}</span><b>${lifecycle ? (rec.stage === 'setup' ? '100%' : rec.stage === 'profit' ? '완료' : fmtPct(rec.pct)) : (milestone.reached ? '완료' : fmtPct(goalPct))}</b></div></summary>
        ${lifecycle ? `${rec.stage === 'setup' ? progress(100, `linear-gradient(90deg,${colors[0]},${colors[1]})`) : progress(rec.pct, `linear-gradient(90deg,${colors[0]},${colors[1]})`)}<div class="goal-detail-body">${lifecycleContent(calc)}</div>` : `${progress(goalPct, `linear-gradient(90deg,${colors[0]},${colors[1]})`)}<div class="goal-detail-body"><div class="goal-info-rows"><div><span>현재 보유</span><strong>${fmtShares(calc.shares)}주</strong></div><div><span>최근 12개월 실제</span><strong>${fmtMoney(calc.analytics.trailingNet, 2)}</strong></div><div><span>필요 매수금</span><strong>${calc.priceAvailable ? fmtMoney(buyCost, 2) : '현재가 필요'}</strong></div><div><span>계획상 달성 시점</span><strong>${estimatedDate(calc, milestone.shares)}</strong></div></div><button class="btn soft small" data-settings-project="${esc(p.id)}">목표 · 월 매수계획 설정</button><p class="detail-note">달성 시점은 저장한 월 매수계획만 반영하며 배당금은 예측하지 않습니다.</p>${p.category === 'highYield' ? `<div class="goal-recovery-preview">${dividendManagementHTML(calc)}</div>` : ''}</div>`}
      </details>`;
        }).join('') || '<article class="card empty">종목을 추가하면 설정한 다음 목표를 보여줍니다.</article>'}</div>`;
    }
    function renderSettings() {
        const container = document.getElementById('page-settings');
        const savedScroll = typeof window === 'undefined' ? 0 : window.scrollY;
        const priorSections = [...(container.querySelectorAll?.('details') || [])];
        const opened = new Set(priorSections.filter(section => section.open).map(section => section.dataset.settingsKey));
        const hadSections = priorSections.length > 0;
        const toss = state.integrations.toss;
        const nativeToss = getNativeTossStatus?.() || { available: false, configured: false, publicIp: '', checking: false };
        const appUpdate = getAppUpdateStatus?.() || { available: false, checking: false, currentVersion: APP_VERSION, latestVersion: APP_VERSION, updateAvailable: false, nativeUpdateRequired: false, error: '' };
        const tossReady = isTossBridgeConfigured(), tossUser = !!getCurrentUser(), tossBusy = String(toss.status) === 'syncing' || nativeToss.checking, canSync = nativeToss.available ? nativeToss.configured : tossReady && tossUser;
        const tossStatus = tossBusy ? '처리 중' : toss.status === 'connected' ? '연결됨' : String(toss.status) === 'partial' ? '일부 성공' : toss.status === 'error' ? '확인 필요' : nativeToss.available ? (nativeToss.configured ? '갱신 준비' : '최초 설정') : '파일 불러오기';
        const tossComparisons = records(toss.comparisons).slice(0, 6);
        const tossOrders = records(toss.sourceLedger?.orders).filter((row) => row.currency === 'USD' && row.importable !== false), tossBuys = tossOrders.filter((row) => row.type === 'buy').length, tossSells = tossOrders.filter((row) => row.type === 'sell').length;
        const tossDescription = toss.status === 'error' ? (toss.lastError || '토스 조회 상태를 다시 확인해 주세요.') : String(toss.status) === 'partial' ? '일부 계좌 또는 시세 조회가 실패했습니다. 성공한 데이터만 보존했으며 전체 성공으로 처리하지 않았습니다.' : nativeToss.available ? (nativeToss.configured ? '토스 갱신만 누르면 매수·매도를 가상 적용해 보유주수까지 맞는 경우 자동 저장합니다. 중복·과매도·원본 변경만 확인을 요청합니다.' : '처음 한 번만 Client ID와 Secret을 안전하게 저장하면 됩니다.') : '현재 IP를 토스에 등록해 만든 읽기 전용 JSON을 불러옵니다. Client ID와 Secret은 브라우저와 파일에 저장하지 않습니다.';
        const autoImportReason = { duplicate: '수동 거래와 겹칠 가능성이 있어 확인이 필요합니다.', oversell: '체결만 적용하면 중간 보유주수가 음수가 되어 확인이 필요합니다.', reconciliation: '체결 합계와 현재 보유주수가 달라 확인이 필요합니다.', correction: '토스 원본이 변경된 체결이 있어 확인이 필요합니다.', truncated: '전체 체결을 받지 못해 자동 저장하지 않았습니다.', partial: '일부 계좌 조회가 실패해 자동 저장하지 않았습니다.', ledger: '장부 검증을 통과하지 못했습니다.', validation: '장부 검증을 통과하지 못했습니다.' }[String(toss.lastAutoImportReason || '')] || '';
        const migration = state.meta.migrationAudit, migrationAvailable = !!state.meta.legacyMigrationAvailable, archivedProjects = state.projects.filter((project) => project.archived), autoBackup = getAutoBackupStatus?.() || { count: 0, lastAt: '', error: '' };
        document.getElementById('page-settings').innerHTML = `${sectionTitle('설정', 'Dividend OS')}
      <div class="stack settings-list">
        <details class="card settings-status"><summary><span>${state.meta.lastLocalSaveAt ? '기기 저장됨' : '저장 상태 확인'}</span><span class="tiny muted">${getCurrentUser() ? '클라우드 연결됨' : '클라우드 연결 안 됨'}</span><b class="chev">⌄</b></summary><p class="tiny muted">기기 저장 ${esc(syncTime(state.meta.lastLocalSaveAt))}<br>클라우드 <span id="cloudSaveSummary">${esc(getSaveSummary?.() || (getCurrentUser() ? "연결됨 · 저장 상태 확인" : "연결 안 됨 · 기기 저장 사용"))}</span></p></details>
        <div class="settings-group-label">사용 설정</div><div class="settings-group">
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">화면 · 환율</div><div class="sub-number">${state.settings.appearance === 'system' ? '기기 설정' : state.settings.appearance === 'light' ? '라이트' : '다크'} · ${state.settings.exchangeRateMode === 'auto' ? '자동 환율' : '직접 입력'} · 1달러 ${Math.round(n(state.settings.exchangeRate)).toLocaleString('ko-KR')}원</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><form id="displaySettingsForm" class="form-grid">
          <div class="form-grid two"><div><label class="input-label">환율 적용</label><select class="input select" name="exchangeRateMode"><option value="manual" ${state.settings.exchangeRateMode !== 'auto' ? 'selected' : ''}>직접 입력</option><option value="auto" ${state.settings.exchangeRateMode === 'auto' ? 'selected' : ''}>자동 참고 환율</option></select></div><div><label class="input-label">참고 환율 (1달러)</label><input class="input" name="exchangeRate" type="number" min="1" step="1" required value="${n(state.settings.exchangeRate)}"></div></div>
          <div><label class="input-label">화면 밝기</label><select class="input select" name="appearance"><option value="system" ${state.settings.appearance === 'system' ? 'selected' : ''}>휴대폰 설정 따라 자동</option><option value="light" ${state.settings.appearance === 'light' ? 'selected' : ''}>항상 밝은 화면</option><option value="dark" ${state.settings.appearance === 'dark' ? 'selected' : ''}>항상 어두운 화면</option></select></div>
          <button class="btn secondary" type="submit">화면 설정 저장</button>
        </form><button class="btn soft" style="margin-top:9px" data-refresh-exchange-rate ${getExchangeRateStatus?.().busy ? 'disabled' : ''}>${getExchangeRateStatus?.().busy ? '환율 확인 중…' : '환율 지금 갱신'}</button>${state.settings.exchangeRateMode === 'auto' && state.settings.exchangeRateUpdatedAt ? `<p class="tiny muted">환율 기준일 ${esc(state.settings.exchangeRateDate)} · 확인 ${esc(syncTime(state.settings.exchangeRateUpdatedAt))} · Frankfurter</p>` : ''}${getExchangeRateStatus?.().error ? `<p class="tiny negative">${esc(getExchangeRateStatus().error)}</p>` : ''}<p class="tiny muted" style="margin-top:10px">자동 모드는 앱을 열거나 인터넷이 다시 연결되면 참고 환율을 갱신합니다. 토스 실제 환전율과 다를 수 있으며, 실패하면 마지막 저장값을 유지합니다.</p></div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">배당 설정</div><div class="sub-number">월 목표 $${Math.round(n(state.settings.targetMonthlyDividend)).toLocaleString('en-US')} · 관리기준 ${Math.round(n(state.settings.thresholdKRW)).toLocaleString('ko-KR')}원</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><form id="dividendSettingsForm" class="form-grid">
          <div><label class="input-label">전체 월배당 목표 USD</label><input class="input" name="targetMonthlyDividend" type="number" min="0" step="1" value="${n(state.settings.targetMonthlyDividend)}"></div>
          <div><label class="input-label">연간 세후배당 경고선 (원)</label><input class="input" name="warningKRW" type="number" min="0" step="10000" value="${n(state.settings.warningKRW)}"></div>
          <div><label class="input-label">연간 세후배당 관리기준 (원)</label><input class="input" name="thresholdKRW" type="number" min="0" step="10000" value="${n(state.settings.thresholdKRW)}"></div>
          <button class="btn secondary" type="submit">배당 기준 저장</button>
        </form><p class="tiny muted" style="margin-top:10px">홈과 현금흐름은 실제 입금 기록만 집계합니다.</p></div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">종목별 설정</div><div class="sub-number">운용 성격 · 목표 · 그래프 색상</div></div><b class="chev">⌄</b></summary><div class="settings-section-body"><div class="list settings-project-list">${activeProjects().map((project) => `<div class="list-row"><div><div class="row-title"><span class="project-color-dot" style="background:${projectColors(project)[0]}"></span>${esc(project.symbol)}</div><div class="row-sub">${esc(categoryLabel(project.category))} · 목표 ${fmtShares(project.targetUnits)}주</div></div><button class="mini-icon" data-settings-project="${project.id}">수정</button></div>`).join('')}</div></div></details>
        </div><div class="settings-group-label">앱 관리</div><div class="settings-group">
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">연결 관리</div><div class="sub-number">토스 · 클라우드</div></div><b class="chev">⌄</b></summary><div class="settings-section-body connection-settings">
        <details class="card settings-connection"><summary><div><div class="card-title">토스증권 읽기 전용</div><div class="sub-number">보유주식 · 현재가 · 체결 대조</div></div><span class="status-pill ${toss.status === 'connected' ? 'positive' : ''}">${tossStatus}</span><b class="chev">⌄</b></summary><div class="settings-section-body">
          <p class="tiny muted">${esc(tossDescription)}</p>
          <p class="tiny muted toss-capability-note">현재 공식 API 연동 범위는 보유주식·현재가·지원 주문 체결입니다. 배당 입금 조회는 지원되지 않아 수동 기록을 유지하며, 주문·정정·취소는 이 앱에서 실행하지 않습니다.</p>
          ${nativeToss.available ? `<div class="toss-setup"><div class="setup-step"><span>${nativeToss.configured ? '✓' : '1'}</span><div><strong>${nativeToss.configured ? '토스 키 저장됨' : '최초 1회 키 저장'}</strong><small>${nativeToss.configured ? '키는 이 기기 보안 저장소에 암호화되어 있습니다.' : 'Client ID와 Secret은 입력 후 화면에 다시 표시하지 않습니다.'}</small></div></div>${(nativeToss.publicIp || nativeToss.lastPublicIp) ? `<div class="setup-step"><span>IP</span><div><strong>${esc(nativeToss.publicIp || nativeToss.lastPublicIp)}</strong><small>${nativeToss.publicIp && nativeToss.lastPublicIp && nativeToss.publicIp !== nativeToss.lastPublicIp ? '변경됨 · 갱신을 누르면 등록을 안내합니다.' : '마지막으로 확인한 공인 IP'}</small></div></div>` : ''}</div>` : `<div class="toss-setup"><div class="setup-step"><span>1</span><div><strong>무료 일회성 조회</strong><small>Cloud Shell에서 현재 IP 등록 → JSON 생성 → 이 앱에서 불러오기 → 후보 검토 순서입니다.</small></div></div></div>`}
          ${autoImportReason ? `<div class="toss-sync-warning"><strong>조회 완료 · 거래 저장 보류</strong><p>${esc(autoImportReason)}</p><span>확인되지 않은 거래는 기존 장부에 반영하지 않았습니다.</span></div>` : ''}
          <p class="tiny muted">마지막 조회 ${esc(syncTime(toss.lastSyncAt))}<br>마지막 전체 성공 ${esc(syncTime(toss.lastSuccessfulAt))}${toss.lastAttemptAt ? `<br>마지막 연결 시도 ${esc(syncTime(toss.lastAttemptAt))}` : ''}</p>
          <details class="toss-details"><summary><strong>계좌 대조 · 조회 상세</strong><b class="chev">⌄</b></summary>
          ${toss.accountLabel ? `<div class="row-sub">${esc(toss.accountLabel)}${toss.lastSyncAt ? ` · ${fmtDate(toss.lastSyncAt.slice(0, 10))} 조회` : ''}</div>` : ''}
          ${tossComparisons.length ? `<div class="list" style="margin-top:12px">${tossComparisons.map((row) => `<div class="list-row"><div><div class="row-title">${esc(row.symbol)} · ${fmtShares(row.shares)}주</div><div class="row-sub">${Array.isArray(row.accounts) && row.accounts.length > 1 ? `${row.accounts.length}계좌 합산 · ` : ''}앱 ${fmtShares(row.appShares)}주${row.supported ? '' : ' · 원화 종목은 대조만'}</div></div><div class="row-value ${Math.abs(n(row.difference)) < .0001 ? 'positive' : ''}">${Math.abs(n(row.difference)) < .0001 ? '일치' : `${n(row.difference) > 0 ? '+' : ''}${fmtShares(row.difference)}주`}</div></div>`).join('')}</div>` : ''}
          ${toss.unsupportedCurrencyCount ? `<p class="tiny muted">원화 체결 ${toss.unsupportedCurrencyCount}건은 USD 원장에 섞지 않고 제외했습니다.</p>` : ''}
          ${toss.matchedExistingCount ? `<p class="tiny muted">수동 거래와 유사한 토스 체결 ${toss.matchedExistingCount}건은 자동 병합하지 않고 검토 후보로 표시했습니다.</p>` : ''}${toss.matchedExistingDividendCount ? `<p class="tiny muted">수동 배당과 유사한 토스 입금 ${toss.matchedExistingDividendCount}건은 자동 병합하지 않고 검토 후보로 표시했습니다.</p>` : ''}
          ${toss.failedAccountCount ? `<p class="tiny negative">계좌 ${toss.failedAccountCount}개 조회 실패 · 성공한 계좌만 반영</p>` : ''}
          ${(records(toss.correctionCandidates).length || records(toss.dividendCorrectionCandidates).length) ? `<div class="toss-setup"><div class="setup-step"><span>!</span><div><strong>토스 원본 변경 ${(records(toss.correctionCandidates).length || 0) + (records(toss.dividendCorrectionCandidates).length || 0)}건</strong><small>기존 원장은 자동 수정·삭제하지 않았습니다. 토스 앱 원본을 확인한 뒤 알림을 정리하세요.</small></div></div><button class="btn soft small" data-clear-toss-corrections>확인 처리</button></div>` : ''}
          ${(toss.sourceLedger?.orders?.length || toss.sourceLedger?.dividends?.length) ? `<p class="tiny positive">기기 보존 원본 · 매수 ${tossBuys}건 · 매도 ${tossSells}건${toss.lastSuccessfulAt ? ' · 마지막 성공 ' + fmtDate(toss.lastSuccessfulAt.slice(0, 10)) : ''}</p><p class="tiny muted">배당 · ${toss.capabilities?.dividends ? `${toss.sourceLedger.dividends.length}건 조회` : '토스 공식 API 미지원 · 실제 입금은 직접 기록'}</p>` : ''}
          ${toss.historyTruncated ? '<p class="tiny negative">체결 기록이 10,000건을 넘어 일부만 조회됐습니다. 기간을 나눠 다시 조회해야 합니다.</p>' : ''}
          </details>
          ${nativeToss.available ? `<div class="action-row" style="margin-top:12px"><button class="btn ${nativeToss.configured ? 'soft' : 'secondary'}" data-configure-toss ${tossBusy ? 'disabled' : ''}>${nativeToss.configured ? '키 변경' : '최초 설정'}</button><button class="btn primary" data-sync-toss ${canSync && !tossBusy ? '' : 'disabled'}>${tossBusy ? '확인 중…' : '토스 갱신'}</button></div>${nativeToss.configured ? '<button class="text-link" style="margin-top:12px" data-clear-toss-credentials>이 기기에 저장한 토스 키 삭제</button>' : ''}<details class="toss-details" style="margin-top:12px"><summary><div><strong>긴급 수동 불러오기</strong><small>APK 조회가 안 될 때만 JSON 사용</small></div><b class="chev">⌄</b></summary><div class="manual-tools-body"><button class="btn soft" data-import-toss ${tossBusy ? 'disabled' : ''}>토스 JSON 불러오기</button></div></details>` : `<div class="action-row" style="margin-top:12px"><button class="btn secondary" data-import-toss ${tossBusy ? 'disabled' : ''}>${tossBusy ? '처리 중…' : '토스 JSON 불러오기'}</button>${tossReady ? `<button class="btn soft" data-sync-toss ${canSync && !tossBusy ? '' : 'disabled'}>서버에서 조회</button>` : ''}</div>`}
          <details class="toss-details"><summary><strong>연결 관리 · 거래 복구</strong><b class="chev">⌄</b></summary><div class="toss-management-actions">
          ${(records(toss.candidates).length || records(toss.dividendCandidates).length) ? `<button class="btn soft" style="margin-top:9px" data-review-toss ${tossBusy ? 'disabled' : ''}>조회 기록 검토</button>` : ''}
          ${(records(toss.candidates).length || records(toss.dividendCandidates).length || records(toss.correctionCandidates).length || records(toss.dividendCorrectionCandidates).length) ? `<button class="btn soft" style="margin-top:9px" data-delete-toss-exceptions ${tossBusy ? 'disabled' : ''}>대기 목록 정리</button>` : ''}
          ${records(toss.sourceLedger?.orders).some((row) => String(row?.symbol || '').toUpperCase() === 'MSTY') ? '<button class="btn soft" style="width:100%;margin-top:9px" data-rebuild-msty-toss>MSTY를 토스 원본으로 다시 만들기</button>' : ''}
          ${toss.accountScopeId && toss.status !== 'not_connected' ? '<button class="btn soft" style="margin-top:9px" data-disconnect-toss>화면 연결 해제</button>' : ''}          </div></details>

        </div></details>
        <details class="card settings-connection"><summary><div><div class="card-title">클라우드</div><div class="sub-number">기기 간 저장 · 변경 충돌 확인</div></div><strong class="${getCurrentUser() ? 'positive' : ''}">${getCurrentUser() ? '연결됨' : '로그인 필요'}</strong><b class="chev">⌄</b></summary><div class="settings-section-body"><div class="sync-line"><span class="sync-dot" id="syncDot"></span><div><div class="row-title" id="syncStatusText">${getCurrentUser() ? '연결됨' : '로그인 필요'}</div><div class="row-sub">다른 기기에서 바뀐 기록은 확인 후 반영</div></div></div>${getCurrentUser() ? '<button class="btn secondary" style="width:100%;margin-top:12px" data-review-cloud>클라우드 기록 확인</button><button class="btn soft" style="width:100%;margin-top:12px" data-logout>로그아웃</button>' : '<button class="btn secondary" style="width:100%;margin-top:12px" data-show-login>클라우드 연결</button>'}</div></details>
        </div></details>
        <details class="card settings-section" name="settings"><summary><div><div class="card-title">백업·복원</div><div class="sub-number">ZIP 저장 · 기록 복원</div></div><b class="chev">⌄</b></summary><div class="settings-section-body advanced-settings">          <section><div class="card-title">백업 · 내보내기</div><p class="tiny muted">거래·배당·설정을 함께 보관합니다. 복원할 때 파일 손상과 기록을 확인합니다.</p><div class="action-row" style="margin-top:13px"><button class="btn primary" data-backup>ZIP 백업</button><button class="btn secondary" data-restore>ZIP 복원</button></div><div class="action-row" style="margin-top:9px"><button class="btn soft" data-csv>CSV 4개 내보내기</button><button class="btn soft" data-all-check>전체 점검</button></div><details class="initial-import-tools form-advanced" style="margin-top:12px"><summary><div><strong>처음 배당 내역 가져오기</strong><span>기존 배당을 전체 교체할 때만 사용</span></div><b class="chev">⌄</b></summary><div class="manual-tools-body"><button class="btn soft" data-replace-dividends>배당 교체 파일 불러오기</button></div></details></section>
          <section><div class="card-title">안전 사본</div><p class="tiny muted">자동 백업 ${autoBackup.count}개${autoBackup.lastAt ? ` · 최근 ${esc(autoBackup.lastAt.slice(0, 16).replace('T', ' '))}` : ''}${autoBackup.error ? ` · ${esc(autoBackup.error)}` : ''}. 최근 7개만 순환 보관하며 직접 받은 ZIP은 삭제하지 않습니다.</p><button class="btn soft" style="width:100%" data-restore-auto ${autoBackup.count ? '' : 'disabled'}>최근 자동 백업 복원</button><button class="btn soft" style="width:100%;margin-top:9px" data-restore-safety>직전 안전 사본 되돌리기</button></section>
</div></details>
        ${appUpdate.available ? `<details class="card settings-section" name="settings" ${appUpdate.updateAvailable ? 'open' : ''}><summary><div><div class="card-title">앱 업데이트</div><div class="sub-number">현재 ${esc(appUpdate.currentVersion)} · 배포 ${esc(appUpdate.latestVersion || '확인 전')}</div></div><strong class="${appUpdate.updateAvailable ? 'positive' : ''}">${appUpdate.checking ? '확인 중' : appUpdate.error ? '확인 실패' : !appUpdate.latestVersion ? '확인 전' : appUpdate.updateAvailable ? '업데이트 있음' : appUpdate.latestVersion !== appUpdate.currentVersion ? '설치 버전이 더 최신' : '최신 버전'}</strong><b class="chev">⌄</b></summary><div class="settings-section-body"><p class="tiny muted">화면과 계산 기능은 앱 안에서 교체하며 거래·배당·토스 키는 그대로 유지합니다. 적용 실패 시 기존 버전으로 자동 복구합니다.</p>${appUpdate.error ? `<p class="tiny negative">${esc(appUpdate.error)}</p>` : ''}<div class="action-row" style="margin-top:12px">${appUpdate.updateAvailable ? `<button class="btn primary" data-install-hot-update ${appUpdate.checking ? 'disabled' : ''}>${appUpdate.nativeUpdateRequired ? '보안 업데이트 안내' : '지금 업데이트'}</button>` : ''}<button class="btn soft" data-check-hot-update ${appUpdate.checking ? 'disabled' : ''}>다시 확인</button></div></div></details>` : ''}
        </div>
        ${archivedProjects.length ? `<article class="card"><div class="card-title">보관한 프로젝트</div><div class="list" style="margin-top:12px">${archivedProjects.map((project) => `<div class="list-row"><div><div class="row-title">${esc(project.symbol)}</div><div class="row-sub">${esc(project.name)}</div></div><button class="mini-icon" data-restore-project="${project.id}">복원</button></div>`).join('')}</div></article>` : ''}
        <details class="card settings-section settings-advanced" name="settings"><summary><div><div class="card-title">고급 설정</div><div class="sub-number">데이터 이전 · 초기화</div></div><b class="chev">⌄</b></summary><div class="settings-section-body advanced-settings">
          <section><div class="card-head"><div><div class="card-title">V3.2.1 데이터 이전</div><div class="sub-number">원본 읽기 전용 · V4 복사</div></div><span class="status-pill ${migration?.passed ? 'positive' : ''}">${migration?.passed ? '대조 통과' : migrationAvailable ? '이전 가능' : '대기'}</span></div>${migration?.passed ? `<div class="list"><div class="list-row"><div><div class="row-title">이전 결과</div><div class="row-sub">거래 ${migration.source.tradeCount}건 · 배당 ${migration.source.dividendCount}건 · 분할 ${migration.source.splitCount}건</div></div><div class="row-value positive">전부 일치</div></div></div>` : `<p class="tiny muted">${migrationAvailable ? '이 기기의 V3.2.1 기록을 발견했습니다. 숫자를 먼저 대조한 뒤 복사합니다.' : 'V3.2.1 기록 또는 로그인된 기존 클라우드를 확인하면 활성화됩니다.'}</p>${migrationAvailable ? '<button class="btn primary" style="width:100%" data-migrate-v3>V3 이전값 점검</button>' : ''}`}</section>
          <section class="danger-zone"><div class="card-title">초기화</div><p class="tiny muted">V4 데이터만 지웁니다. V3.2.1 저장소는 삭제하지 않습니다.</p><button class="btn soft" style="width:100%" data-reset>V4 전체 초기화</button></section>
        </div></details>
      </div><div class="detail-note">원화는 설정 환율로 환산한 참고 금액입니다. 관리기준은 사용자 알림용이며 세금 판정이 아닙니다.</div><div class="app-version">DividendOS ${APP_VERSION}${state.meta.migratedFrom ? ` · ${esc(state.meta.migratedFrom)}에서 이전` : ''}</div>`;
        container.querySelectorAll?.('details').forEach((section, index) => {
            const summary = section.querySelector(':scope > summary');
            const key = summary?.querySelector('.card-title')?.textContent || summary?.querySelector('strong')?.textContent || String(index);
            section.dataset.settingsKey = key;
            if (hadSections)
                section.open = opened.has(key);
        });
        if (typeof window !== 'undefined' && container.classList.contains('active') && document.body.style.position !== 'fixed')
            window.scrollTo(0, savedScroll);
        document.getElementById('page-settings')?.querySelectorAll?.('input,select,textarea').forEach((input, index) => { const label = input.closest('div')?.querySelector('label'); if (label) {
            input.id = 'settings-field-' + index;
            label.htmlFor = input.id;
        } });
    }
    return { renderHome, renderProjects, renderGoals, renderSettings };
}
