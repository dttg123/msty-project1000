import type { AppState } from '../types/domain.js';
import { isRecord } from './utils.js';
interface StateSegment {id:string;key:string;index:number;rows?:unknown[];value?:unknown;batchId?:string;}
interface PreparedSegment extends StateSegment {bytes:number;hash:string;batchId:string;}
export interface RevisionOptions {expectedRevision?:number;createdAt?:string;batchId?:string;}
const encoder = new TextEncoder();
export type CloudSyncChoice='local'|'cloud'|'review';
export function syncSignature(value:unknown):string {
  const state=value && typeof value==='object'?value as Record<string,unknown>:{};
  return canonicalStringify(['projects','trades','dividends','splits','cashAdjustments','settings'].map(key=>state[key]));
}
export function chooseCloudSync(local:unknown,remote:unknown,baseSignature:string|null):CloudSyncChoice {
  const localSignature=syncSignature(local),remoteSignature=syncSignature(remote);
  if(localSignature===remoteSignature)return 'local';
  if(baseSignature===remoteSignature)return 'local';
  if(baseSignature===localSignature)return 'cloud';
  return 'review';
}

export const CLOUD_STORAGE_FORMAT = 'split-v1';
export const CLOUD_SEGMENT_LIMIT_BYTES = 700_000;

export function canonicalStringify(value: unknown): string {
  const seen=new WeakSet<object>();
  const normalize=(input: unknown): unknown=>{
    if(input===null||typeof input!=='object')return input;
    if(seen.has(input))throw new TypeError('순환 데이터는 저장할 수 없습니다.');
    seen.add(input);
    const output=Array.isArray(input)?input.map(normalize):Object.fromEntries(Object.keys(input).sort().filter(key=>(input as Record<string, unknown>)[key]!==undefined).map(key=>[key,normalize((input as Record<string, unknown>)[key])]));
    seen.delete(input);return output;
  };
  return JSON.stringify(normalize(value));
}

export function utf8Bytes(value: unknown): number { return encoder.encode(typeof value==='string'?value:canonicalStringify(value)).byteLength; }

export async function sha256Hex(value: unknown): Promise<string> {
  const bytes=encoder.encode(typeof value==='string'?value:canonicalStringify(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function stateCounts(value: unknown ={}) {
  const state=isRecord(value)?value:{};
  return {
    securities:Array.isArray(state.projects)?state.projects.length:0,
    trades:Array.isArray(state.trades)?state.trades.length:0,
    dividends:Array.isArray(state.dividends)?state.dividends.length:0,
    splits:Array.isArray(state.splits)?state.splits.length:0,
    cashAdjustments:Array.isArray(state.cashAdjustments)?state.cashAdjustments.length:0
  };
}

function chunkRows(key: string,rows: unknown[],limit =CLOUD_SEGMENT_LIMIT_BYTES): StateSegment[] {
  const safeLimit=Math.max(1024,limit-1024);
  if(!Array.isArray(rows)||!rows.length)return [{id:`${key}-0000`,key,index:0,rows:[]}];
  const chunks: unknown[][]=[];let current: unknown[]=[],currentBytes=utf8Bytes({key,rows:[]});
  for(const row of rows){
    const rowBytes=utf8Bytes(row)+1;
    if(current.length&&currentBytes+rowBytes>safeLimit){chunks.push(current);current=[];currentBytes=utf8Bytes({key,rows:[]});}
    if(currentBytes+rowBytes>safeLimit)throw new Error(`${key} 단일 기록이 클라우드 문서 안전 크기를 초과합니다.`);
    current.push(row);currentBytes+=rowBytes;
  }
  chunks.push(current);
  return chunks.map((chunk,index)=>({id:`${key}-${String(index).padStart(4,'0')}`,key,index,rows:chunk}));
}

export function splitStateDocuments(state: AppState,limit =CLOUD_SEGMENT_LIMIT_BYTES): StateSegment[] {
  const fixed: StateSegment[]=[
    {id:'profile-0000',key:'profile',index:0,value:{version:state.version,...(state.schemaVersion!==undefined?{schemaVersion:state.schemaVersion}:{}),settings:state.settings||{},meta:state.meta||{}}},
    {id:'securities-0000',key:'securities',index:0,rows:Array.isArray(state.projects)?state.projects:[]},
    {id:'integrations-0000',key:'integrations',index:0,value:state.integrations||{}}
  ];
  for(const document of fixed)if(utf8Bytes(document)>limit)throw new Error(`${document.key} 데이터가 클라우드 문서 안전 크기를 초과합니다.`);
  return [...fixed,...chunkRows('trades',state.trades,limit),...chunkRows('dividends',state.dividends,limit),...chunkRows('splits',state.splits,limit),...chunkRows('cashAdjustments',state.cashAdjustments,limit)];
}

export async function prepareCloudRevision(state: AppState,{expectedRevision=0,createdAt=new Date().toISOString(),batchId=crypto.randomUUID()}: RevisionOptions={}) {
  const stateText=canonicalStringify(state),documents=splitStateDocuments(state);
  const prepared: PreparedSegment[]=[];
  for(const document of documents){
    const payload={...document,batchId};
    prepared.push({...payload,bytes:utf8Bytes(payload),hash:await sha256Hex(payload)});
  }
  const revision=Math.max(0,Number(expectedRevision)||0)+1;
  const manifest={storageFormat:CLOUD_STORAGE_FORMAT,schemaVersion:Number(state.schemaVersion??state.version)||4,revision,expectedRevision:Math.max(0,Number(expectedRevision)||0),revisionId:`r${String(revision).padStart(8,'0')}-${batchId}`,batchId,createdAt,counts:stateCounts(state),stateBytes:utf8Bytes(stateText),stateHash:await sha256Hex(stateText),segments:prepared.map(({id,key,index,bytes,hash,rows,value})=>({id,key,index,bytes,hash,rowCount:Array.isArray(rows)?rows.length:(value===undefined?0:1)}))};
  return {manifest,documents:prepared,stateText};
}

export async function assembleCloudState(manifest: unknown,documents: unknown): Promise<unknown> {
  if(!isRecord(manifest)||manifest.storageFormat!==CLOUD_STORAGE_FORMAT)throw new Error('지원하지 않는 클라우드 저장 형식입니다.');
  if(!Array.isArray(manifest.segments)||!manifest.segments.every(isRecord)||!Array.isArray(documents)||!documents.every(isRecord))throw new Error('클라우드 조각 형식이 올바르지 않습니다.');
  const segments: Record<string, unknown>[]=manifest.segments,byId=new Map(documents.map(document=>[document.id,document]));
  for(const expected of segments){
    const actual=byId.get(expected.id);if(!actual)throw new Error(`클라우드 조각이 누락되었습니다: ${expected.id}`);
    const payload={id:actual.id,key:actual.key,index:actual.index,...(actual.rows!==undefined?{rows:actual.rows}:{value:actual.value}),batchId:actual.batchId};
    if(await sha256Hex(payload)!==expected.hash)throw new Error(`클라우드 조각 무결성 검증에 실패했습니다: ${expected.id}`);
  }
  const ordered=(key: string)=>segments.filter(segment=>segment.key===key).sort((a,b)=>Number(a.index)-Number(b.index)).map(segment=>byId.get(segment.id));
  const profileValue=ordered('profile')[0]?.value,profile=isRecord(profileValue)?profileValue:{},securities=ordered('securities')[0]?.rows||[],integrations=ordered('integrations')[0]?.value||{};
  const rows=(key: string)=>ordered(key).flatMap(document=>Array.isArray(document?.rows)?document.rows:[]);
  const state={version:profile.version,...(profile.schemaVersion!==undefined?{schemaVersion:profile.schemaVersion}:{}),settings:profile.settings||{},projects:securities,trades:rows('trades'),dividends:rows('dividends'),splits:rows('splits'),cashAdjustments:rows('cashAdjustments'),integrations,meta:profile.meta||{}};
  if(await sha256Hex(canonicalStringify(state))!==manifest.stateHash)throw new Error('클라우드 전체 데이터 무결성 검증에 실패했습니다.');
  return state;
}

export class CloudConflictError extends Error {
  code: string;
  expectedRevision: number;
  actualRevision: number;
  constructor(expectedRevision: number,actualRevision: number){super(`클라우드 revision 충돌: 기기 ${expectedRevision}, 최신 ${actualRevision}`);this.name='CloudConflictError';this.code='cloud-conflict';this.expectedRevision=expectedRevision;this.actualRevision=actualRevision;}
}

export function assertCloudRevision(expectedRevision: unknown,actualRevision: unknown) {
  const expected=Math.max(0,Number(expectedRevision)||0),actual=Math.max(0,Number(actualRevision)||0);
  if(expected!==actual)throw new CloudConflictError(expected,actual);
  return true;
}
