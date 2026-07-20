import { auth, firestore } from './firebase.js';
import { initGoogleAuth, logoutGoogle } from './auth.js';
import { openStorage, storageGet, storageSet } from './storage.js';
import { getCloudDocument, saveCloudDocument, subscribeCloudDocument } from './cloud.js';

(() => {
    'use strict';
const APP_BOOT_AT = performance.now();
    const PAGE_ORDER = ['home','trade','dividend','goal','settings'];
    const numberCache = new Map();
    const motionReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    function resolvedTheme(pref) {
      return pref === 'dark' || (pref === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    function applyTheme(pref = state?.settings?.appearance || localStorage.getItem('msty-theme-pref') || 'system') {
      const resolved = resolvedTheme(pref);
      document.documentElement.dataset.theme = resolved;
      try { localStorage.setItem('msty-theme-pref', pref); } catch (_) {}
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) themeMeta.setAttribute('content', resolved === 'dark' ? '#0f1117' : '#f4f5f9');
    }
    function haptic(ms=7) {
      try { if ('vibrate' in navigator) navigator.vibrate(ms); } catch (_) {}
    }
    function hideSplash() {
      const el = document.getElementById('splashScreen');
      if (!el) return;
      const wait = motionReduced() ? 0 : Math.max(0, 360 - (performance.now() - APP_BOOT_AT));
      setTimeout(() => {
        el.classList.add('hide');
        setTimeout(() => el.remove(), 240);
      }, wait);
    }
    function addRipple(event) {
      if (motionReduced()) return;
      const target = event.target.closest('.btn,.nav-btn,.recent-toggle,.chart-toggle,.segmented button,details.clean summary,.mini-icon');
      if (!target || target.disabled) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.8;
      const wave = document.createElement('span');
      wave.className = 'ripple-wave';
      wave.style.width = wave.style.height = `${size}px`;
      wave.style.left = `${event.clientX - rect.left - size/2}px`;
      wave.style.top = `${event.clientY - rect.top - size/2}px`;
      target.appendChild(wave);
      wave.addEventListener('animationend', () => wave.remove(), {once:true});
    }
    function markInteractiveCards() {
      document.querySelectorAll('.card').forEach(card => {
        const interactive = card.matches('.recent-box') || card.querySelector('[data-page-jump],details.clean,.chart-toggle,[data-toggle-recent]');
        card.classList.toggle('interactive-card', !!interactive);
      });
    }
    function parseCountable(text) {
      const groups = String(text).match(/-?\d[\d,]*(?:\.\d+)?/g);
      if (!groups || groups.length !== 1 || /\d{4}[.\-/]\d{2}/.test(text)) return null;
      const raw = groups[0];
      const value = Number(raw.replaceAll(',',''));
      if (!Number.isFinite(value)) return null;
      const index = String(text).indexOf(raw);
      const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
      return {value, decimals, prefix:String(text).slice(0,index), suffix:String(text).slice(index+raw.length)};
    }
    function animateVisibleNumbers(page, fromZero=false) {
      if (motionReduced()) return;
      const root = document.getElementById(`page-${page}`);
      if (!root || !root.classList.contains('active')) return;
      const els = [...root.querySelectorAll('.big-number,.metric-value,.summary-chip .value,.row-value')];
      els.forEach((el,index) => {
        const parsed = parseCountable(el.textContent.trim());
        if (!parsed) return;
        const key = `${page}:${index}:${parsed.prefix}:${parsed.suffix}`;
        const target = parsed.value;
        const start = numberCache.has(key) ? numberCache.get(key) : (fromZero ? 0 : target);
        numberCache.set(key,target);
        if (Math.abs(target-start) < Math.pow(10,-parsed.decimals)) return;
        const duration = 360;
        const began = performance.now();
        el.classList.add('number-animating');
        const format = value => `${parsed.prefix}${value.toLocaleString('en-US',{minimumFractionDigits:parsed.decimals,maximumFractionDigits:parsed.decimals})}${parsed.suffix}`;
        const frame = now => {
          const t = Math.min(1,(now-began)/duration);
          const eased = 1-Math.pow(1-t,3);
          el.textContent = format(start+(target-start)*eased);
          if (t<1) requestAnimationFrame(frame);
          else { el.textContent = format(target); el.classList.remove('number-animating'); }
        };
        requestAnimationFrame(frame);
      });
    }

        const STATE_KEY = 'state';
    const SAFETY_KEY = 'safetyBackup';

    const todayISO = () => {
      const d = new Date();
      const tz = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - tz).toISOString().slice(0,10);
    };
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const deepClone = obj => JSON.parse(JSON.stringify(obj));
    const n = v => Number(v) || 0;
    const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
    const round = (v,d=4) => Number(Number(v).toFixed(d));

    const blankState = () => ({
      version: 3,
      settings: {
        currentPrice: 0,
        targetUnits: 1000,
        monthlyPlanShares: 0,
        projectStart: todayISO(),
        exchangeRate: 1370,
        showKRW: true,
        warningKRW: 18000000,
        thresholdKRW: 20000000,
        appearance: 'system'
      },
      trades: [],
      dividends: [],
      splits: [],
      recovery: {
        locked: false,
        basis: 0,
        startDate: '',
        targetReachedDate: '',
        calculatedBasisAtLock: 0,
        confirmedAt: ''
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastBackupAt: '',
        celebratedMilestones: []
      }
    });

    const defaultState = () => blankState();

    let state;
    let currentPage = 'home';
    let saveTimer;
    let toastTimer;
    let currentUser = null;
    let cloudUnsubscribe = null;
    let cloudSaveTimer = null;
    let applyingCloudState = false;
    let lastCloudSyncAt = '';
    let cloudStatus = 'checking';
    const CLOUD_DOC_ID = 'msty-project1000';
    const ui = {
      recent: { trade: 1, dividend: 1, log: 1, split: 1 },
      dividendYear: 'all',
      dividendGroup: 'month',
      dividendChartOpen: false,
      checkResults: null,
      milestoneOpen: null
    };

    function migrate(raw) {
      if (!raw || typeof raw !== 'object') return defaultState();
      const base = blankState();
      const s = raw;
      s.version = 3;
      s.settings = Object.assign(base.settings, s.settings || {});
      s.trades = Array.isArray(s.trades) ? s.trades : [];
      s.dividends = Array.isArray(s.dividends) ? s.dividends : [];
      s.splits = Array.isArray(s.splits) ? s.splits : [];
      s.recovery = Object.assign(base.recovery, s.recovery || {});
      s.meta = Object.assign(base.meta, s.meta || {});
      return s;
    }

    function hasMeaningfulData(value=state) {
      return !!(value && (value.trades?.length || value.dividends?.length || value.splits?.length || n(value.settings?.currentPrice) || n(value.settings?.monthlyPlanShares)));
    }
function setCloudStatus(status, text) {
      cloudStatus=status;
      const el=document.getElementById('saveStatus');
      if(el){ el.textContent=text; el.className='save-pill '+(status==='ok'?'cloud-ok':status==='saving'?'cloud-busy':status==='error'||status==='offline'?'cloud-error':''); }
      const dot=document.getElementById('syncDot'); if(dot) dot.className='sync-dot '+(status==='saving'?'busy':status==='offline'?'offline':status==='error'?'error':'');
      const label=document.getElementById('syncStatusText'); if(label) label.textContent=text;
      const time=document.getElementById('lastSyncText'); if(time) time.textContent=lastCloudSyncAt?new Date(lastCloudSyncAt).toLocaleString('ko-KR'):'아직 없음';
    }
    async function pushCloudState() {
      if(!currentUser || applyingCloudState) return;
      if(!navigator.onLine){ setCloudStatus('offline','오프라인 · 기기 저장'); return; }
      setCloudStatus('saving','클라우드 저장 중');
      try {
        const payload=deepClone(state);
        await saveCloudDocument(currentUser.uid,{state:payload,clientUpdatedAt:payload.meta.updatedAt,appVersion:'3.0.1'});
        lastCloudSyncAt=new Date().toISOString();
        setCloudStatus('ok','클라우드 저장됨');
      } catch(err){ console.error('Cloud save failed',err); setCloudStatus('error','클라우드 오류'); toast('기기에는 저장됐지만 클라우드 저장에 실패했습니다.'); }
    }
    async function saveState(immediate=false) {
      state.meta.updatedAt = new Date().toISOString();
      setSaveStatus(currentUser?'저장 중':'기기 저장 중');
      clearTimeout(saveTimer); clearTimeout(cloudSaveTimer);
      const run = async () => {
        try {
          await storageSet(STATE_KEY, state);
          setSaveStatus(currentUser?'동기화 대기':'기기 저장됨');
          if(currentUser){ if(immediate) await pushCloudState(); else cloudSaveTimer=setTimeout(pushCloudState,450); }
        } catch (err) {
          console.error(err); setSaveStatus('저장 오류'); toast('저장 중 오류가 발생했습니다.');
        }
      };
      if (immediate) await run(); else saveTimer = setTimeout(run, 120);
    }

    function setSaveStatus(text) {
      const el = document.getElementById('saveStatus');
      if (el) el.textContent = text;
    }
    function toast(message) {
      haptic(7);
      const el = document.getElementById('toast');
      clearTimeout(toastTimer);
      el.textContent = message;
      el.classList.add('show');
      toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
    }

    const fmtUSD = (v, digits=2) => `${v < 0 ? '-' : ''}$${Math.abs(n(v)).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits})}`;
    const fmtKRW = v => `${Math.round(n(v)).toLocaleString('ko-KR')}원`;
    function krwValue(usd) { return n(usd) * Math.max(0,n(state?.settings?.exchangeRate)); }
    function krwRef(usd, cls='') {
      if (!state?.settings?.showKRW || n(state?.settings?.exchangeRate) <= 0) return '';
      return `<div class="krw-ref ${cls}">≈ ${fmtKRW(krwValue(usd))}</div>`;
    }
    function krwMini(usd, cls='') { return krwRef(usd, `mini ${cls}`.trim()); }
    const fmtShares = v => n(v).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:4});
    const fmtPct = v => `${n(v).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
    const fmtDate = value => {
      if (!value) return '-';
      const [y,m,d] = value.slice(0,10).split('-');
      return `${y}.${m}.${d}`;
    };
    function addMonthsISO(iso, months) {
      if (!iso || !Number.isFinite(months)) return '';
      const d = new Date(`${iso}T12:00:00`);
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + Math.max(0, Math.ceil(months)));
      const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
      d.setDate(Math.min(day,last));
      const tz = d.getTimezoneOffset()*60000;
      return new Date(d.getTime()-tz).toISOString().slice(0,10);
    }
    const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
    const signClass = v => n(v) > 0 ? 'positive' : n(v) < 0 ? 'negative' : '';

    function sortedEvents() {
      const trades = state.trades.map(x => ({...x, eventType:'trade'}));
      const splits = state.splits.map(x => ({...x, eventType:'split'}));
      return [...trades,...splits].sort((a,b) => {
        const d = String(a.date).localeCompare(String(b.date));
        if (d) return d;
        const order = (a.eventType === 'split' ? 0 : 1) - (b.eventType === 'split' ? 0 : 1);
        if (order) return order;
        return String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id));
      });
    }

    function computePortfolio() {
      const targetUnits = Math.max(.000001, n(state.settings.targetUnits));
      let factor = 1;
      let actualShares = 0;
      let normalizedShares = 0;
      let costBasis = 0;
      let realized = 0;
      let directBuyCost = 0;
      let sellProceeds = 0;
      let targetReachedDate = '';
      let targetBasisSuggestion = 0;
      const milestoneDates = {25:'',50:'',75:'',100:''};
      let reinvestNormalized = 0;
      let reinvestAmount = 0;
      let reinvestCount = 0;
      const oversells = [];
      const factorAtDate = [];

      for (const e of sortedEvents()) {
        if (e.eventType === 'split') {
          const ratio = n(e.to) / n(e.from);
          if (ratio > 0 && Number.isFinite(ratio)) {
            actualShares *= ratio;
            factor *= ratio;
          }
        } else if (e.type === 'buy') {
          const q = Math.max(0,n(e.shares));
          const price = Math.max(0,n(e.price));
          actualShares += q;
          normalizedShares += q / factor;
          costBasis += q * price;
          if (e.buyType === 'direct' || e.buyType === 'opening') directBuyCost += q * price;
          if (e.buyType === 'reinvest') {
            reinvestNormalized += q / factor;
            reinvestAmount += q * price;
            reinvestCount += 1;
          }
        } else if (e.type === 'sell') {
          const q = Math.max(0,n(e.shares));
          const price = Math.max(0,n(e.price));
          if (q > actualShares + 1e-8) oversells.push(e);
          const safeQ = Math.min(q, Math.max(0,actualShares));
          const avg = actualShares > 0 ? costBasis / actualShares : 0;
          realized += safeQ * (price - avg);
          costBasis -= safeQ * avg;
          actualShares -= safeQ;
          normalizedShares -= safeQ / factor;
          sellProceeds += safeQ * price;
        }

        factorAtDate.push({date:e.date,factor});
        const progress = normalizedShares / targetUnits;
        for (const pct of [25,50,75,100]) {
          if (!milestoneDates[pct] && progress + 1e-10 >= pct/100) milestoneDates[pct] = e.date;
        }
        if (!targetReachedDate && progress + 1e-10 >= 1) {
          targetReachedDate = e.date;
          targetBasisSuggestion = Math.max(0, directBuyCost - sellProceeds);
        }
      }

      actualShares = Math.abs(actualShares) < 1e-9 ? 0 : actualShares;
      normalizedShares = Math.abs(normalizedShares) < 1e-9 ? 0 : normalizedShares;
      costBasis = Math.max(0, Math.abs(costBasis) < 1e-7 ? 0 : costBasis);
      const currentPrice = Math.max(0,n(state.settings.currentPrice));
      const marketValue = actualShares * currentPrice;
      const unrealized = marketValue - costBasis;
      const avgCost = actualShares > 0 ? costBasis / actualShares : 0;
      const currentTarget = targetUnits * factor;
      const progress = currentTarget > 0 ? actualShares / currentTarget : 0;
      const dividendsTotal = state.dividends.reduce((s,d) => s+n(d.amountUSD),0);
      const currentYear = String(new Date().getFullYear());
      const yearDividends = state.dividends.filter(d => String(d.date).startsWith(currentYear)).reduce((s,d) => s+n(d.amountUSD),0);
      const recentDividend = [...state.dividends].sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0] || null;
      const totalReturn = unrealized + realized + dividendsTotal;
      const investedPrincipal = costBasis;
      const returnPct = investedPrincipal > 0 ? unrealized / investedPrincipal * 100 : 0;
      const reinvestSharesCurrent = reinvestNormalized * factor;
      const reinvestAvgPrice = reinvestSharesCurrent > 0 ? reinvestAmount / reinvestSharesCurrent : 0;
      const dividendAvailable = dividendsTotal - reinvestAmount;

      return {
        factor, actualShares, normalizedShares, costBasis, realized, directBuyCost, sellProceeds,
        marketValue, unrealized, avgCost, currentTarget, progress, currentPrice, investedPrincipal,
        dividendsTotal, yearDividends, recentDividend, totalReturn, returnPct,
        milestoneDates, targetReachedDate, targetBasisSuggestion, reinvestSharesCurrent,
        reinvestAmount, reinvestCount, reinvestAvgPrice, dividendAvailable, oversells, factorAtDate
      };
    }

    function recoveryStats(portfolio) {
      if (!state.recovery.locked) return {dividendRecovery:0,sellRecovery:0,total:0,remaining:0,pct:0,milestones:{}};
      const start = state.recovery.startDate;
      const basis = Math.max(0,n(state.recovery.basis));
      const events = [];
      state.dividends.filter(x => x.date >= start).forEach(x => events.push({date:x.date, amount:n(x.amountUSD), type:'dividend'}));
      state.trades.filter(x => x.type === 'sell' && x.date >= start).forEach(x => events.push({date:x.date, amount:n(x.shares)*n(x.price), type:'sell'}));
      events.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      let dividendRecovery = 0, sellRecovery = 0, running = 0;
      const milestones = {25:'',50:'',75:'',100:''};
      for (const e of events) {
        if (e.type === 'dividend') dividendRecovery += e.amount;
        else sellRecovery += e.amount;
        running += e.amount;
        for (const p of [25,50,75,100]) if (!milestones[p] && basis > 0 && running/basis >= p/100) milestones[p] = e.date;
      }
      const total = dividendRecovery + sellRecovery;
      return {dividendRecovery,sellRecovery,total,remaining:Math.max(0,basis-total),pct:basis>0?total/basis*100:0,milestones};
    }

    function projectLogs(portfolio, recovery) {
      const logs = [];
      if (state.settings.projectStart) logs.push({id:'start',date:state.settings.projectStart,title:'프로젝트 시작',sub:'MSTY PROJECT 1000 기록을 시작했습니다.'});
      for (const p of [25,50,75,100]) {
        const date = portfolio.milestoneDates[p];
        if (date) logs.push({id:`mile-${p}`,date,title:p===100?'PROJECT1000 달성':`${Math.round(portfolio.currentTarget*p/100).toLocaleString()}주 마일스톤 달성`,sub:`프로젝트 진행률 ${p}%에 도달했습니다.`});
      }
      if (state.recovery.locked) logs.push({id:'recovery-start',date:state.recovery.startDate,title:'원금 회수 시작',sub:`기준원금 ${fmtUSD(state.recovery.basis)} 확정`});
      if (state.recovery.locked) for (const p of [25,50,75,100]) {
        const date = recovery.milestones[p];
        if (date) logs.push({id:`recovery-${p}`,date,title:`원금 회수 ${p}% 달성`,sub:'배당 및 매도 회수액 기준'});
      }
      state.splits.forEach(s => logs.push({id:`split-${s.id}`,date:s.date,title:s.kind==='reverse'?'역분할 반영':'주식분할 반영',sub:`${s.from}주 → ${s.to}주 비율 적용`}));

      const rate = Math.max(0,n(state.settings.exchangeRate));
      const warn = Math.max(0,n(state.settings.warningKRW));
      const threshold = Math.max(0,n(state.settings.thresholdKRW));
      const grouped = {};
      [...state.dividends].sort((a,b)=>String(a.date).localeCompare(String(b.date))).forEach(d => {
        const y = String(d.date).slice(0,4);
        grouped[y] = (grouped[y] || 0) + n(d.amountUSD) * rate;
        if (warn > 0 && grouped[y] >= warn && !logs.some(x=>x.id===`warn-${y}`)) logs.push({id:`warn-${y}`,date:d.date,title:`${y}년 경고금액 도달`,sub:`참고 환율 기준 ${fmtKRW(grouped[y])}`});
        if (threshold > 0 && grouped[y] >= threshold && !logs.some(x=>x.id===`threshold-${y}`)) logs.push({id:`threshold-${y}`,date:d.date,title:`${y}년 관리기준 도달`,sub:`참고 환율 기준 ${fmtKRW(grouped[y])}`});
      });
      return logs.sort((a,b)=>String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
    }

    function currentFactor() { return computePortfolio().factor; }
    function actualTargetInputValue() { const p = computePortfolio(); return round(p.currentTarget,4); }

    function managementStatus(portfolio) {
      const krw = portfolio.yearDividends * Math.max(0,n(state.settings.exchangeRate));
      const warning = Math.max(0,n(state.settings.warningKRW));
      const threshold = Math.max(.0001,n(state.settings.thresholdKRW));
      let zone = 'green';
      if (krw >= threshold) zone = 'red'; else if (krw >= warning) zone = 'yellow';
      return {krw,warning,threshold,zone,pct:krw/threshold*100,remaining:Math.max(0,threshold-krw)};
    }

    function pageHeader(title,note='') {
      return `<div class="section-title-row"><h2 class="section-title">${esc(title)}</h2>${note?`<span class="section-note">${esc(note)}</span>`:''}</div>`;
    }

    function renderHome() {
      const p = computePortfolio();
      const r = recoveryStats(p);
      const m = managementStatus(p);
      const showKRW = !!state.settings.showKRW;
      const annualClass = m.zone === 'red' ? 'red' : m.zone === 'yellow' ? 'yellow' : 'green';
      const annualLabel = m.zone === 'red' ? '관리기준 초과' : m.zone === 'yellow' ? '경고 구간' : '안정 구간';
      const goalCard = state.recovery.locked ? `
        <article class="card green">
          <div class="card-head"><div class="card-title">원금 회수</div><div class="tiny">${fmtDate(state.recovery.startDate)} 시작</div></div>
          <div class="big-number">${fmtPct(r.pct)}</div>
          <div class="sub-number">기준원금 ${fmtUSD(state.recovery.basis)}</div>${krwRef(state.recovery.basis)}
          <div class="progress-wrap">
            <div class="progress-meta"><span>회수 진행률</span><span>${fmtUSD(r.total)}</span></div>
            <div class="progress-track"><div class="progress-fill" style="width:${clamp(r.pct,0,100)}%"></div></div>
          </div>
          <div class="metric-grid">
            <div class="metric"><div class="metric-label">남은 원금</div><div class="metric-value">${fmtUSD(r.remaining)}</div>${krwMini(r.remaining)}</div>
            <div class="metric"><div class="metric-label">현재 보유주수</div><div class="metric-value">${fmtShares(p.actualShares)}주</div></div>
            <div class="metric"><div class="metric-label">배당 회수</div><div class="metric-value small">${fmtUSD(r.dividendRecovery)}</div>${krwMini(r.dividendRecovery)}</div>
            <div class="metric"><div class="metric-label">매도 회수</div><div class="metric-value small">${fmtUSD(r.sellRecovery)}</div>${krwMini(r.sellRecovery)}</div>
          </div>
          <button class="btn outline small" style="margin-top:14px;width:100%;color:white;border-color:rgba(255,255,255,.32)" data-page-jump="goal">PROJECT1000 완료 기록 보기</button>
        </article>` : `
        <article class="card accent click-card" data-page-jump="goal" role="button" tabindex="0">
          <span class="card-chevron">›</span>
          <div class="card-head"><div class="card-title">PROJECT 1000</div><div class="tiny">${fmtShares(p.actualShares)} / ${fmtShares(p.currentTarget)}주</div></div>
          <div class="big-number">${fmtPct(p.progress*100)}</div>
          <div class="sub-number">남은 주수 ${fmtShares(Math.max(0,p.currentTarget-p.actualShares))}주</div>
          <div class="progress-wrap">
            <div class="progress-meta"><span>목표 진행률</span><span>${p.progress>=1?'완료':'진행 중'}</span></div>
            <div class="progress-track"><div class="progress-fill" style="width:${clamp(p.progress*100,0,100)}%"></div></div>
          </div>
          <div class="metric-grid">
            <div class="metric"><div class="metric-label">다음 마일스톤</div><div class="metric-value">${nextMilestoneText(p)}</div></div>
            <div class="metric"><div class="metric-label">배당 재투자 주수</div><div class="metric-value">${fmtShares(p.reinvestSharesCurrent)}주</div></div>
          </div>
          ${p.progress>=1?`<button class="btn" style="margin-top:14px;width:100%;background:white;color:var(--accent)" data-confirm-recovery>원금회수 기준 확정</button>`:''}
        </article>`;

      document.getElementById('page-home').innerHTML = `
        <div class="home-grid">
          <article class="card wide">
            <div class="card-head"><div class="card-title">내 투자</div><button class="mini-icon" data-edit-price>현재가 ${fmtUSD(p.currentPrice)}</button></div>
            <div class="big-number">${fmtUSD(p.marketValue)}</div>
            ${krwRef(p.marketValue)}
            <div class="sub-number ${signClass(p.unrealized)}">평가손익 ${fmtUSD(p.unrealized)} · ${fmtPct(p.returnPct)}</div>
            ${krwRef(p.unrealized,signClass(p.unrealized))}
            <div class="metric-grid">
              <div class="metric"><div class="metric-label">보유주수</div><div class="metric-value">${fmtShares(p.actualShares)}주</div></div>
              <div class="metric"><div class="metric-label">평균단가</div><div class="metric-value">${fmtUSD(p.avgCost)}</div></div>
              <div class="metric"><div class="metric-label">투입원금</div><div class="metric-value small">${fmtUSD(p.investedPrincipal)}</div>${krwMini(p.investedPrincipal)}</div>
              <div class="metric"><div class="metric-label">목표주수</div><div class="metric-value small">${fmtShares(p.currentTarget)}주</div></div>
            </div>
          </article>

          <article class="card">
            <div class="card-head"><div class="card-title">총손익</div></div>
            <div class="big-number ${signClass(p.totalReturn)}">${fmtUSD(p.totalReturn)}</div>
            ${krwRef(p.totalReturn,signClass(p.totalReturn))}
            <details class="clean">
              <summary><span>세부 구성 보기</span><span class="chev">⌄</span></summary>
              <div class="metric-grid" style="margin-top:3px">
                <div class="metric"><div class="metric-label">평가손익</div><div class="metric-value small ${signClass(p.unrealized)}">${fmtUSD(p.unrealized)}</div>${krwMini(p.unrealized,signClass(p.unrealized))}</div>
                <div class="metric"><div class="metric-label">실현손익</div><div class="metric-value small ${signClass(p.realized)}">${fmtUSD(p.realized)}</div>${krwMini(p.realized,signClass(p.realized))}</div>
                <div class="metric"><div class="metric-label">누적 세후배당</div><div class="metric-value small">${fmtUSD(p.dividendsTotal)}</div>${krwMini(p.dividendsTotal)}</div>
                <div class="metric"><div class="metric-label">총손익</div><div class="metric-value small ${signClass(p.totalReturn)}">${fmtUSD(p.totalReturn)}</div>${krwMini(p.totalReturn,signClass(p.totalReturn))}</div>
              </div>
            </details>
          </article>

          <article class="card click-card" data-page-jump="dividend" role="button" tabindex="0">
            <span class="card-chevron">›</span>
            <div class="card-head"><div class="card-title">배당</div><span class="status-pill">${annualLabel}</span></div>
            <div class="big-number">${fmtUSD(p.yearDividends)}</div>
            <div class="sub-number">올해 세후배당${showKRW?` · 약 ${fmtKRW(m.krw)}`:''}</div>
            <div class="metric-grid">
              <div class="metric"><div class="metric-label">최근 배당</div><div class="metric-value small">${p.recentDividend?fmtUSD(p.recentDividend.amountUSD):'-'}</div>${p.recentDividend?krwMini(p.recentDividend.amountUSD):''}</div>
              <div class="metric"><div class="metric-label">누적 배당</div><div class="metric-value small">${fmtUSD(p.dividendsTotal)}</div>${krwMini(p.dividendsTotal)}</div>
              <div class="metric"><div class="metric-label">지급 횟수</div><div class="metric-value small">${state.dividends.length.toLocaleString()}회</div></div>
              <div class="metric"><div class="metric-label">관리기준</div><div class="metric-value small">${fmtKRW(m.threshold)}</div></div>
            </div>
            <div class="progress-wrap">
              <div class="progress-meta"><span>연간 배당 관리</span><span>${fmtPct(m.pct)}</span></div>
              <div class="progress-track"><div class="progress-fill ${annualClass}" style="width:${clamp(m.pct,0,100)}%"></div></div>
              <div class="tiny muted" style="margin-top:8px">${m.remaining>0?`남은 금액 ${fmtKRW(m.remaining)}`:'관리기준을 넘었습니다.'} · 설정 환율 참고값</div>
            </div>
          </article>

          ${goalCard}
        </div>`;
    }

    function nextMilestoneText(p) {
      const milestones = [.25,.5,.75,1];
      const next = milestones.find(x => p.progress < x - 1e-10);
      return next ? `${fmtShares(p.currentTarget*next)}주` : '완료';
    }

    function tradeLabel(t) {
      if (t.type === 'sell') return '매도';
      if (t.buyType === 'opening') return '초기보유';
      return t.buyType === 'reinvest' ? '배당재투자' : '직접매수';
    }
    function tradeRow(t, editable=true) {
      const amount = n(t.shares)*n(t.price);
      const isOpening = t.buyType === 'opening';
      const valueClass = t.type === 'sell' ? 'positive' : '';
      const amountText = isOpening ? `기준 ${fmtUSD(amount)}` : `${t.type==='sell'?'+':'-'}${fmtUSD(amount)}`;
      return `<div class="list-row">
        <div><div class="row-title">${tradeLabel(t)} · ${fmtShares(t.shares)}주</div><div class="row-sub">${fmtDate(t.date)} · 단가 ${fmtUSD(t.price)}${t.note?` · ${esc(t.note)}`:''}</div></div>
        <div><div class="row-value ${valueClass}">${amountText}</div>${krwMini(amount,valueClass).replace('krw-ref','row-krw')}${editable?`<div class="row-actions"><button class="mini-icon" data-edit-trade="${t.id}">수정</button><button class="mini-icon delete" data-delete-trade="${t.id}">삭제</button></div>`:''}</div>
      </div>`;
    }
    function dividendRow(d, editable=true) {
      return `<div class="list-row">
        <div><div class="row-title">세후배당</div><div class="row-sub">${fmtDate(d.date)}${d.note?` · ${esc(d.note)}`:''}</div></div>
        <div><div class="row-value positive">+${fmtUSD(d.amountUSD)}</div>${krwMini(d.amountUSD,'positive').replace('krw-ref','row-krw')}${editable?`<div class="row-actions"><button class="mini-icon" data-edit-dividend="${d.id}">수정</button><button class="mini-icon delete" data-delete-dividend="${d.id}">삭제</button></div>`:''}</div>
      </div>`;
    }
    function logRow(l) {
      return `<div class="list-row"><div><div class="row-title">${esc(l.title)}</div><div class="row-sub">${fmtDate(l.date)} · ${esc(l.sub||'')}</div></div><div class="row-value">•</div></div>`;
    }
    function splitRow(s) {
      return `<div class="list-row"><div><div class="row-title">${s.kind==='reverse'?'역분할':'주식분할'} ${s.from}:${s.to}</div><div class="row-sub">${fmtDate(s.date)} · 보유주수와 목표 진행률 동시 조정</div></div><div><div class="row-actions"><button class="mini-icon delete" data-delete-split="${s.id}">삭제</button></div></div></div>`;
    }

    function recentBlock(type, items, rowFn, title, emptyText) {
      const limit = ui.recent[type] || 1;
      const first = items[0];
      let firstMain = emptyText;
      if (first) {
        if (type === 'trade') firstMain = `${tradeLabel(first)} · ${fmtShares(first.shares)}주 · ${fmtUSD(first.price)}`;
        if (type === 'dividend') firstMain = `${fmtUSD(first.amountUSD)} · ${fmtDate(first.date)}`;
        if (type === 'log') firstMain = `${first.title} · ${fmtDate(first.date)}`;
        if (type === 'split') firstMain = `${first.kind==='reverse'?'역분할':'주식분할'} ${first.from}:${first.to} · ${fmtDate(first.date)}`;
      }
      const expanded = limit > 1;
      return `<div class="card recent-box ${expanded?'expanded':''}">
        <button class="recent-toggle" data-toggle-recent="${type}" aria-expanded="${expanded?'true':'false'}">
          <div><div class="recent-label">${esc(title)}</div><div class="recent-main">${esc(firstMain)}</div></div><div class="recent-side">⌄</div>
        </button>
        <div class="recent-content ${expanded?'show':''}">
          <div class="list">${items.slice(0,10).map(rowFn).join('') || `<div class="empty">${esc(emptyText)}</div>`}</div>
          ${items.length>10?`<div class="tiny muted center" style="padding:11px 0 2px">최근 10개까지만 표시합니다.</div>`:''}
        </div>
      </div>`;
    }

    function renderTrade() {
      const p = computePortfolio();
      const trades = [...state.trades].sort((a,b)=>String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
      document.getElementById('page-trade').innerHTML = `
        ${pageHeader('거래','USD 기준')}
        <div class="action-row">
          <button class="btn primary" data-open-trade="buy">＋ 매수 기록</button>
          <button class="btn secondary" data-open-trade="sell">－ 매도 기록</button>
        </div>
        <div class="card compact" style="margin-top:14px">
          <div class="summary-grid">
            <div class="summary-chip"><div class="label">현재 보유</div><div class="value">${fmtShares(p.actualShares)}주</div></div>
            <div class="summary-chip"><div class="label">평균단가</div><div class="value">${fmtUSD(p.avgCost)}</div></div>
            <div class="summary-chip"><div class="label">실현손익</div><div class="value ${signClass(p.realized)}">${fmtUSD(p.realized)}</div>${krwMini(p.realized,signClass(p.realized))}</div>
            <div class="summary-chip"><div class="label">거래 기록</div><div class="value">${trades.length.toLocaleString()}건</div></div>
          </div>
        </div>
        ${pageHeader('최근 거래','누르면 최대 10개')}
        ${recentBlock('trade',trades,t=>tradeRow(t,true),'최근 거래','아직 거래 기록이 없습니다.')}
      `;
    }

    function dividendGroups(dividends, mode) {
      const map = new Map();
      for (const d of dividends) {
        let key;
        if (mode === 'month') key = d.date.slice(0,7);
        else {
          const date = new Date(`${d.date}T12:00:00`);
          const day = (date.getDay()+6)%7;
          date.setDate(date.getDate()-day);
          key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
        }
        map.set(key,(map.get(key)||0)+n(d.amountUSD));
      }
      return [...map.entries()].sort((a,b)=>b[0].localeCompare(a[0]));
    }

    function renderDividend() {
      const p = computePortfolio();
      const years = [...new Set(state.dividends.map(d=>String(d.date).slice(0,4)).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
      const filtered = [...state.dividends]
        .filter(d=>ui.dividendYear==='all'||String(d.date).startsWith(ui.dividendYear))
        .sort((a,b)=>String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
      const selectedTotal = filtered.reduce((s,d)=>s+n(d.amountUSD),0);
      const total = state.dividends.reduce((s,d)=>s+n(d.amountUSD),0);
      const groups = dividendGroups(filtered,ui.dividendGroup).slice(0,18);
      const max = Math.max(1,...groups.map(x=>x[1]));
      const bars = groups.length ? groups.map(([k,v])=>`<div class="bar-row"><div class="bar-label">${ui.dividendGroup==='month'?k.replace('-','.'):fmtDate(k)}</div><div class="bar-track"><div class="bar-fill" style="width:${v/max*100}%"></div></div><div class="bar-value">${fmtUSD(v)}</div></div>`).join('') : `<div class="empty">선택한 기간의 배당 기록이 없습니다.</div>`;
      document.getElementById('page-dividend').innerHTML = `
        ${pageHeader('배당','세후 금액 입력')}
        <button class="btn primary" style="width:100%" data-open-dividend>＋ 배당 기록</button>
        <div class="card compact" style="margin-top:14px">
          <div class="filter-row" style="grid-template-columns:1fr">
            <select class="select" id="dividendYearSelect">
              <option value="all" ${ui.dividendYear==='all'?'selected':''}>전체 연도</option>
              ${years.map(y=>`<option value="${y}" ${ui.dividendYear===y?'selected':''}>${y}년</option>`).join('')}
            </select>
          </div>
          <div class="summary-grid" style="margin-top:14px">
            <div class="summary-chip"><div class="label">선택 기간</div><div class="value">${fmtUSD(selectedTotal)}</div>${krwMini(selectedTotal)}</div>
            <div class="summary-chip"><div class="label">누적 배당</div><div class="value">${fmtUSD(total)}</div>${krwMini(total)}</div>
            <div class="summary-chip"><div class="label">지급 횟수</div><div class="value">${filtered.length.toLocaleString()}회</div></div>
            <div class="summary-chip"><div class="label">최근 배당</div><div class="value">${filtered[0]?fmtUSD(filtered[0].amountUSD):'-'}</div>${filtered[0]?krwMini(filtered[0].amountUSD):''}</div>
            <div class="summary-chip"><div class="label">재투자 사용액</div><div class="value">${fmtUSD(p.reinvestAmount)}</div>${krwMini(p.reinvestAmount)}</div>
            <div class="summary-chip"><div class="label">사용 가능 배당</div><div class="value ${signClass(p.dividendAvailable)}">${fmtUSD(p.dividendAvailable)}</div>${krwMini(p.dividendAvailable,signClass(p.dividendAvailable))}</div>
          </div>
          ${p.dividendAvailable<-.0001?`<div class="check-item" style="margin-top:12px">배당 외 현금이 ${fmtUSD(Math.abs(p.dividendAvailable))} 포함된 재투자로 계산됩니다.</div>`:`<div class="tiny muted" style="margin-top:11px">사용 가능 배당 = 누적 세후배당 − 배당재투자 매수금액</div>`}
          <button class="chart-toggle ${ui.dividendChartOpen?'open':''}" data-toggle-dividend-chart aria-expanded="${ui.dividendChartOpen?'true':'false'}">
            <span class="chart-copy"><span>배당 그래프</span><span class="chart-sub">누르면 월별·주별 흐름을 봅니다.</span></span>
            <span class="chev">⌄</span>
          </button>
          <div class="chart-panel ${ui.dividendChartOpen?'show':''}">
            <div class="segmented" style="margin-top:8px"><button data-div-group="month" class="${ui.dividendGroup==='month'?'active':''}">월별</button><button data-div-group="week" class="${ui.dividendGroup==='week'?'active':''}">주별</button></div>
            <div class="bars">${bars}</div>
          </div>
        </div>
        ${pageHeader('최근 배당','누르면 최대 10개')}
        ${recentBlock('dividend',filtered,d=>dividendRow(d,true),'최근 배당','아직 배당 기록이 없습니다.')}
      `;
    }

    function renderGoal() {
      const p = computePortfolio();
      const r = recoveryStats(p);
      const logs = projectLogs(p,r);
      const monthly = Math.max(0,n(state.settings.monthlyPlanShares));
      const milestones = [25,50,75,100].map(percent => {
        const shares = p.currentTarget*percent/100;
        const done = !!p.milestoneDates[percent];
        const remaining = Math.max(0,shares-p.actualShares);
        const months = monthly>0 ? Math.ceil(remaining/monthly) : null;
        const estimatedDate = months!==null ? addMonthsISO(todayISO(),months) : '';
        const need = remaining*p.currentPrice;
        const open = ui.milestoneOpen === percent;
        const dateText = done ? `달성일 ${fmtDate(p.milestoneDates[percent])}` : estimatedDate ? `예상 달성일 ${fmtDate(estimatedDate)}` : '예상일 계산 불가';
        return `<div class="milestone ${done?'done':''} ${open?'open':''}" data-milestone="${percent}" role="button" tabindex="0">
          <div class="milestone-dot">${percent}%</div>
          <div><div class="milestone-title">${fmtShares(shares)}주</div><div class="milestone-sub">${dateText}</div>
            <div class="milestone-detail">
              <div class="tiny muted">${done?'실제 거래 기록 기준으로 자동 저장된 달성일입니다.':monthly>0?`월 ${fmtShares(monthly)}주 매수 기준 · 남은 ${fmtShares(remaining)}주`:'설정에서 월 계획 매수주수를 입력하면 예상일이 표시됩니다.'}</div>
              ${done?'':`<div class="tiny" style="margin-top:6px;font-weight:800">필요금액 ${fmtUSD(need)}</div>${krwMini(need)}`}
            </div>
          </div>
          <div class="status-pill">${done?'완료':open?'접기':'보기'}</div>
        </div>`;
      }).join('');

      const recoveryCard = state.recovery.locked ? `
        <div class="card">
          <div class="card-head"><div class="card-title">원금 회수</div><span class="status-pill">${fmtPct(r.pct)}</span></div>
          <div class="big-number">${fmtUSD(r.remaining)}</div><div class="sub-number">남은 원금 · 기준 ${fmtUSD(state.recovery.basis)}</div>
          <div class="progress-wrap"><div class="progress-track"><div class="progress-fill green" style="width:${clamp(r.pct,0,100)}%"></div></div></div>
          <div class="metric-grid">
            <div class="metric"><div class="metric-label">배당 회수</div><div class="metric-value small">${fmtUSD(r.dividendRecovery)}</div>${krwMini(r.dividendRecovery)}</div>
            <div class="metric"><div class="metric-label">매도 회수</div><div class="metric-value small">${fmtUSD(r.sellRecovery)}</div>${krwMini(r.sellRecovery)}</div>
            <div class="metric"><div class="metric-label">총 회수액</div><div class="metric-value small">${fmtUSD(r.total)}</div>${krwMini(r.total)}</div>
            <div class="metric"><div class="metric-label">시작일</div><div class="metric-value small">${fmtDate(state.recovery.startDate)}</div></div>
          </div>
        </div>` : `
        <div class="card compact center"><div class="card-title">원금 회수</div><div style="font-weight:850;font-size:18px;margin-top:9px">목표 달성 후 시작됩니다.</div><div class="tiny muted" style="margin-top:7px">목표를 처음 달성하면 기준원금을 확인한 뒤 고정합니다.</div>${p.progress>=1?`<button class="btn primary" style="margin-top:15px;width:100%" data-confirm-recovery>원금회수 기준 확정</button>`:''}</div>`;

      document.getElementById('page-goal').innerHTML = `
        ${pageHeader('PROJECT 1000',`현재 ${fmtShares(p.actualShares)}주`)}
        <div class="card"><div class="roadmap">${milestones}</div>${p.factor!==1?`<div class="tiny muted center" style="margin-top:13px">분할 조정 목표 ${fmtShares(p.currentTarget)}주 · PROJECT1000 명칭은 유지</div>`:''}</div>
        ${pageHeader('배당으로 만든 주식')}
        <div class="card compact"><div class="summary-grid">
          <div class="summary-chip"><div class="label">재투자 주수</div><div class="value">${fmtShares(p.reinvestSharesCurrent)}주</div></div>
          <div class="summary-chip"><div class="label">재투자 금액</div><div class="value">${fmtUSD(p.reinvestAmount)}</div>${krwMini(p.reinvestAmount)}</div>
          <div class="summary-chip"><div class="label">재투자 횟수</div><div class="value">${p.reinvestCount.toLocaleString()}회</div></div>
          <div class="summary-chip"><div class="label">평균 재투자 단가</div><div class="value">${p.reinvestSharesCurrent?fmtUSD(p.reinvestAvgPrice):'-'}</div></div>
        </div></div>
        ${pageHeader('원금 회수')}
        ${recoveryCard}
        ${pageHeader('프로젝트 기록','자동 생성')}
        ${recentBlock('log',logs,logRow,'최근 기록','아직 자동 기록이 없습니다.')}
      `;
    }

    function renderSettings() {
      const p = computePortfolio();
      const discrepancy = state.recovery.locked ? Math.abs(n(state.recovery.calculatedBasisAtLock)-n(p.targetBasisSuggestion)) : 0;
      const check = ui.checkResults;
      const splitItems = [...state.splits].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
      document.getElementById('page-settings').innerHTML = `
        ${pageHeader('설정','저장 버튼으로 적용')}
        <div class="stack">
          <div class="card cloud-card">
            <div class="card-head"><div class="card-title">Google 계정 · 클라우드</div><span class="status-pill">V2.0</span></div>
            <div class="account-row">
              ${currentUser?.photoURL?`<img class="account-avatar" src="${esc(currentUser.photoURL)}" alt="">`:`<div class="account-avatar account-avatar-fallback">G</div>`}
              <div class="account-copy"><div class="account-name">${esc(currentUser?.displayName||'Google 사용자')}</div><div class="account-email">${esc(currentUser?.email||'로그인 확인 중')}</div></div>
            </div>
            <div class="sync-line"><div style="display:flex;align-items:center;gap:10px"><span class="sync-dot ${cloudStatus==='saving'?'busy':cloudStatus==='offline'?'offline':cloudStatus==='error'?'error':''}" id="syncDot"></span><div><div class="setting-title" id="syncStatusText">${cloudStatus==='ok'?'클라우드 저장됨':cloudStatus==='saving'?'클라우드 저장 중':cloudStatus==='offline'?'오프라인 · 기기 저장':cloudStatus==='error'?'클라우드 오류':'동기화 확인 중'}</div><div class="setting-desc">마지막 동기화: <span id="lastSyncText">${lastCloudSyncAt?new Date(lastCloudSyncAt).toLocaleString('ko-KR'):'아직 없음'}</span></div></div></div></div>
            <div class="action-row" style="margin-top:14px"><button class="btn secondary" data-sync-now>지금 동기화</button><button class="btn soft" data-logout>로그아웃</button></div>
            <div class="tiny muted" style="margin-top:11px">입력 내용은 먼저 기기에 저장되고, 인터넷 연결 시 Google 계정으로 자동 동기화됩니다.</div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">화면 및 사용감</div></div>
            <div class="setting-title">화면 모드</div>
            <div class="setting-desc" style="margin-bottom:11px">시스템은 휴대폰의 라이트·다크 설정을 자동으로 따라갑니다.</div>
            <div class="segmented theme-picker">
              <button type="button" data-theme-choice="system" class="${(state.settings.appearance||'system')==='system'?'active':''}">시스템</button>
              <button type="button" data-theme-choice="light" class="${state.settings.appearance==='light'?'active':''}">라이트</button>
              <button type="button" data-theme-choice="dark" class="${state.settings.appearance==='dark'?'active':''}">다크</button>
            </div>
            <div class="tiny muted" style="margin-top:11px">애니메이션은 기기의 ‘동작 줄이기’ 설정을 자동으로 존중합니다.</div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">투자 기준</div></div>
            <div class="settings-group">
              <div class="setting-row"><div><div class="setting-title">현재가</div><div class="setting-desc">평가금액과 필요금액 계산에 사용합니다.</div></div><input class="input" id="setCurrentPrice" type="number" min="0" step="0.0001" value="${n(state.settings.currentPrice)}" /></div>
              <div class="setting-row"><div><div class="setting-title">목표주수</div><div class="setting-desc">분할이 있으면 현재 기준 목표로 표시됩니다.</div></div><input class="input" id="setTargetShares" type="number" min="0.0001" step="0.0001" value="${actualTargetInputValue()}" /></div>
              <div class="setting-row"><div><div class="setting-title">월 계획 매수주수</div><div class="setting-desc">로드맵 예상기간 계산용 참고값입니다.</div></div><input class="input" id="setMonthlyPlan" type="number" min="0" step="0.0001" value="${n(state.settings.monthlyPlanShares)}" /></div>
              <div class="setting-row"><div><div class="setting-title">프로젝트 시작일</div></div><input class="input" id="setProjectStart" type="date" value="${esc(state.settings.projectStart)}" /></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">표시 및 연간 배당 관리</div></div>
            <div class="settings-group">
              <div class="setting-row"><div><div class="setting-title">참고 환율</div><div class="setting-desc">모든 원화 표시는 이 환율로만 참고 환산합니다.</div></div><input class="input" id="setExchangeRate" type="number" min="0" step="1" value="${n(state.settings.exchangeRate)}" /></div>
              <div class="setting-row"><div><div class="setting-title">원화 참고표시</div></div><label class="switch"><input id="setShowKRW" type="checkbox" ${state.settings.showKRW?'checked':''}><span class="switch-ui"></span></label></div>
              <div class="setting-row"><div><div class="setting-title">경고 시작금액</div></div><input class="input" id="setWarningKRW" type="number" min="0" step="10000" value="${n(state.settings.warningKRW)}" /></div>
              <div class="setting-row"><div><div class="setting-title">관리 기준금액</div><div class="setting-desc">법률 계산이 아닌 개인 관리용 기준선입니다.</div></div><input class="input" id="setThresholdKRW" type="number" min="1" step="10000" value="${n(state.settings.thresholdKRW)}" /></div>
            </div>
          </div>

          <div class="settings-save"><button class="btn primary" style="width:100%" data-save-settings>설정 저장</button></div>

          <div class="card">
            <div class="card-head"><div class="card-title">데이터 백업</div></div>
            <div class="action-row"><button class="btn primary" data-backup>JSON 백업</button><button class="btn secondary" data-restore>JSON 복원</button></div>
            <div class="tiny muted" style="margin-top:12px">마지막 백업: ${state.meta.lastBackupAt?new Date(state.meta.lastBackupAt).toLocaleString('ko-KR'):'아직 없음'}</div>
          </div>

          <div class="card">
            <details class="clean" style="border-top:0;margin-top:0;padding-top:0">
              <summary><span><strong style="color:var(--text)">고급 관리</strong><span class="tiny muted" style="display:block;margin-top:4px">분할·원금회수·점검·초기화</span></span><span class="chev">⌄</span></summary>
              <div style="padding-top:8px">
                <div class="card-title" style="margin-bottom:10px">주식 수 조정</div>
                <button class="btn secondary" style="width:100%" data-open-split>＋ 분할·역분할 기록</button>
                <div style="margin-top:12px">${recentBlock('split',splitItems,splitRow,'최근 조정','분할 기록이 없습니다.')}</div>

                ${state.recovery.locked?`<div class="divider"></div><div class="${discrepancy>.01?'warning':''}" style="border-radius:16px;padding:${discrepancy>.01?'14px':'0'}">
                  <div class="card-head"><div class="card-title">원금회수 기준</div><span class="status-pill">잠금</span></div>
                  <div class="big-number">${fmtUSD(state.recovery.basis)}</div>
                  ${krwRef(state.recovery.basis)}
                  <div class="sub-number">${fmtDate(state.recovery.startDate)}부터 회수 집계</div>
                  ${discrepancy>.01?`<div class="check-item" style="margin-top:14px">기록 변경으로 자동 계산값과 차이가 있습니다. 고정값 ${fmtUSD(state.recovery.basis)} · 현재 제안값 ${fmtUSD(p.targetBasisSuggestion)}</div>`:''}
                  <button class="btn outline" style="margin-top:14px;width:100%" data-reset-recovery>기준 재설정</button>
                </div>`:''}

                <div class="divider"></div>
                <div class="action-row"><button class="btn soft" data-csv>CSV 내보내기</button><button class="btn soft" data-project-check>프로젝트 점검</button></div>
                ${check?renderCheckResults(check):''}
                <div class="divider"></div>
                <button class="btn outline" style="width:100%;color:var(--red);border-color:#ffd1d1" data-reset-all>전체 데이터 초기화</button>
              </div>
            </details>
          </div>
          <div class="tiny muted center" style="padding:2px 0 8px">MSTY PROJECT 1000 · V2.0</div>
        </div>`;
    }

    function renderCheckResults(results) {
      if (!results.length) return `<div class="check-list"><div class="check-ok">프로젝트 점검 완료<br><span class="tiny">발견된 오류 없음</span></div></div>`;
      return `<div class="check-list">${results.map(x=>`<div class="check-item">${esc(x)}</div>`).join('')}</div>`;
    }

    function renderAll() {
      renderHome();
      renderTrade();
      renderDividend();
      renderGoal();
      renderSettings();
      bindDynamicEvents();
      markInteractiveCards();
    }

    function showPage(page, options={}) {
      const previous = currentPage;
      const shouldResetScroll = options.resetScroll ?? (page !== previous);
      const oldIndex = PAGE_ORDER.indexOf(previous);
      const newIndex = PAGE_ORDER.indexOf(page);
      const direction = page===previous ? 'soft' : (newIndex>=oldIndex ? 'forward' : 'back');
      currentPage = page;
      document.querySelectorAll('.page').forEach(x=>{
        const active=x.id===`page-${page}`;
        x.classList.toggle('active',active);
        x.classList.remove('enter-forward','enter-back','enter-soft');
        if(active){ void x.offsetWidth; x.classList.add(`enter-${direction}`); }
      });
      document.querySelectorAll('.nav-btn').forEach(x=>{
        const active=x.dataset.page===page;
        x.classList.toggle('active',active);
        if(active){ x.classList.remove('nav-bounce'); void x.offsetWidth; x.classList.add('nav-bounce'); }
      });
      haptic(4);
      if (shouldResetScroll) window.scrollTo({top:0,behavior:motionReduced()?'auto':'smooth'});
      requestAnimationFrame(()=>animateVisibleNumbers(page,!numberCache.size));
    }

    function restoreScrollPosition(y) {
      const restore=()=>window.scrollTo({top:y,behavior:'auto'});
      requestAnimationFrame(()=>{restore();requestAnimationFrame(restore);setTimeout(restore,160);});
    }
    function refreshPage(page=currentPage, resetScroll=false) {
      const y = window.scrollY;
      renderAll();
      showPage(page,{resetScroll});
      if (!resetScroll) restoreScrollPosition(y);
    }

    function preserveScroll(action) {
      const y = window.scrollY;
      action();
      restoreScrollPosition(y);
    }

    function openModal(html) {
      document.getElementById('modal').innerHTML = `<div class="modal-handle"></div>${html}`;
      document.getElementById('modalBackdrop').classList.add('show');
      document.body.style.overflow = 'hidden';
    }
    function closeModal() {
      document.getElementById('modalBackdrop').classList.remove('show');
      document.body.style.overflow = '';
    }

    function openTradeModal(kind='buy', record=null) {
      const isEdit = !!record;
      const type = record?.type || kind;
      const buyType = record?.buyType || 'direct';
      openModal(`
        <h3 class="modal-title">${isEdit?'거래 수정':type==='buy'?'매수 기록':'매도 기록'}</h3>
        <p class="modal-desc">금액은 주수 × 단가로 자동 계산됩니다. 모든 기록은 USD 기준입니다.</p>
        <form id="tradeForm" class="form-grid">
          <input type="hidden" name="id" value="${record?.id||''}">
          <input type="hidden" name="type" value="${type}">
          ${type==='buy'?`<div><label class="input-label">매수 유형</label><div class="segmented"><button type="button" data-buytype="direct" class="${buyType==='direct'?'active':''}">직접매수</button><button type="button" data-buytype="reinvest" class="${buyType==='reinvest'?'active':''}">배당재투자</button>${buyType==='opening'?`<button type="button" data-buytype="opening" class="active">초기보유</button>`:''}</div><input type="hidden" name="buyType" value="${buyType}"></div>`:''}
          <div><label class="input-label">날짜</label><input class="input" type="date" name="date" required value="${record?.date||todayISO()}"></div>
          <div class="form-grid two">
            <div><label class="input-label">주수</label><input class="input" type="number" name="shares" min="0.00000001" step="0.00000001" required value="${record?.shares??''}" placeholder="0"></div>
            <div><label class="input-label">단가 USD</label><input class="input" type="number" name="price" min="0" step="0.0001" required value="${record?.price??''}" placeholder="0.00"></div>
          </div>
          <div class="inline-total"><span class="tiny muted">예상 거래금액</span><strong id="tradeTotalPreview">${record?fmtUSD(n(record.shares)*n(record.price)):fmtUSD(0)}</strong></div>
          <div><label class="input-label">메모 <span class="muted">선택</span></label><input class="input" name="note" maxlength="80" value="${esc(record?.note||'')}" placeholder="짧은 메모"></div>
          <div class="modal-actions"><button type="button" class="btn soft" data-close-modal>취소</button><button class="btn primary" type="submit">${isEdit?'수정 저장':'기록 저장'}</button></div>
        </form>`);
      document.querySelectorAll('[data-buytype]').forEach(btn => btn.addEventListener('click',()=>{
        document.querySelectorAll('[data-buytype]').forEach(x=>x.classList.toggle('active',x===btn));
        document.querySelector('#tradeForm [name="buyType"]').value = btn.dataset.buytype;
      }));
      const tradeForm=document.getElementById('tradeForm');
      const updateTradePreview=()=>{const shares=n(tradeForm.elements.shares.value),price=n(tradeForm.elements.price.value);const el=document.getElementById('tradeTotalPreview');if(el)el.textContent=fmtUSD(shares*price);};
      tradeForm.elements.shares.addEventListener('input',updateTradePreview);
      tradeForm.elements.price.addEventListener('input',updateTradePreview);
      tradeForm.addEventListener('submit',saveTradeForm);
      bindModalClose();
    }

    async function saveTradeForm(ev) {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const item = {
        id: fd.get('id') || uid(),
        type: fd.get('type'),
        buyType: fd.get('type')==='buy' ? (fd.get('buyType')||'direct') : '',
        date: fd.get('date'),
        shares: n(fd.get('shares')),
        price: n(fd.get('price')),
        note: String(fd.get('note')||'').trim(),
        createdAt: new Date().toISOString()
      };
      if (!item.date || item.shares<=0 || item.price<0) return toast('입력값을 확인해 주세요.');
      const dup = state.trades.some(x=>x.id!==item.id && x.date===item.date && x.type===item.type && Math.abs(n(x.shares)-item.shares)<1e-8 && Math.abs(n(x.price)-item.price)<1e-8);
      if (dup && !confirm('같은 날짜·주수·단가의 거래가 있습니다. 그래도 저장할까요?')) return;
      const idx = state.trades.findIndex(x=>x.id===item.id);
      if (idx>=0) item.createdAt = state.trades[idx].createdAt || item.createdAt;
      const trial = deepClone(state);
      const trialIdx = trial.trades.findIndex(x=>x.id===item.id);
      if (trialIdx>=0) trial.trades[trialIdx]=item; else trial.trades.push(item);
      const originalState = state;
      state = trial;
      const trialPortfolio = computePortfolio();
      state = originalState;
      if (trialPortfolio.oversells.length) return toast('이 기록을 저장하면 보유주수를 초과하는 매도가 생깁니다. 날짜와 주수를 확인해 주세요.');
      closeModal();
      const actionLabel=idx>=0?'수정':'저장';
      confirmAction(idx>=0?'거래 수정 확인':'거래 저장 확인',`${tradeLabel(item)} ${fmtShares(item.shares)}주 · 총 ${fmtUSD(item.shares*item.price)}를 ${actionLabel}하시겠습니까?`,actionLabel,async()=>{
        if (idx>=0) state.trades[idx]=item; else state.trades.push(item);
        await saveState(true);
        refreshPage('trade');
        toast(idx>=0?'거래가 수정되었습니다.':'거래가 저장되었습니다.');
        await maybeCelebrateMilestone();
        maybePromptRecovery();
      });
    }

    function openDividendModal(record=null) {
      openModal(`
        <h3 class="modal-title">${record?'배당 수정':'배당 기록'}</h3>
        <p class="modal-desc">실제로 입금된 세후 배당금만 USD로 기록합니다. 환율은 설정의 참고 환율 하나만 사용합니다.</p>
        <form id="dividendForm" class="form-grid">
          <input type="hidden" name="id" value="${record?.id||''}">
          <div><label class="input-label">지급일</label><input class="input" type="date" name="date" required value="${record?.date||todayISO()}"></div>
          <div><label class="input-label">세후 배당금 USD</label><input class="input" type="number" name="amountUSD" min="0" step="0.0001" required value="${record?.amountUSD??''}" placeholder="0.00"></div>
          <div class="inline-total"><span class="tiny muted">저장할 세후 배당</span><strong id="dividendPreview">${record?fmtUSD(record.amountUSD):fmtUSD(0)}</strong></div>
          <div><label class="input-label">메모 <span class="muted">선택</span></label><input class="input" name="note" maxlength="80" value="${esc(record?.note||'')}" placeholder="짧은 메모"></div>
          <div class="modal-actions"><button type="button" class="btn soft" data-close-modal>취소</button><button class="btn primary" type="submit">${record?'수정 저장':'기록 저장'}</button></div>
        </form>`);
      const dividendForm=document.getElementById('dividendForm');
      dividendForm.elements.amountUSD.addEventListener('input',()=>{const el=document.getElementById('dividendPreview');if(el)el.textContent=fmtUSD(n(dividendForm.elements.amountUSD.value));});
      dividendForm.addEventListener('submit',saveDividendForm);
      bindModalClose();
    }

    async function saveDividendForm(ev) {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const item = {id:fd.get('id')||uid(),date:fd.get('date'),amountUSD:n(fd.get('amountUSD')),note:String(fd.get('note')||'').trim(),createdAt:new Date().toISOString()};
      if (!item.date || item.amountUSD<=0) return toast('지급일과 배당금액을 확인해 주세요.');
      const dup = state.dividends.some(x=>x.id!==item.id && x.date===item.date && Math.abs(n(x.amountUSD)-item.amountUSD)<1e-8);
      if (dup && !confirm('같은 날짜·금액의 배당이 있습니다. 그래도 저장할까요?')) return;
      const idx = state.dividends.findIndex(x=>x.id===item.id);
      if (idx>=0) item.createdAt = state.dividends[idx].createdAt || item.createdAt;
      closeModal();
      const actionLabel=idx>=0?'수정':'저장';
      confirmAction(idx>=0?'배당 수정 확인':'배당 저장 확인',`세후 배당 ${fmtUSD(item.amountUSD)}를 ${actionLabel}하시겠습니까?`,actionLabel,async()=>{
        if (idx>=0) state.dividends[idx]=item; else state.dividends.push(item);
        await saveState(true); refreshPage('dividend'); toast(idx>=0?'배당이 수정되었습니다.':'배당이 저장되었습니다.');
      });
    }

    function openSplitModal() {
      openModal(`
        <h3 class="modal-title">분할·역분할 기록</h3>
        <p class="modal-desc">예: 2주가 1주가 되면 2 → 1입니다. 보유주수, 평균단가, 목표주수와 마일스톤 진행률을 함께 조정합니다. 현재가와 월 계획주수는 설정에서 직접 확인해 주세요.</p>
        <form id="splitForm" class="form-grid">
          <div><label class="input-label">적용일</label><input class="input" type="date" name="date" required value="${todayISO()}"></div>
          <div class="form-grid two"><div><label class="input-label">기존 주수</label><input class="input" type="number" name="from" min="0.000001" step="0.000001" required value="2"></div><div><label class="input-label">변경 주수</label><input class="input" type="number" name="to" min="0.000001" step="0.000001" required value="1"></div></div>
          <div class="modal-actions"><button type="button" class="btn soft" data-close-modal>취소</button><button class="btn primary" type="submit">조정 적용</button></div>
        </form>`);
      document.getElementById('splitForm').addEventListener('submit',saveSplitForm);
      bindModalClose();
    }
    async function saveSplitForm(ev) {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const from=n(fd.get('from')),to=n(fd.get('to')),ratio=to/from;
      if (!fd.get('date')||from<=0||to<=0||!Number.isFinite(ratio)) return toast('분할 비율을 확인해 주세요.');
      const item={id:uid(),date:fd.get('date'),from,to,kind:ratio<1?'reverse':'split',createdAt:new Date().toISOString()};
      state.splits.push(item);
      closeModal(); await saveState(true); refreshPage('settings'); toast(ratio<1?'역분할을 반영했습니다.':'주식분할을 반영했습니다.');
    }

    function bindModalClose() {
      document.querySelectorAll('[data-close-modal]').forEach(x=>x.addEventListener('click',closeModal));
    }

    function confirmRecoveryModal(reset=false) {
      const p = computePortfolio();
      const suggested = reset ? n(state.recovery.basis) : n(p.targetBasisSuggestion);
      const reached = p.targetReachedDate || state.recovery.targetReachedDate || todayISO();
      openModal(`
        <h3 class="modal-title">${reset?'원금회수 기준 재설정':'PROJECT1000 달성'}</h3>
        <p class="modal-desc">직접매수금액에서 목표 달성 전 매도대금을 뺀 금액을 자동 제안합니다. 확정 후에는 기록이 바뀌어도 자동으로 변하지 않습니다.</p>
        <form id="recoveryForm" class="form-grid">
          <div><label class="input-label">원금회수 기준금액 USD</label><input class="input" type="number" name="basis" min="0" step="0.01" required value="${round(suggested,2)}"></div>
          <div><label class="input-label">회수 시작일</label><input class="input" type="date" name="startDate" required value="${reset?(state.recovery.startDate||reached):reached}"></div>
          <div class="check-item" style="background:var(--accent-soft);color:#4d43ca">확정 후 배당과 매도대금은 시작일 이후부터 회수액으로 집계됩니다.</div>
          <div class="modal-actions"><button type="button" class="btn soft" data-close-modal>취소</button><button class="btn green" type="submit">기준금액 확정</button></div>
        </form>`);
      document.getElementById('recoveryForm').addEventListener('submit',async ev=>{
        ev.preventDefault(); const fd=new FormData(ev.currentTarget); const basis=n(fd.get('basis')),startDate=fd.get('startDate');
        if (basis<0||!startDate) return toast('기준금액과 시작일을 확인해 주세요.');
        state.recovery={locked:true,basis,startDate,targetReachedDate:p.targetReachedDate||state.recovery.targetReachedDate||startDate,calculatedBasisAtLock:p.targetBasisSuggestion,confirmedAt:new Date().toISOString()};
        closeModal(); await saveState(true); renderAll(); toast('원금회수 기준을 고정했습니다.');
      });
      bindModalClose();
    }

    async function maybeCelebrateMilestone() {
      const p=computePortfolio();
      state.meta.celebratedMilestones = Array.isArray(state.meta.celebratedMilestones) ? state.meta.celebratedMilestones : [];
      const pct=[25,50,75,100].find(x=>p.milestoneDates[x] && !state.meta.celebratedMilestones.includes(x));
      if(!pct) return false;
      state.meta.celebratedMilestones.push(pct);
      await saveState(true);
      const shares=p.currentTarget*pct/100;
      setTimeout(()=>{
        openModal(`<div class="center"><div style="font-size:42px">🎉</div><h3 class="modal-title" style="margin-top:8px">${fmtShares(shares)}주 달성!</h3><p class="modal-desc">${fmtDate(p.milestoneDates[pct])} · PROJECT 1000의 ${pct}%를 달성했습니다.</p><button class="btn primary" style="width:100%" data-close-modal>확인</button></div>`);
        bindModalClose();
      },320);
      return true;
    }

    function maybePromptRecovery() {
      const p=computePortfolio();
      if (!state.recovery.locked && p.progress>=1) setTimeout(()=>confirmRecoveryModal(false),900);
    }

    function confirmDelete(message,onConfirm) {
      openModal(`<h3 class="modal-title">삭제 확인</h3><p class="modal-desc">${esc(message)}</p><div class="modal-actions"><button class="btn soft" data-close-modal>취소</button><button class="btn danger" id="confirmDeleteBtn">삭제</button></div>`);
      document.getElementById('confirmDeleteBtn').addEventListener('click',async()=>{await onConfirm();closeModal();});
      bindModalClose();
    }
    function confirmAction(title,message,confirmText,onConfirm) {
      openModal(`<h3 class="modal-title">${esc(title)}</h3><p class="modal-desc">${esc(message)}</p><div class="modal-actions"><button class="btn soft" data-close-modal>취소</button><button class="btn primary" id="confirmActionBtn">${esc(confirmText)}</button></div>`);
      document.getElementById('confirmActionBtn').addEventListener('click',async()=>{const btn=document.getElementById('confirmActionBtn');btn.disabled=true;await onConfirm();closeModal();});
      bindModalClose();
    }

    function bindDynamicEvents() {
      document.querySelectorAll('[data-page-jump]').forEach(x=>{x.onclick=e=>{if(e.target.closest('button')&&e.target!==x)return;showPage(x.dataset.pageJump,{resetScroll:true});};x.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showPage(x.dataset.pageJump,{resetScroll:true});}};});
      document.querySelectorAll('details.clean').forEach(d=>{
        const summary=d.querySelector('summary');
        if(summary) {
          const capture=()=>{d.dataset.scrollY=String(window.scrollY);};
          summary.onpointerdown=capture;
          summary.onclick=()=>{capture();restoreScrollPosition(n(d.dataset.scrollY));};
        }
        d.ontoggle=()=>{const y=d.dataset.scrollY===''?window.scrollY:n(d.dataset.scrollY);restoreScrollPosition(y);};
      });
      document.querySelectorAll('[data-open-trade]').forEach(x=>x.onclick=()=>openTradeModal(x.dataset.openTrade));
      document.querySelectorAll('[data-open-dividend]').forEach(x=>x.onclick=()=>openDividendModal());
      document.querySelectorAll('[data-open-split]').forEach(x=>x.onclick=openSplitModal);
      document.querySelectorAll('[data-confirm-recovery]').forEach(x=>x.onclick=()=>confirmRecoveryModal(false));
      document.querySelectorAll('[data-reset-recovery]').forEach(x=>x.onclick=()=>confirmRecoveryModal(true));

      document.querySelectorAll('[data-toggle-recent]').forEach(x=>x.onclick=()=>{
        const type=x.dataset.toggleRecent;
        const box=x.closest('.recent-box');
        const content=box?.querySelector('.recent-content');
        const opening=!(box?.classList.contains('expanded'));
        ui.recent[type]=opening?10:1;
        box?.classList.toggle('expanded',opening);
        content?.classList.toggle('show',opening);
        x.setAttribute('aria-expanded',opening?'true':'false');
        haptic(4);
      });
      document.querySelectorAll('[data-set-recent]').forEach(x=>x.onclick=()=>{ui.recent[x.dataset.setRecent]=n(x.dataset.limit);refreshPage(currentPage);});
      document.querySelectorAll('[data-milestone]').forEach(x=>{const toggle=()=>preserveScroll(()=>{const pct=n(x.dataset.milestone);ui.milestoneOpen=ui.milestoneOpen===pct?null:pct;renderGoal();bindDynamicEvents();});x.onclick=toggle;x.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}};});
      document.querySelectorAll('[data-edit-price]').forEach(x=>x.onclick=e=>{e.stopPropagation();openPriceModal();});

      document.querySelectorAll('[data-edit-trade]').forEach(x=>x.onclick=()=>openTradeModal('buy',state.trades.find(t=>t.id===x.dataset.editTrade)));
      document.querySelectorAll('[data-delete-trade]').forEach(x=>x.onclick=()=>confirmDelete('이 거래 기록을 삭제할까요?',async()=>{state.trades=state.trades.filter(t=>t.id!==x.dataset.deleteTrade);await saveState(true);refreshPage('trade');toast('거래를 삭제했습니다.');}));
      document.querySelectorAll('[data-edit-dividend]').forEach(x=>x.onclick=()=>openDividendModal(state.dividends.find(d=>d.id===x.dataset.editDividend)));
      document.querySelectorAll('[data-delete-dividend]').forEach(x=>x.onclick=()=>confirmDelete('이 배당 기록을 삭제할까요?',async()=>{state.dividends=state.dividends.filter(d=>d.id!==x.dataset.deleteDividend);await saveState(true);refreshPage('dividend');toast('배당을 삭제했습니다.');}));
      document.querySelectorAll('[data-delete-split]').forEach(x=>x.onclick=()=>confirmDelete('이 분할 기록을 삭제할까요? 보유주수와 목표 계산이 다시 바뀝니다.',async()=>{state.splits=state.splits.filter(s=>s.id!==x.dataset.deleteSplit);await saveState(true);refreshPage('settings');toast('분할 기록을 삭제했습니다.');}));

      const yearSelect=document.getElementById('dividendYearSelect'); if(yearSelect) yearSelect.onchange=()=>preserveScroll(()=>{ui.dividendYear=yearSelect.value;renderDividend();bindDynamicEvents();});
      document.querySelectorAll('[data-toggle-dividend-chart]').forEach(x=>x.onclick=()=>preserveScroll(()=>{ui.dividendChartOpen=!ui.dividendChartOpen;renderDividend();bindDynamicEvents();}));
      document.querySelectorAll('[data-div-group]').forEach(x=>x.onclick=()=>preserveScroll(()=>{ui.dividendGroup=x.dataset.divGroup;ui.dividendChartOpen=true;renderDividend();bindDynamicEvents();}));

      document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.onclick=async()=>{
        state.settings.appearance=btn.dataset.themeChoice;
        applyTheme(state.settings.appearance);
        document.querySelectorAll('[data-theme-choice]').forEach(x=>x.classList.toggle('active',x===btn));
        await saveState(true);
        toast('화면 모드를 변경했습니다.');
      });

      bindSettingInputs();
      document.querySelectorAll('[data-sync-now]').forEach(x=>x.onclick=async()=>{await pushCloudState();renderSettings();bindDynamicEvents();toast(cloudStatus==='ok'?'동기화를 완료했습니다.':'동기화 상태를 확인해 주세요.');});
      document.querySelectorAll('[data-logout]').forEach(x=>x.onclick=()=>confirmAction('로그아웃','이 기기에서 Google 계정 연결을 해제할까요? 클라우드 데이터는 삭제되지 않습니다.','로그아웃',async()=>{await logoutGoogle();toast('로그아웃했습니다.');}));
      document.querySelectorAll('[data-backup]').forEach(x=>x.onclick=downloadBackup);
      document.querySelectorAll('[data-restore]').forEach(x=>x.onclick=()=>document.getElementById('restoreInput').click());
      document.querySelectorAll('[data-csv]').forEach(x=>x.onclick=exportCSV);
      document.querySelectorAll('[data-project-check]').forEach(x=>x.onclick=()=>preserveScroll(()=>{ui.checkResults=projectCheck();renderSettings();bindDynamicEvents();toast(ui.checkResults.length?`${ui.checkResults.length}개 항목을 확인해 주세요.`:'오류가 발견되지 않았습니다.');}));
      document.querySelectorAll('[data-reset-all]').forEach(x=>x.onclick=()=>confirmDelete('모든 거래·배당·설정·회수 기록을 초기화합니다. 되돌릴 수 없습니다.',async()=>{await storageSet(SAFETY_KEY,deepClone(state));state=blankState();ui.checkResults=null;await saveState(true);renderAll();showPage('home',{resetScroll:true});toast('전체 데이터를 초기화했습니다.');}));
    }

    function bindSettingInputs() {
      const saveBtn=document.querySelector('[data-save-settings]');
      if(!saveBtn) return;
      saveBtn.onclick=async()=>{
        const currentPrice=Math.max(0,n(document.getElementById('setCurrentPrice')?.value));
        const targetValue=Math.max(.0001,n(document.getElementById('setTargetShares')?.value));
        const monthlyPlanShares=Math.max(0,n(document.getElementById('setMonthlyPlan')?.value));
        const projectStart=document.getElementById('setProjectStart')?.value||todayISO();
        const exchangeRate=Math.max(0,n(document.getElementById('setExchangeRate')?.value));
        const warningKRW=Math.max(0,n(document.getElementById('setWarningKRW')?.value));
        const thresholdKRW=Math.max(1,n(document.getElementById('setThresholdKRW')?.value));
        const showKRW=!!document.getElementById('setShowKRW')?.checked;
        const factor=currentFactor();
        state.settings=Object.assign(state.settings,{currentPrice,targetUnits:targetValue/factor,monthlyPlanShares,projectStart,exchangeRate,warningKRW,thresholdKRW,showKRW});
        await saveState(true);
        renderAll();showPage('settings',{resetScroll:false});toast('설정이 저장되었습니다.');
      };
    }

    function openPriceModal() {
      openModal(`<h3 class="modal-title">현재가 수정</h3><p class="modal-desc">평가금액과 목표 필요금액 계산에 즉시 반영됩니다.</p><form id="priceForm" class="form-grid"><div><label class="input-label">현재가 USD</label><input class="input" name="price" type="number" min="0" step="0.0001" required value="${n(state.settings.currentPrice)}"></div><div class="modal-actions"><button type="button" class="btn soft" data-close-modal>취소</button><button class="btn primary" type="submit">저장</button></div></form>`);
      document.getElementById('priceForm').onsubmit=async ev=>{ev.preventDefault();const value=Math.max(0,n(new FormData(ev.currentTarget).get('price')));state.settings.currentPrice=value;await saveState(true);closeModal();renderAll();showPage('home',{resetScroll:false});toast('현재가가 저장되었습니다.');};
      bindModalClose();
    }

    function projectCheck() {
      const issues=[];
      const p=computePortfolio();
      if (p.actualShares < -1e-8) issues.push('보유주수가 음수입니다. 거래 기록을 확인하세요.');
      if (p.oversells.length) issues.push(`보유량을 초과한 매도 기록이 ${p.oversells.length}건 있습니다.`);
      const badTrade=state.trades.filter(t=>!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||n(t.shares)<=0||n(t.price)<0); if(badTrade.length)issues.push(`날짜·주수·단가가 잘못된 거래가 ${badTrade.length}건 있습니다.`);
      const badDiv=state.dividends.filter(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||n(d.amountUSD)<=0); if(badDiv.length)issues.push(`날짜·금액이 잘못된 배당이 ${badDiv.length}건 있습니다.`);
      const badSplit=state.splits.filter(s=>!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||n(s.from)<=0||n(s.to)<=0); if(badSplit.length)issues.push(`분할 비율이 잘못된 기록이 ${badSplit.length}건 있습니다.`);
      const tradeKeys=new Set(),tradeDup=[]; state.trades.forEach(t=>{const k=[t.date,t.type,t.buyType,n(t.shares).toFixed(8),n(t.price).toFixed(8)].join('|');if(tradeKeys.has(k))tradeDup.push(t);else tradeKeys.add(k);}); if(tradeDup.length)issues.push(`중복 가능성이 있는 거래가 ${tradeDup.length}건 있습니다.`);
      const divKeys=new Set(),divDup=[]; state.dividends.forEach(d=>{const k=[d.date,n(d.amountUSD).toFixed(8)].join('|');if(divKeys.has(k))divDup.push(d);else divKeys.add(k);}); if(divDup.length)issues.push(`중복 가능성이 있는 배당이 ${divDup.length}건 있습니다.`);
      if (p.targetReachedDate && !state.recovery.locked) issues.push('목표를 달성했지만 원금회수 기준이 아직 확정되지 않았습니다.');
      if (state.recovery.locked && (!state.recovery.startDate || n(state.recovery.basis)<0)) issues.push('원금회수 기준금액 또는 시작일이 올바르지 않습니다.');
      if (state.recovery.locked && Math.abs(n(state.recovery.calculatedBasisAtLock)-n(p.targetBasisSuggestion))>.01) issues.push(`고정 원금과 현재 자동 계산 제안값이 다릅니다. 고정 ${fmtUSD(state.recovery.basis)}, 현재 제안 ${fmtUSD(p.targetBasisSuggestion)}.`);
      if (Math.abs(p.reinvestSharesCurrent)<1e-8 && p.reinvestAmount>0) issues.push('재투자 금액은 있으나 재투자 주수 계산이 0입니다.');
      if (state.meta.lastBackupAt) {
        const days=(Date.now()-new Date(state.meta.lastBackupAt).getTime())/86400000; if(days>60)issues.push(`마지막 백업 후 ${Math.floor(days)}일이 지났습니다.`);
      } else if (state.trades.length+state.dividends.length>0) issues.push('아직 JSON 백업을 만든 적이 없습니다.');
      return issues;
    }

    function downloadFile(filename,content,type='application/octet-stream') {
      const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    }
    async function downloadBackup() {
      state.meta.lastBackupAt=new Date().toISOString(); await saveState(true);
      const date=todayISO().replaceAll('-','');
      downloadFile(`MSTY_PROJECT1000_backup_${date}.json`,JSON.stringify(state,null,2),'application/json;charset=utf-8');
      refreshPage('settings');toast('JSON 백업을 저장했습니다.');
    }
    function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
    function exportCSV() {
      const rows=[['구분','ID','날짜','유형','세부유형','주수','단가USD','금액USD','메모','기존주수','변경주수']];
      state.trades.forEach(t=>rows.push(['거래',t.id,t.date,t.type,t.buyType,t.shares,t.price,n(t.shares)*n(t.price),t.note,'','']));
      state.dividends.forEach(d=>rows.push(['배당',d.id,d.date,'dividend','','','',d.amountUSD,d.note,'','']));
      state.splits.forEach(s=>rows.push(['분할',s.id,s.date,s.kind,'','','','','','',s.from,s.to]));
      const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\n');
      downloadFile(`MSTY_PROJECT1000_${todayISO().replaceAll('-','')}.csv`,csv,'text/csv;charset=utf-8');toast('CSV를 저장했습니다.');
    }

    async function restoreFromFile(file) {
      try {
        const text=await file.text(); const parsed=JSON.parse(text);
        if (!parsed || !Array.isArray(parsed.trades) || !Array.isArray(parsed.dividends)) throw new Error('형식 오류');
        await storageSet(SAFETY_KEY,deepClone(state));
        state=migrate(parsed); await saveState(true); ui.checkResults=null; renderAll();showPage('home',{resetScroll:true});toast('백업을 복원했습니다.');
      } catch(err) {console.error(err);toast('올바른 백업 파일이 아닙니다.');}
    }

    function showAuthGate(message='Google로 로그인해 주세요.') {
      const gate=document.getElementById('authGate'); if(gate) gate.classList.remove('hidden');
      const status=document.getElementById('authGateStatus'); if(status) status.textContent=message;
    }
    function hideAuthGate() { const gate=document.getElementById('authGate'); if(gate) gate.classList.add('hidden'); }
    async function chooseInitialSync(cloudState) {
      const localHas=hasMeaningfulData(state), cloudHas=hasMeaningfulData(cloudState);
      if(cloudState && cloudHas){
        const localTime=new Date(state.meta?.updatedAt||0).getTime(); const cloudTime=new Date(cloudState.meta?.updatedAt||0).getTime();
        if(localHas && localTime>cloudTime+3000){
          return await new Promise(resolve=>{
            openModal(`<h3 class="modal-title">동기화할 데이터 선택</h3><p class="modal-desc">이 기기의 기록이 클라우드보다 새롭습니다.</p><div class="form-grid"><button class="btn primary" id="useLocalCloud">기기 기록을 클라우드에 저장</button><button class="btn secondary" id="useCloudLocal">클라우드 기록 불러오기</button></div>`);
            document.getElementById('useLocalCloud').onclick=()=>{closeModal();resolve('local');}; document.getElementById('useCloudLocal').onclick=()=>{closeModal();resolve('cloud');};
          });
        }
        return 'cloud';
      }
      if(localHas){
        return await new Promise(resolve=>{
          openModal(`<h3 class="modal-title">첫 클라우드 연결</h3><p class="modal-desc">이 기기에 기존 기록이 있습니다. 클라우드에 올릴지, 빈 상태로 새로 시작할지 선택하세요.</p><div class="form-grid"><button class="btn primary" id="uploadLocalFirst">기기 기록을 클라우드에 저장</button><button class="btn secondary" id="startBlankFirst">빈 상태로 새로 시작</button></div>`);
          document.getElementById('uploadLocalFirst').onclick=()=>{closeModal();resolve('local');}; document.getElementById('startBlankFirst').onclick=()=>{closeModal();resolve('blank');};
        });
      }
      return 'blank';
    }
    async function connectCloudForUser(user) {
      currentUser=user; setCloudStatus('saving','동기화 확인 중');
      let cloudData; try { cloudData=await getCloudDocument(user.uid); } catch(err){ console.error(err); setCloudStatus('error','클라우드 연결 오류'); hideAuthGate(); return; }
      const cloudState=cloudData?.state?migrate(cloudData.state):null;
      const choice=await chooseInitialSync(cloudState);
      if(choice==='cloud' && cloudState){ applyingCloudState=true; state=cloudState; await storageSet(STATE_KEY,state); applyingCloudState=false; }
      else if(choice==='blank'){ applyingCloudState=true; state=blankState(); await storageSet(STATE_KEY,state); applyingCloudState=false; await pushCloudState(); }
      else await pushCloudState();
      renderAll(); showPage(currentPage||'home',{resetScroll:false}); hideAuthGate();
      cloudUnsubscribe?.();
      cloudUnsubscribe=subscribeCloudDocument(user.uid,cloudData=>{
        if(!cloudData?.state||applyingCloudState) return;
        const remote=migrate(cloudData.state);
        const remoteTime=new Date(remote.meta?.updatedAt||0).getTime(), localTime=new Date(state.meta?.updatedAt||0).getTime();
        if(remoteTime>localTime+1000){ applyingCloudState=true; state=remote; storageSet(STATE_KEY,state).then(()=>{renderAll();showPage(currentPage,{resetScroll:false});lastCloudSyncAt=new Date().toISOString();setCloudStatus('ok','클라우드 동기화됨');applyingCloudState=false;}); }
      },err=>{console.error(err);setCloudStatus('error','동기화 오류');});
      lastCloudSyncAt=new Date().toISOString(); setCloudStatus('ok','클라우드 연결됨');
    }
    async function initAuth() {
      await initGoogleAuth({
        loginButtonId: 'googleLoginBtn',
        statusElementId: 'authGateStatus',
        onSignedIn: connectCloudForUser,
        onSignedOut: () => {
          currentUser=null;
          cloudUnsubscribe?.();
          cloudUnsubscribe=null;
          setSaveStatus('로그인 필요');
          showAuthGate('Google로 로그인하면 자동 동기화됩니다.');
        },
        onError: message => toast(message)
      });
      window.addEventListener('online',()=>{if(currentUser)pushCloudState();});
      window.addEventListener('offline',()=>setCloudStatus('offline','오프라인 · 기기 저장'));
    }

    function bindStaticEvents() {
      document.addEventListener('pointerdown',addRipple,{passive:true});
      const themeMedia=window.matchMedia?.('(prefers-color-scheme: dark)');
      themeMedia?.addEventListener?.('change',()=>{if((state.settings.appearance||'system')==='system')applyTheme('system');});
      document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>showPage(btn.dataset.page)));
      document.getElementById('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal();});
      document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
      document.getElementById('restoreInput').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)restoreFromFile(file);e.target.value='';});
    }

    async function init() {
      try {
        await openStorage();
        state=migrate(await storageGet(STATE_KEY));
        applyTheme(state.settings.appearance||'system');
        await storageSet(STATE_KEY,state);
        renderAll();
        bindStaticEvents();
        showPage('home',{resetScroll:true});
        await initAuth();
        hideSplash();
        if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
          navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('SW registration failed',err));
        }
      } catch(err) {
        console.error(err);
        document.getElementById('page-home').innerHTML=`<div class="card danger"><div class="card-title">저장소를 열 수 없습니다.</div><p class="tiny">브라우저의 시크릿 모드가 아닌 일반 모드에서 다시 열어 주세요.</p></div>`;
        setSaveStatus('오류');
        hideSplash();
      }
    }

    init();
  })();