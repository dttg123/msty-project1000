const DB_NAME = 'DividendOSDB_V4';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
let database;
const LEGACY_DB_NAME = 'MSTYProject1000DB_V3';

export function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      database = request.result;
      resolve(database);
    };
    request.onerror = () => reject(request.error);
  });
}

export function storageGet(key) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function storageSet(key, value) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function storageDelete(key) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function readLegacyState(key = 'state') {
  return new Promise(resolve => {
    const request = indexedDB.open(LEGACY_DB_NAME, 1);
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
