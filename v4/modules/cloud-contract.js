import { isRecord } from './utils.js';
const encoder = new TextEncoder();
export function syncSignature(value) {
    const state = value && typeof value === 'object' ? value : {};
    return canonicalStringify(['projects', 'trades', 'dividends', 'splits', 'cashAdjustments', 'settings'].map(key => state[key]));
}
export function chooseCloudSync(local, remote, baseSignature) {
    const localSignature = syncSignature(local), remoteSignature = syncSignature(remote);
    if (localSignature === remoteSignature)
        return 'local';
    if (baseSignature === remoteSignature)
        return 'local';
    if (baseSignature === localSignature)
        return 'cloud';
    return 'review';
}
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
export function stateCounts(value = {}) {
    const state = isRecord(value) ? value : {};
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
    if (!isRecord(manifest) || manifest.storageFormat !== CLOUD_STORAGE_FORMAT)
        throw new Error('지원하지 않는 클라우드 저장 형식입니다.');
    if (!Array.isArray(manifest.segments) || !manifest.segments.every(isRecord) || !Array.isArray(documents) || !documents.every(isRecord))
        throw new Error('클라우드 조각 형식이 올바르지 않습니다.');
    const segments = manifest.segments, byId = new Map(documents.map(document => [document.id, document]));
    for (const expected of segments) {
        const actual = byId.get(expected.id);
        if (!actual)
            throw new Error(`클라우드 조각이 누락되었습니다: ${expected.id}`);
        const payload = { id: actual.id, key: actual.key, index: actual.index, ...(actual.rows !== undefined ? { rows: actual.rows } : { value: actual.value }), batchId: actual.batchId };
        if (await sha256Hex(payload) !== expected.hash)
            throw new Error(`클라우드 조각 무결성 검증에 실패했습니다: ${expected.id}`);
    }
    const ordered = (key) => segments.filter(segment => segment.key === key).sort((a, b) => Number(a.index) - Number(b.index)).map(segment => byId.get(segment.id));
    const profileValue = ordered('profile')[0]?.value, profile = isRecord(profileValue) ? profileValue : {}, securities = ordered('securities')[0]?.rows || [], integrations = ordered('integrations')[0]?.value || {};
    const rows = (key) => ordered(key).flatMap(document => Array.isArray(document?.rows) ? document.rows : []);
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
// Immutable content segments let a revision reuse unchanged records. Publication
// still uses one compare-and-swap head, so staged writes never become a ledger.
export const CLOUD_DELTA_STORAGE_FORMAT = 'delta-v2';
export async function prepareDeltaRevision(state, { expectedRevision = 0, createdAt = new Date().toISOString(), batchId = crypto.randomUUID(), previous } = {}) {
    const text = canonicalStringify(state), stateBytes = utf8Bytes(text);
    if (stateBytes > 32 * 1024 * 1024)
        throw new Error('클라우드 원장이 32MiB 안전 한도를 초과합니다.');
    const root = JSON.parse(text), arrays = [], parts = [];
    const walk = (item, path) => { for (const [key, value] of Object.entries(item)) {
        const next = [...path, key];
        if (Array.isArray(value)) {
            arrays.push({ path: next, count: value.length });
            parts.push(...chunkRows(JSON.stringify(next), value));
            item[key] = null;
        }
        else if (isRecord(value))
            walk(value, next);
    } };
    walk(root, []);
    parts.unshift({ id: 'header', key: 'header', index: 0, value: { root, arrays } });
    const all = [];
    for (const part of parts) {
        const bytes = utf8Bytes(part);
        if (bytes > CLOUD_SEGMENT_LIMIT_BYTES)
            throw new Error('클라우드 단일 기록 안전 크기를 초과합니다.');
        all.push({ ...part, contentId: await sha256Hex(part), bytes });
    }
    const reusable = new Set(previous?.storageFormat === CLOUD_DELTA_STORAGE_FORMAT && previous.revision === expectedRevision ? previous.segments.map(item => item.contentId) : []);
    const revision = expectedRevision + 1, manifest = { storageFormat: CLOUD_DELTA_STORAGE_FORMAT, ...(previous?.revisionId ? { previousRevisionId: previous.revisionId } : {}), revision, revisionId: `r${String(revision).padStart(8, '0')}-${batchId}`, batchId, stateHash: await sha256Hex(text), stateBytes, createdAt, counts: stateCounts(state), segments: all.map(({ id, key, index, contentId, bytes }) => ({ id, key, index, contentId, bytes })) };
    if (utf8Bytes(manifest) > CLOUD_SEGMENT_LIMIT_BYTES)
        throw new Error('클라우드 목차 안전 크기를 초과합니다.');
    return { manifest, documents: all.filter(item => !reusable.has(item.contentId)) };
}
export async function assembleDeltaState(manifest, documents) {
    if (!isRecord(manifest) || manifest.storageFormat !== CLOUD_DELTA_STORAGE_FORMAT || !Array.isArray(manifest.segments) || !manifest.segments.every(isRecord) || !Array.isArray(documents) || !documents.every(isRecord))
        throw new Error('클라우드 분할 형식 오류');
    if (new Set(manifest.segments.map(item => item.contentId)).size !== manifest.segments.length || new Set(manifest.segments.map(item => item.id)).size !== manifest.segments.length)
        throw new Error('중복된 클라우드 조각 목차');
    const byHash = new Map(documents.map(item => [item.contentId, item])), parts = [];
    for (const item of manifest.segments) {
        if (typeof item.contentId !== 'string' || !/^[a-f0-9]{64}$/.test(item.contentId))
            throw new Error('클라우드 조각 주소 오류');
        const data = byHash.get(item.contentId);
        if (!data)
            throw new Error('클라우드 조각 누락');
        const part = { id: data.id, key: data.key, index: data.index, ...(data.rows !== undefined ? { rows: data.rows } : { value: data.value }) };
        if (await sha256Hex(part) !== item.contentId || part.id !== item.id || part.key !== item.key || part.index !== item.index)
            throw new Error('클라우드 조각 무결성 오류');
        parts.push(part);
    }
    const header = parts.filter(part => part.key === 'header');
    if (header.length !== 1 || !isRecord(header[0].value) || !isRecord(header[0].value.root) || !Array.isArray(header[0].value.arrays))
        throw new Error('클라우드 원장 목차 오류');
    const state = structuredClone(header[0].value.root), used = new Set(['header']);
    for (const spec of header[0].value.arrays) {
        if (!isRecord(spec) || !Array.isArray(spec.path) || !spec.path.every((key) => typeof key === 'string') || !Number.isInteger(spec.count))
            throw new Error('클라우드 배열 목차 오류');
        const path = spec.path, key = JSON.stringify(path), group = parts.filter(part => part.key === key).sort((a, b) => a.index - b.index);
        if (!group.length || group.some((part, index) => part.index !== index))
            throw new Error('클라우드 조각 순서 오류');
        const rows = group.flatMap(part => part.rows || []);
        if (rows.length !== spec.count || used.has(key))
            throw new Error('클라우드 기록 개수 오류');
        used.add(key);
        let target = state;
        for (const token of path.slice(0, -1)) {
            if (!isRecord(target[token]))
                throw new Error('클라우드 경로 오류');
            target = target[token];
        }
        target[path.at(-1)] = rows;
    }
    if (parts.some(part => !used.has(part.key)) || await sha256Hex(canonicalStringify(state)) !== manifest.stateHash)
        throw new Error('클라우드 전체 데이터 무결성 오류');
    return state;
}
