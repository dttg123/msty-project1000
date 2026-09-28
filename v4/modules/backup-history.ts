import { canonicalStringify, sha256Hex, stateCounts } from './cloud-contract.js';

export const AUTO_BACKUP_INDEX_KEY: any='autoBackupIndexV1';
export const AUTO_BACKUP_PREFIX: any='autoBackupV1:';
export const AUTO_BACKUP_KEEP: any=7;

export async function rotateAutoBackups(storage: any,state: any,{now=new Date().toISOString(),reason='automatic'}={}) {
  const get: any=storage.get,set=storage.set,remove=storage.remove;
  const snapshot: any=JSON.parse(canonicalStringify(state)),hash=await sha256Hex(snapshot);
  const stored: any=await get(AUTO_BACKUP_INDEX_KEY),current=Array.isArray(stored)?stored:[];
  if(current[0]?.hash===hash)return {created:false,entries:current};
  const id: any=`${now.replace(/[^0-9]/g,'').slice(0,17)}-${hash.slice(0,12)}`,key=`${AUTO_BACKUP_PREFIX}${id}`;
  const entry: any={id,key,createdAt:now,reason,hash,counts:stateCounts(snapshot)};
  await set(key,{...entry,state:snapshot});
  const entries: any=[entry,...current.filter(item=>item?.hash!==hash)].slice(0,AUTO_BACKUP_KEEP),removed=current.filter(item=>!entries.some((kept: any)=>kept.key===item.key));
  await set(AUTO_BACKUP_INDEX_KEY,entries);
  for(const item of removed)await remove(item.key);
  return {created:true,entries,removed};
}

export async function listAutoBackups(storage: any): Promise<any> { const rows: any=await storage.get(AUTO_BACKUP_INDEX_KEY);return Array.isArray(rows)?rows:[]; }
export async function readAutoBackup(storage: any,id: any): Promise<any> { const entry: any=(await listAutoBackups(storage)).find((item: any)=>item.id===id);return entry?await storage.get(entry.key):null; }
