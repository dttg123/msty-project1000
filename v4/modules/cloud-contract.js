const encoder = new TextEncoder();
export const CLOUD_STORAGE_FORMAT = 'split-v1';
export const CLOUD_SEGMENT_LIMIT_BYTES = 700_000;
export function canonicalStringify(value) {
    const seen = new WeakSet();
    const normalize = (input) => {
        if (input === null || typeof input !== 'object')
            return input;
        if (seen.has(input))
            throw new TypeError('순환 데이터는 저장할 수 없습니다.');
        seen.add(input);
        const output = Array.isArray(input) ? input.map(normalize) : Object.fromEntries(Object.keys(input).sort().filter(key => input[key] !== undefined).map(key => [key, normalize(input[key])]));
        seen.delete(input);
        return output;
    };
    return JSON.stringify(normalize(value));
}
export function utf8Bytes(value) { return encoder.encode(typeof value === 'string' ? value : canonicalStringify(value)).byteLength; }
export async function sha256Hex(value) {
    const bytes = encoder.encode(typeof value === 'string' ? value : canonicalStringify(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function stateCounts(state = {}) {
    return {
        securities: Array.isArray(state.projects) ? state.projects.length : 0,
        trades: Array.isArray(state.trades) ? state.trades.length : 0,
        dividends: Array.isArray(state.dividends) ? state.dividends.length : 0,
        splits: Array.isArray(state.splits) ? state.splits.length : 0,
        cashAdjustments: Array.isArray(state.cashAdjustments) ? state.cashAdjustments.length : 0
    };
}
function chunkRows(key, rows, limit = CLOUD_SEGMENT_LIMIT_BYTES) {
    const safeLimit = Math.max(1024, limit - 1024);
    if (!Array.isArray(rows) || !rows.length)
        return [{ id: `${key}-0000`, key, index: 0, rows: [] }];
    const chunks = [];
    let current = [], currentBytes = utf8Bytes({ key, rows: [] });
    for (const row of rows) {
        const rowBytes = utf8Bytes(row) + 1;
        if (current.length && currentBytes + rowBytes > safeLimit) {
            chunks.push(current);
            current = [];
            currentBytes = utf8Bytes({ key, rows: [] });
        }
        if (currentBytes + rowBytes > safeLimit)
            throw new Error(`${key} 단일 기록이 클라우드 문서 안전 크기를 초과합니다.`);
        current.push(row);
        currentBytes += rowBytes;
    }
    chunks.push(current);
    return chunks.map((chunk, index) => ({ id: `${key}-${String(index).padStart(4, '0')}`, key, index, rows: chunk }));
}
export function splitStateDocuments(state, limit = CLOUD_SEGMENT_LIMIT_BYTES) {
    const fixed = [
        { id: 'profile-0000', key: 'profile', index: 0, value: { version: state.version, ...(state.schemaVersion !== undefined ? { schemaVersion: state.schemaVersion } : {}), settings: state.settings || {}, meta: state.meta || {} } },
        { id: 'securities-0000', key: 'securities', index: 0, rows: Array.isArray(state.projects) ? state.projects : [] },
        { id: 'integrations-0000', key: 'integrations', index: 0, value: state.integrations || {} }
    ];
    for (const document of fixed)
        if (utf8Bytes(document) > limit)
            throw new Error(`${document.key} 데이터가 클라우드 문서 안전 크기를 초과합니다.`);
    return [...fixed, ...chunkRows('trades', state.trades, limit), ...chunkRows('dividends', state.dividends, limit), ...chunkRows('splits', state.splits, limit), ...chunkRows('cashAdjustments', state.cashAdjustments, limit)];
}
export async function prepareCloudRevision(state, { expectedRevision = 0, createdAt = new Date().toISOString(), batchId = crypto.randomUUID() } = {}) {
    const stateText = canonicalStringify(state), documents = splitStateDocuments(state);
    const prepared = [];
    for (const document of documents) {
        const payload = { ...document, batchId };
        prepared.push({ ...payload, bytes: utf8Bytes(payload), hash: await sha256Hex(payload) });
    }
    const revision = Math.max(0, Number(expectedRevision) || 0) + 1;
    const manifest = { storageFormat: CLOUD_STORAGE_FORMAT, schemaVersion: Number(state.schemaVersion ?? state.version) || 4, revision, expectedRevision: Math.max(0, Number(expectedRevision) || 0), revisionId: `r${String(revision).padStart(8, '0')}-${batchId}`, batchId, createdAt, counts: stateCounts(state), stateBytes: utf8Bytes(stateText), stateHash: await sha256Hex(stateText), segments: prepared.map(({ id, key, index, bytes, hash, rows, value }) => ({ id, key, index, bytes, hash, rowCount: Array.isArray(rows) ? rows.length : (value === undefined ? 0 : 1) })) };
    return { manifest, documents: prepared, stateText };
}
export async function assembleCloudState(manifest, documents) {
    if (manifest?.storageFormat !== CLOUD_STORAGE_FORMAT)
        throw new Error('지원하지 않는 클라우드 저장 형식입니다.');
    const byId = new Map((documents || []).map((document) => [document.id, document]));
    for (const expected of manifest.segments || []) {
        const actual = byId.get(expected.id);
        if (!actual)
            throw new Error(`클라우드 조각이 누락되었습니다: ${expected.id}`);
        const payload = { id: actual.id, key: actual.key, index: actual.index, ...(actual.rows !== undefined ? { rows: actual.rows } : { value: actual.value }), batchId: actual.batchId };
        if (await sha256Hex(payload) !== expected.hash)
            throw new Error(`클라우드 조각 무결성 검증에 실패했습니다: ${expected.id}`);
    }
    const ordered = (key) => (manifest.segments || []).filter((segment) => segment.key === key).sort((a, b) => a.index - b.index).map((segment) => byId.get(segment.id));
    const profile = ordered('profile')[0]?.value || {}, securities = ordered('securities')[0]?.rows || [], integrations = ordered('integrations')[0]?.value || {};
    const rows = (key) => ordered(key).flatMap((document) => document.rows || []);
    const state = { version: profile.version, ...(profile.schemaVersion !== undefined ? { schemaVersion: profile.schemaVersion } : {}), settings: profile.settings || {}, projects: securities, trades: rows('trades'), dividends: rows('dividends'), splits: rows('splits'), cashAdjustments: rows('cashAdjustments'), integrations, meta: profile.meta || {} };
    if (await sha256Hex(canonicalStringify(state)) !== manifest.stateHash)
        throw new Error('클라우드 전체 데이터 무결성 검증에 실패했습니다.');
    return state;
}
export class CloudConflictError extends Error {
    code;
    expectedRevision;
    actualRevision;
    constructor(expectedRevision, actualRevision) { super(`클라우드 revision 충돌: 기기 ${expectedRevision}, 최신 ${actualRevision}`); this.name = 'CloudConflictError'; this.code = 'cloud-conflict'; this.expectedRevision = expectedRevision; this.actualRevision = actualRevision; }
}
export function assertCloudRevision(expectedRevision, actualRevision) {
    const expected = Math.max(0, Number(expectedRevision) || 0), actual = Math.max(0, Number(actualRevision) || 0);
    if (expected !== actual)
        throw new CloudConflictError(expected, actual);
    return true;
}
