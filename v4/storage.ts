const demoMode=typeof location!=='undefined'&&new URLSearchParams(location.search).get('demo')==='1';
const DB_NAME = demoMode?'DividendOSDB_QA':'DividendOSDB_V4';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
let database: IDBDatabase | undefined;
let storageMode: 'indexeddb' | 'localstorage' | 'memory' = 'indexeddb';
const memoryStore = new Map<string, unknown>();
const FALLBACK_PREFIX = demoMode?'dividend-os-qa:':'dividend-os-v4:';
const FALLBACK_MODE_KEY = `${FALLBACK_PREFIX}storage-backend`;
const LEGACY_DB_NAME = 'MSTYProject1000DB_V3';

export const storageStatus = () => ({mode:storageMode,durable:storageMode!=='memory'});

function enableFallback(): void {
  try {
    const probe=`${FALLBACK_PREFIX}probe`;
    localStorage.setItem(probe,'1');localStorage.removeItem(probe);
    localStorage.setItem(FALLBACK_MODE_KEY,'localstorage');storageMode='localstorage';
  } catch (_) { storageMode='memory'; }
}

export function openStorage(): Promise<IDBDatabase | null> {
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    // Keep using the durable backend holding the last saved ledger.
    // Preserve the marker after deletion so an old IndexedDB ledger cannot reappear.
    try {
      if(localStorage.getItem(FALLBACK_MODE_KEY)==='localstorage'||localStorage.getItem(`${FALLBACK_PREFIX}state`)!==null){
        storageMode='localstorage';
        try{localStorage.setItem(FALLBACK_MODE_KEY,'localstorage');}catch(_){}
        resolve(null);return;
      }
    } catch (_) {}
    if(typeof indexedDB==='undefined'){enableFallback();resolve(null);return;}
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (_) { enableFallback(); resolve(null); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      database = request.result;
      resolve(database);
    };
    request.onerror = () => { console.warn('IndexedDB unavailable; using fallback storage.',request.error);enableFallback();resolve(null); };
    request.onblocked = () => { console.warn('IndexedDB blocked; using fallback storage.');enableFallback();resolve(null); };
  });
}

export function storageGet<T = unknown>(key: string): Promise<T | undefined> {
  if(storageMode==='memory')return Promise.resolve(memoryStore.get(key) as T | undefined);
  if(storageMode==='localstorage'){
    try{const value=localStorage.getItem(`${FALLBACK_PREFIX}${key}`);return Promise.resolve(value?JSON.parse(value):undefined);}catch (error){return Promise.reject(error);}
  }
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = database!.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function storageSet(key: string, value: unknown): Promise<void> {
  if(storageMode==='memory'){memoryStore.set(key,value);return Promise.resolve();}
  if(storageMode==='localstorage'){
    try{localStorage.setItem(`${FALLBACK_PREFIX}${key}`,JSON.stringify(value));return Promise.resolve();}catch (error){return Promise.reject(error);}
  }
  return new Promise<void>((resolve, reject) => {
    const tx = database!.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장 작업이 중단되었습니다.'));
  });
}

export function storageDelete(key: string): Promise<void> {
  if(storageMode==='memory'){memoryStore.delete(key);return Promise.resolve();}
  if(storageMode==='localstorage'){
    try{localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);return Promise.resolve();}catch (error){return Promise.reject(error);}
  }
  return new Promise<void>((resolve, reject) => {
    const tx = database!.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('삭제 작업이 중단되었습니다.'));
  });
}

export async function readLegacyState(key: string = 'state'): Promise<unknown> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    if (typeof indexedDB.databases === 'function') {
      const databases=await indexedDB.databases();
      if (!databases.some((item)=>item.name===LEGACY_DB_NAME)) return null;
    }
  } catch (_) {}
  return new Promise(resolve => {
    // Omit the version so a harmless V3 schema upgrade remains readable.
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(LEGACY_DB_NAME); }
    catch (_) { resolve(null); return; }
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
