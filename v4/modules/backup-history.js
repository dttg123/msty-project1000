import { isRecord } from './utils.js';
function validEntries(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.key !== 'string' || !entry.key.startsWith(AUTO_BACKUP_PREFIX) || typeof entry.createdAt !== 'string' || typeof entry.reason !== 'string' || typeof entry.hash !== 'string' || !isRecord(entry.counts))
            return [];
        const { securities, trades, dividends, splits, cashAdjustments } = entry.counts;
        if (typeof securities !== 'number' || typeof trades !== 'number' || typeof dividends !== 'number' || typeof splits !== 'number' || typeof cashAdjustments !== 'number')
            return [];
        return [{ id: entry.id, key: entry.key, createdAt: entry.createdAt, reason: entry.reason, hash: entry.hash, counts: { securities, trades, dividends, splits, cashAdjustments } }];
    });
}
import { canonicalStringify, sha256Hex, stateCounts, utf8Bytes } from './cloud-contract.js';
export const AUTO_BACKUP_INDEX_KEY = 'autoBackupIndexV1';
export const AUTO_BACKUP_PREFIX = 'autoBackupV1:';
export const AUTO_BACKUP_KEEP = 7;
export const AUTO_BACKUP_BUDGET = 16 * 1024 * 1024;
const MAX_RAW = 32 * 1024 * 1024;
async function compress(raw) { if (new TextEncoder().encode(raw).length > MAX_RAW)
    throw new Error('백업 원장이 안전 한도를 초과합니다.'); if (typeof CompressionStream === 'undefined')
    return { encoding: 'plain-json-v1', data: raw, bytes: new TextEncoder().encode(raw).length }; const data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); let binary = ''; for (let i = 0; i < data.length; i += 16384)
    binary += String.fromCharCode(...data.subarray(i, i + 16384)); return { encoding: 'gzip-base64-v1', data: btoa(binary), bytes: 4 * Math.ceil(data.length / 3) }; }
async function decompress(value) { if (typeof value.data !== 'string')
    throw new Error('백업 내용이 없습니다.'); if (value.encoding === 'plain-json-v1') {
    if (new TextEncoder().encode(value.data).length > MAX_RAW)
        throw new Error('백업 한도 초과');
    return JSON.parse(value.data);
} if (value.encoding !== 'gzip-base64-v1')
    throw new Error('지원하지 않는 백업 형식입니다.'); const binary = atob(value.data), bytes = Uint8Array.from(binary, c => c.charCodeAt(0)), reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(); const chunks = []; let size = 0; for (;;) {
    const { value, done } = await reader.read();
    if (done)
        break;
    size += value.length;
    if (size > MAX_RAW) {
        await reader.cancel();
        throw new Error('백업 압축 해제 한도 초과');
    }
    chunks.push(value);
} return JSON.parse(await new Blob(chunks.map(chunk => new Uint8Array(chunk).buffer)).text()); }
export async function rotateAutoBackups(storage, state, { now = new Date().toISOString(), reason = 'automatic' } = {}) {
    const get = storage.get, set = storage.set, remove = storage.remove;
    const snapshot = JSON.parse(canonicalStringify(state)), hash = await sha256Hex(snapshot);
    const stored = await get(AUTO_BACKUP_INDEX_KEY), current = validEntries(stored);
    if (current[0]?.hash === hash)
        return { created: false, entries: current };
    const id = `${now.replace(/[^0-9]/g, '').slice(0, 17)}-${hash.slice(0, 12)}`, key = `${AUTO_BACKUP_PREFIX}${id}`;
    const entry = { id, key, createdAt: now, reason, hash, counts: stateCounts(snapshot) };
    const encoded = await compress(canonicalStringify(snapshot)), payload = { ...entry, ...encoded };
    payload.bytes = utf8Bytes(payload);
    payload.bytes = utf8Bytes(payload);
    if (payload.bytes > AUTO_BACKUP_BUDGET)
        throw new Error('백업 용량 한도를 초과합니다. 기존 백업은 유지했습니다.');
    const candidates = [entry, ...current.filter(item => item.hash !== hash)].slice(0, AUTO_BACKUP_KEEP), entries = [];
    let total = payload.bytes;
    entries.push(entry);
    for (const candidate of candidates.slice(1)) {
        const prior = await get(candidate.key);
        const bytes = prior === undefined ? 0 : utf8Bytes(prior);
        if (total + bytes > AUTO_BACKUP_BUDGET)
            continue;
        total += bytes;
        entries.push(candidate);
    }
    const removed = current.filter(item => !entries.some(kept => kept.key === item.key));
    if (storage.batch)
        await storage.batch([{ key, value: payload }, { key: AUTO_BACKUP_INDEX_KEY, value: entries }, ...removed.map(item => ({ key: item.key, remove: true }))]);
    else {
        await set(key, payload);
        await set(AUTO_BACKUP_INDEX_KEY, entries);
        for (const item of removed)
            await remove(item.key);
    }
    return { created: true, entries, removed };
}
export async function listAutoBackups(storage) { const rows = await storage.get(AUTO_BACKUP_INDEX_KEY); return validEntries(rows); }
export async function readAutoBackup(storage, id) { const entry = (await listAutoBackups(storage)).find((item) => item.id === id); if (!entry)
    return null; const stored = await storage.get(entry.key); if (!isRecord(stored))
    throw new Error('백업 파일이 없습니다.'); const state = stored.state ?? await decompress(stored); if (await sha256Hex(canonicalStringify(state)) !== entry.hash)
    throw new Error('백업 무결성 검증에 실패했습니다.'); return { ...entry, state }; }
