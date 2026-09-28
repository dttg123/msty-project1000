declare const document: any;
declare const window: any;
declare const navigator: any;
declare const location: any;
declare const localStorage: any;
declare const sessionStorage: any;
const demoMode: any=typeof location!=='undefined'&&new URLSearchParams(location.search).get('demo')==='1';
const DB_NAME: any = demoMode?'DividendOSDB_QA':'DividendOSDB_V4';
const DB_VERSION: any = 1;
const STORE_NAME: any = 'kv';
let database: any;
let storageMode: any = 'indexeddb';
const memoryStore: any = new Map();
const FALLBACK_PREFIX: any = demoMode?'dividend-os-qa:':'dividend-os-v4:';
const LEGACY_DB_NAME: any = 'MSTYProject1000DB_V3';

export const storageStatus: any = () => ({mode:storageMode,durable:storageMode!=='memory'});

function enableFallback(): any {
  try {
    const probe: any=`${FALLBACK_PREFIX}probe`;
    localStorage.setItem(probe,'1');localStorage.removeItem(probe);storageMode='localstorage';
  } catch (_: any) { storageMode='memory'; }
}

export function openStorage(): any {
  return new Promise<any>((resolve, reject) => {
    if(typeof indexedDB==='undefined'){enableFallback();resolve(null);return;}
    const request: any = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db: any = request.result;
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

export function storageGet(key: any): any {
  if(storageMode==='memory')return Promise.resolve(memoryStore.get(key));
  if(storageMode==='localstorage'){
    try{const value: any=localStorage.getItem(`${FALLBACK_PREFIX}${key}`);return Promise.resolve(value?JSON.parse(value):undefined);}catch (error: any){return Promise.reject(error);}
  }
  return new Promise<any>((resolve, reject) => {
    const tx: any = database.transaction(STORE_NAME, 'readonly');
    const request: any = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function storageSet(key: any, value: any): any {
  if(storageMode==='memory'){memoryStore.set(key,value);return Promise.resolve();}
  if(storageMode==='localstorage'){
    try{localStorage.setItem(`${FALLBACK_PREFIX}${key}`,JSON.stringify(value));return Promise.resolve();}catch (error: any){return Promise.reject(error);}
  }
  return new Promise<void>((resolve, reject) => {
    const tx: any = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장 작업이 중단되었습니다.'));
  });
}

export function storageDelete(key: any): any {
  if(storageMode==='memory'){memoryStore.delete(key);return Promise.resolve();}
  if(storageMode==='localstorage'){
    try{localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);return Promise.resolve();}catch (error: any){return Promise.reject(error);}
  }
  return new Promise<void>((resolve, reject) => {
    const tx: any = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function readLegacyState(key: any = 'state'): Promise<any> {
  try {
    if (typeof indexedDB.databases === 'function') {
      const databases: any=await indexedDB.databases();
      if (!databases.some((item: any)=>item.name===LEGACY_DB_NAME)) return null;
    }
  } catch (_: any) {}
  return new Promise(resolve => {
    // Omit the version so a harmless V3 schema upgrade remains readable.
    const request: any = indexedDB.open(LEGACY_DB_NAME);
    request.onupgradeneeded = () => { request.transaction.abort(); resolve(null); };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const legacy: any = request.result;
      if (!legacy.objectStoreNames.contains(STORE_NAME)) {
        legacy.close();
        resolve(null);
        return;
      }
      const tx: any = legacy.transaction(STORE_NAME, 'readonly');
      const get: any = tx.objectStore(STORE_NAME).get(key);
      get.onsuccess = () => { legacy.close(); resolve(get.result || null); };
      get.onerror = () => { legacy.close(); resolve(null); };
    };
  });
}
