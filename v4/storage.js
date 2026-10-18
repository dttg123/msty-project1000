import { canonicalStringify, sha256Hex, utf8Bytes } from './modules/cloud-contract.js';
const demoMode = typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === '1';
const DB_NAME = demoMode ? 'DividendOSDB_LedgerV2_QA' : 'DividendOSDB_LedgerV2';
const PREVIOUS_DB_NAME = demoMode ? 'DividendOSDB_QA' : 'DividendOSDB_V4';
const LEGACY_DB_NAME = 'MSTYProject1000DB_V3';
const STORE_NAME = 'kv', RECORDS = 'records';
const FALLBACK_PREFIX = demoMode ? 'dividend-os-qa:' : 'dividend-os-v4:';
const FALLBACK_MODE_KEY = `${FALLBACK_PREFIX}storage-backend`;
const FUNDING_STATE_KEY = 'stateFundingV1';
const MAX_STATE_BYTES = 32 * 1024 * 1024;
let database, previous;
let storageMode = 'indexeddb';
const memoryStore = new Map(), expectedRevisions = new Map();
let expectedFundingJSON;
const tombstones = new Set();
const rowCache = new Map();
const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const head = (value) => object(value) && value.format === 'ledger-v2';
const migrationKey = (key) => `migration-v2:${key}`;
const stale = () => new Error('다른 화면 또는 이전 버전에서 기록이 바뀌었습니다. 입력과 원본을 보존하고 최신 버전에서 다시 확인해 주세요.');
const request = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('저장소 읽기 실패')); });
const complete = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('저장 작업이 중단되었습니다.')); tx.onerror = () => { }; });
function transaction(stores, mode) { if (!database)
    throw new Error('저장소가 준비되지 않았습니다.'); return database.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
function openDatabase(name, create = false) {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open(name);
        let expired = false;
        const timer = setTimeout(() => { expired = true; reject(new Error('저장소 열기가 지연됩니다. 같은 앱의 이전 탭을 닫고 다시 시도해 주세요.')); }, 10000);
        r.onupgradeneeded = () => { if (!create) {
            r.transaction?.abort();
            return;
        } const db = r.result; if (!db.objectStoreNames.contains(STORE_NAME))
            db.createObjectStore(STORE_NAME); if (!db.objectStoreNames.contains(RECORDS)) {
            const records = db.createObjectStore(RECORDS, { keyPath: 'key' });
            records.createIndex('owner', 'owner');
            records.createIndex('period', ['owner', 'collection', 'ordinal']);
        } };
        r.onsuccess = () => { clearTimeout(timer); if (expired) {
            r.result.close();
            return;
        } resolve(r.result); };
        r.onerror = () => { clearTimeout(timer); if (!create && r.error?.name === 'AbortError')
            resolve(null);
        else
            reject(r.error || new Error('저장소 열기 실패')); };
        r.onblocked = () => { clearTimeout(timer); reject(new Error('이전 탭이 저장소를 사용 중입니다. 입력을 보관하고 이전 탭을 닫아 주세요.')); };
    });
}
function legacyUsesLocalStorage() { try {
    return localStorage.getItem(FALLBACK_MODE_KEY) === 'localstorage' || localStorage.getItem(`${FALLBACK_PREFIX}${FUNDING_STATE_KEY}`) !== null || localStorage.getItem(`${FALLBACK_PREFIX}state`) !== null;
}
catch {
    return false;
} }
async function oldValue(key, source) {
    let fallback = false;
    try {
        fallback = source === 'localstorage' || !source && legacyUsesLocalStorage();
    }
    catch { }
    if (fallback) {
        const raw = localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
        return raw === null ? undefined : JSON.parse(raw);
    }
    if (!previous)
        return undefined;
    const tx = previous.transaction(STORE_NAME, 'readonly'), done = complete(tx), value = await request(tx.objectStore(STORE_NAME).get(key));
    await done;
    return value;
}
function pack(owner, value) {
    const header = structuredClone(value), arrays = [], rows = [];
    const walk = (item, path) => { if (!object(item))
        return; for (const [key, child] of Object.entries(item)) {
        const next = [...path, key];
        if (Array.isArray(child)) {
            const collection = JSON.stringify(next), occurrences = new Map();
            arrays.push({ path: next, count: child.length });
            child.forEach((row, ordinal) => { const identity = object(row) && typeof row.id === 'string' ? row.id : `@${ordinal}`, occurrence = occurrences.get(identity) || 0; occurrences.set(identity, occurrence + 1); rows.push({ key: JSON.stringify([owner, collection, identity, occurrence]), owner, collection, ordinal, value: row }); });
            item[key] = null;
        }
        else
            walk(child, next);
    } };
    walk(header, []);
    return { header, arrays, rows };
}
function unpack(h, rows) {
    const value = structuredClone(h.header), groups = new Map();
    for (const row of rows) {
        const group = groups.get(row.collection) || [];
        group.push(row);
        groups.set(row.collection, group);
    }
    for (const spec of h.arrays) {
        const collection = JSON.stringify(spec.path), items = (groups.get(collection) || []).sort((a, b) => a.ordinal - b.ordinal);
        if (items.length !== spec.count || items.some((row, i) => row.ordinal !== i))
            throw new Error('저장 기록의 개수 또는 순서가 다릅니다. 원본을 보존하고 복구를 중단합니다.');
        let target = value;
        for (const key of spec.path.slice(0, -1)) {
            if (!object(target[key]))
                throw new Error('저장 기록 경로가 올바르지 않습니다.');
            target = target[key];
        }
        target[spec.path.at(-1)] = items.map(row => row.value);
        groups.delete(collection);
    }
    if (groups.size)
        throw new Error('연결되지 않은 저장 기록이 있습니다.');
    return value;
}
export const storageStatus = () => ({ mode: storageMode, durable: storageMode !== 'memory' });
export async function storageUsage() { const estimate = await navigator.storage?.estimate?.(); return { ...storageStatus(), usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted: await navigator.storage?.persisted?.() ?? false }; }
function fallback() { try {
    localStorage.setItem(`${FALLBACK_PREFIX}probe`, '1');
    localStorage.removeItem(`${FALLBACK_PREFIX}probe`);
    localStorage.setItem(FALLBACK_MODE_KEY, 'localstorage');
    storageMode = 'localstorage';
}
catch {
    storageMode = 'memory';
} }
export async function openStorage() {
    try {
        if (typeof indexedDB === 'undefined')
            throw new Error('IndexedDB unavailable');
        database = (await openDatabase(DB_NAME, true));
        database.onversionchange = () => { database?.close(); database = undefined; };
        previous = await openDatabase(PREVIOUS_DB_NAME) || undefined;
        if (previous && !previous.objectStoreNames.contains(STORE_NAME)) {
            previous.close();
            previous = undefined;
        }
        storageMode = 'indexeddb';
        return database;
    }
    catch (error) {
        let migrated = false;
        try {
            migrated = localStorage.getItem(`${FALLBACK_PREFIX}ledger-v2-active`) === '1';
        }
        catch { }
        if (migrated)
            throw error;
        fallback();
        return null;
    }
}
async function readIndexed(key) {
    const tx = transaction([STORE_NAME, RECORDS], 'readonly'), done = complete(tx);
    const [stored, rows, migration] = await Promise.all([request(tx.objectStore(STORE_NAME).get(key)), request(tx.objectStore(RECORDS).index('owner').getAll(key)), request(tx.objectStore(STORE_NAME).get(migrationKey(key)))]);
    await done;
    if (migration) {
        const original = await oldValue(key, migration.source);
        if (await sha256Hex(original === undefined ? 'undefined' : canonicalStringify(original)) !== migration.hash)
            throw stale();
    }
    if (object(stored) && stored.format === 'deleted-v2') {
        tombstones.add(key);
        expectedRevisions.set(key, 0);
        return undefined;
    }
    tombstones.delete(key);
    if (head(stored)) {
        const value = unpack(stored, rows);
        if (await sha256Hex(canonicalStringify(value)) !== stored.hash)
            throw new Error('저장 데이터 무결성 검증에 실패했습니다. 원본을 보존합니다.');
        rowCache.set(key, new Map(rows.map(row => [row.key, canonicalStringify(row)])));
        expectedRevisions.set(key, stored.revision);
        return value;
    }
    if (rows.length)
        throw new Error('원장 정보 없는 저장 기록이 있습니다. 자동 초기화를 중단합니다.');
    expectedRevisions.set(key, 0);
    return stored;
}
export async function storageGet(key) {
    if (storageMode === 'memory') {
        const value = memoryStore.get(key);
        if (key === FUNDING_STATE_KEY)
            expectedFundingJSON = JSON.stringify(value);
        return value;
    }
    if (storageMode === 'localstorage') {
        const raw = localStorage.getItem(`${FALLBACK_PREFIX}${key}`), value = raw === null ? undefined : JSON.parse(raw);
        if (key === FUNDING_STATE_KEY)
            expectedFundingJSON = JSON.stringify(value);
        return value;
    }
    let value = await readIndexed(key);
    if (value === undefined && !tombstones.has(key)) {
        const original = await oldValue(key);
        if (original !== undefined) {
            let source = 'indexeddb';
            try {
                if (legacyUsesLocalStorage())
                    source = 'localstorage';
            }
            catch { }
            const migration = { format: 'migration-v2', source, hash: await sha256Hex(canonicalStringify(original)) };
            await writeIndexed(key, original, migration);
            value = await readIndexed(key);
        }
    }
    return value;
}
async function writeIndexed(key, value, migration) {
    if (!migration) {
        const tx = transaction([STORE_NAME], 'readonly'), done = complete(tx), source = await request(tx.objectStore(STORE_NAME).get(migrationKey(key)));
        await done;
        if (source) {
            const original = await oldValue(key, source.source);
            if (await sha256Hex(original === undefined ? 'undefined' : canonicalStringify(original)) !== source.hash)
                throw stale();
        }
    }
    const frozen = structuredClone(value), raw = canonicalStringify(frozen);
    if (typeof raw !== 'string')
        throw new Error('저장할 데이터가 올바르지 않습니다.');
    const bytes = utf8Bytes(raw);
    if (bytes > MAX_STATE_BYTES)
        throw new Error('저장 원장 크기가 32MiB 안전 한도를 초과합니다. 기존 기록을 보존했습니다.');
    const packed = pack(key, frozen), hash = await sha256Hex(raw), oldRows = rowCache.get(key), nextRows = new Map(packed.rows.map(row => [row.key, canonicalStringify(row)])), expected = expectedRevisions.get(key) || 0;
    const tx = transaction([STORE_NAME, RECORDS], 'readwrite');
    let conflict, committedRevision = expected + 1;
    const done = new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(conflict || tx.error || new Error('저장 작업이 중단되었습니다.')); tx.onerror = () => { }; });
    const kv = tx.objectStore(STORE_NAME), records = tx.objectStore(RECORDS), get = kv.get(key);
    get.onsuccess = () => {
        try {
            const current = get.result;
            if (head(current) && current.hash === hash && !migration) {
                committedRevision = current.revision;
                return;
            }
            if (key === FUNDING_STATE_KEY && (head(current) ? current.revision : 0) !== expected)
                throw stale();
            if (head(current) && !oldRows) {
                const cursor = records.index('owner').openCursor(key);
                cursor.onsuccess = () => { const c = cursor.result; if (c) {
                    c.delete();
                    c.continue();
                } };
            }
            if (oldRows)
                for (const rowKey of oldRows.keys())
                    if (!nextRows.has(rowKey))
                        records.delete(rowKey);
            for (const row of packed.rows)
                if (!oldRows || oldRows.get(row.key) !== nextRows.get(row.key))
                    records.put(row);
            kv.put({ format: 'ledger-v2', revision: expected + 1, header: packed.header, arrays: packed.arrays, hash, bytes }, key);
            if (migration)
                kv.put(migration, migrationKey(key));
        }
        catch (error) {
            conflict = error;
            tx.abort();
        }
    };
    await done;
    rowCache.set(key, nextRows);
    expectedRevisions.set(key, committedRevision);
    if (key === FUNDING_STATE_KEY)
        try {
            localStorage.setItem(`${FALLBACK_PREFIX}ledger-v2-active`, '1');
        }
        catch { }
}
export async function storageSet(key, value) {
    const frozen = structuredClone(value);
    if (storageMode === 'indexeddb') {
        if (!rowCache.has(key))
            await readIndexed(key);
        return writeIndexed(key, frozen);
    }
    const write = () => { const current = storageMode === 'memory' ? memoryStore.get(key) : JSON.parse(localStorage.getItem(`${FALLBACK_PREFIX}${key}`) || 'null') ?? undefined; if (key === FUNDING_STATE_KEY && JSON.stringify(current) !== expectedFundingJSON)
        throw stale(); if (storageMode === 'memory')
        memoryStore.set(key, frozen);
    else
        localStorage.setItem(`${FALLBACK_PREFIX}${key}`, JSON.stringify(frozen)); if (key === FUNDING_STATE_KEY)
        expectedFundingJSON = JSON.stringify(frozen); };
    if (storageMode === 'localstorage' && key === FUNDING_STATE_KEY && typeof navigator !== 'undefined' && navigator.locks)
        return navigator.locks.request(`${DB_NAME}:${key}`, write);
    write();
}
export async function storageBatch(writes) {
    if (storageMode !== 'indexeddb')
        throw new Error('백업 묶음 저장에는 기기 데이터베이스가 필요합니다.');
    if (writes.some(item => item.key === FUNDING_STATE_KEY))
        throw new Error('원장 저장은 개별 검증을 사용해야 합니다.');
    const prepared = writes.map(item => ({ ...item, ...(!item.remove ? { value: structuredClone(item.value) } : {}) }));
    const tx = transaction([STORE_NAME, RECORDS], 'readwrite'), done = complete(tx), kv = tx.objectStore(STORE_NAME), records = tx.objectStore(RECORDS);
    try {
        for (const item of prepared) {
            const cursor = records.index('owner').openCursor(item.key);
            cursor.onsuccess = () => { const c = cursor.result; if (c) {
                c.delete();
                c.continue();
            } };
            if (item.remove) {
                kv.put({ format: 'deleted-v2' }, item.key);
                kv.delete(migrationKey(item.key));
            }
            else
                kv.put(item.value, item.key);
        }
    }
    catch (error) {
        tx.abort();
        await done.catch(() => { });
        throw error;
    }
    await done;
    for (const item of prepared) {
        rowCache.delete(item.key);
        expectedRevisions.delete(item.key);
        if (item.remove)
            tombstones.add(item.key);
        else
            tombstones.delete(item.key);
    }
}
export async function storageDelete(key) {
    if (storageMode === 'memory') {
        memoryStore.delete(key);
        return;
    }
    if (storageMode === 'localstorage') {
        localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);
        return;
    }
    const tx = transaction([STORE_NAME, RECORDS], 'readwrite'), done = complete(tx);
    tx.objectStore(STORE_NAME).put({ format: 'deleted-v2' }, key);
    tx.objectStore(STORE_NAME).delete(migrationKey(key));
    const cursor = tx.objectStore(RECORDS).index('owner').openCursor(key);
    cursor.onsuccess = () => { const c = cursor.result; if (c) {
        c.delete();
        c.continue();
    } };
    await done;
    rowCache.delete(key);
    tombstones.add(key);
    expectedRevisions.set(key, 0);
}
export async function readLegacyState(key = 'state') {
    if (typeof indexedDB === 'undefined')
        return null;
    try {
        if (typeof indexedDB.databases === 'function') {
            const databases = await indexedDB.databases();
            if (!databases.some((item) => item.name === LEGACY_DB_NAME))
                return null;
        }
    }
    catch (_) { }
    return new Promise(resolve => {
        // Omit the version so a harmless V3 schema upgrade remains readable.
        let request;
        try {
            request = indexedDB.open(LEGACY_DB_NAME);
        }
        catch (_) {
            resolve(null);
            return;
        }
        request.onupgradeneeded = () => { request.transaction?.abort(); resolve(null); };
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
            const legacy = request.result;
            if (!legacy.objectStoreNames.contains(STORE_NAME)) {
                legacy.close();
                resolve(null);
                return;
            }
            const tx = legacy.transaction(STORE_NAME, 'readonly');
            const get = tx.objectStore(STORE_NAME).get(key);
            get.onsuccess = () => { legacy.close(); resolve(get.result || null); };
            get.onerror = () => { legacy.close(); resolve(null); };
        };
    });
}
