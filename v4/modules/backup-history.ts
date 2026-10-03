import type { AppState } from '../types/domain.js';
import { isRecord } from './utils.js';
export interface BackupStorage {get:(key:string)=>Promise<unknown>;set:(key:string,value:unknown)=>Promise<void>;remove:(key:string)=>Promise<void>;}
export interface AutoBackupEntry {id:string;key:string;createdAt:string;reason:string;hash:string;counts:ReturnType<typeof stateCounts>;}
function validEntries(value:unknown):AutoBackupEntry[] {
  if(!Array.isArray(value))return [];
  return value.flatMap((entry:unknown)=>{
    if(!isRecord(entry)||typeof entry.id!=='string'||typeof entry.key!=='string'||!entry.key.startsWith(AUTO_BACKUP_PREFIX)||typeof entry.createdAt!=='string'||typeof entry.reason!=='string'||typeof entry.hash!=='string'||!isRecord(entry.counts))return [];
    const {securities,trades,dividends,splits,cashAdjustments}=entry.counts;
    if(typeof securities!=='number'||typeof trades!=='number'||typeof dividends!=='number'||typeof splits!=='number'||typeof cashAdjustments!=='number')return [];
    return [{id:entry.id,key:entry.key,createdAt:entry.createdAt,reason:entry.reason,hash:entry.hash,counts:{securities,trades,dividends,splits,cashAdjustments}}];
  });
}
import { canonicalStringify, sha256Hex, stateCounts } from './cloud-contract.js';

export const AUTO_BACKUP_INDEX_KEY='autoBackupIndexV1';
export const AUTO_BACKUP_PREFIX='autoBackupV1:';
export const AUTO_BACKUP_KEEP=7;

export async function rotateAutoBackups(storage: BackupStorage,state: AppState,{now=new Date().toISOString(),reason='automatic'}={}) {
  const get=storage.get,set=storage.set,remove=storage.remove;
  const snapshot: unknown=JSON.parse(canonicalStringify(state)),hash=await sha256Hex(snapshot);
  const stored=await get(AUTO_BACKUP_INDEX_KEY),current=validEntries(stored);
  if(current[0]?.hash===hash)return {created:false,entries:current};
  const id=`${now.replace(/[^0-9]/g,'').slice(0,17)}-${hash.slice(0,12)}`,key=`${AUTO_BACKUP_PREFIX}${id}`;
  const entry={id,key,createdAt:now,reason,hash,counts:stateCounts(snapshot)};
  await set(key,{...entry,state:snapshot});
  const entries=[entry,...current.filter(item=>item?.hash!==hash)].slice(0,AUTO_BACKUP_KEEP),removed=current.filter(item=>!entries.some((kept)=>kept.key===item.key));
  await set(AUTO_BACKUP_INDEX_KEY,entries);
  for(const item of removed)await remove(item.key);
  return {created:true,entries,removed};
}

export async function listAutoBackups(storage: BackupStorage): Promise<AutoBackupEntry[]> { const rows=await storage.get(AUTO_BACKUP_INDEX_KEY);return validEntries(rows); }
export async function readAutoBackup(storage: BackupStorage,id: string): Promise<unknown> { const entry=(await listAutoBackups(storage)).find((item)=>item.id===id);return entry?await storage.get(entry.key):null; }
