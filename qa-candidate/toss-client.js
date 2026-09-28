import { getGoogleIdToken } from './modules/cloud-api.js';
import { TOSS_BRIDGE_URL, TOSS_SYNC_FROM } from './runtime-config.js';
// Removed in the server-only migration. Never read or return the old value.
const LEGACY_DIRECT_CONFIG_KEY = 'dividend-os-toss-direct-v1';
function localStorageAvailable() {
    try {
        return typeof localStorage !== 'undefined';
    }
    catch (_) {
        return false;
    }
}
export function removeLegacyTossBrowserCredentials() {
    if (!localStorageAvailable())
        return false;
    try {
        localStorage.removeItem(LEGACY_DIRECT_CONFIG_KEY);
        return true;
    }
    catch (_) {
        return false;
    }
}
export function isTossBridgeConfigured() {
    return /^https:\/\//i.test(String(TOSS_BRIDGE_URL || '').trim());
}
function validDate(value, fallback) {
    const text = String(value || ''), match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match)
        return fallback;
    const date = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]) ? text : fallback;
}
function cleanSymbols(values = []) {
    return [...new Set(values.map((value) => String(value || '').trim().toUpperCase()).filter((value) => /^[A-Z0-9.-]{1,16}$/.test(value)))].slice(0, 200);
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
export function validateTossSnapshotPayload(value) {
    if (!object(value))
        throw Object.assign(new Error('토스 중계 서버 응답 형식이 올바르지 않습니다.'), { code: 'invalid-bridge-response' });
    const limits = { holdings: 25000, prices: 200, orders: 50000, dividends: 25000, accountResults: 5 };
    for (const [key, limit] of Object.entries(limits))
        if (!Array.isArray(value[key]) || value[key].length > Number(limit) || value[key].some((row) => !object(row)))
            throw Object.assign(new Error('토스 중계 서버 응답 형식이 올바르지 않습니다.'), { code: 'invalid-bridge-response' });
    if (!/^[a-f0-9]{24}$/.test(String(value.accountScopeId || '')) || !['complete', 'partial'].includes(value.syncStatus) || !object(value.syncCursor) || !object(value.capabilities))
        throw Object.assign(new Error('토스 중계 서버 응답 형식이 올바르지 않습니다.'), { code: 'invalid-bridge-response' });
    return value;
}
function publicBridgeError(status, body = {}) {
    if (status === 401)
        return Object.assign(new Error('Google 로그인이 만료되었습니다. 다시 로그인해 주세요.'), { code: 'invalid-login' });
    if (status === 403)
        return Object.assign(new Error('이 계정은 토스 연동 사용 권한이 없습니다.'), { code: 'owner-only' });
    if (status === 429)
        return Object.assign(new Error('조회 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.'), { code: 'too-many-requests' });
    const messages = {
        'no-account': '조회 가능한 토스증권 계좌가 없습니다.',
        'bridge-not-configured': '토스 중계 서버 인증 설정을 확인해야 합니다.',
        'toss-rate-limit': '토스 조회 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
        'toss-unavailable': '토스 조회 서버가 일시적으로 응답하지 않습니다.'
    };
    const code = Object.hasOwn(messages, body?.code) ? body.code : 'toss-bridge';
    return Object.assign(new Error(messages[code] || '토스 조회 서버에서 안전하게 처리하지 못했습니다.'), { code, status });
}
export async function fetchTossSnapshot({ from = TOSS_SYNC_FROM, symbols = [] } = {}) {
    if (!isTossBridgeConfigured())
        throw Object.assign(new Error('토스 읽기 전용 중계 서버가 아직 설정되지 않았습니다.'), { code: 'bridge-not-configured' });
    const idToken = await getGoogleIdToken();
    if (!idToken)
        throw Object.assign(new Error('Google 로그인 후 토스 계좌를 조회할 수 있습니다.'), { code: 'login-required' });
    const base = String(TOSS_BRIDGE_URL).replace(/\/+$/, '');
    const url = new URL(`${base}/v1/toss/snapshot`);
    const today = new Date().toISOString().slice(0, 10), checkedFrom = validDate(from, TOSS_SYNC_FROM);
    url.searchParams.set('from', checkedFrom > today ? today : checkedFrom);
    const clean = cleanSymbols(symbols);
    if (clean.length)
        url.searchParams.set('symbols', clean.join(','));
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' }, signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
            throw publicBridgeError(response.status, body);
        return validateTossSnapshotPayload(body);
    }
    catch (error) {
        if (error?.name === 'AbortError')
            throw Object.assign(new Error('토스 조회 시간이 초과되었습니다.'), { code: 'timeout' });
        if (error instanceof TypeError)
            throw Object.assign(new Error('토스 중계 서버에 연결하지 못했습니다.'), { code: 'bridge-unavailable' });
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
