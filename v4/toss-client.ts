import { isRecord } from './modules/utils.js';
export interface TossSnapshotPayload extends Record<string, unknown> {accountScopeId:string;syncStatus:'complete'|'partial';syncCursor:Record<string, unknown>;capabilities:Record<string, unknown>;holdings:Record<string, unknown>[];prices:Record<string, unknown>[];orders:Record<string, unknown>[];dividends:Record<string, unknown>[];accountResults:Record<string, unknown>[];}
import { getGoogleIdToken } from './modules/cloud-api.js';
import { TOSS_BRIDGE_URL, TOSS_SYNC_FROM } from './runtime-config.js';

// Removed in the server-only migration. Never read or return the old value.
const LEGACY_DIRECT_CONFIG_KEY = 'dividend-os-toss-direct-v1';

function localStorageAvailable() {
  try { return typeof localStorage !== 'undefined'; } catch (_) { return false; }
}

export function removeLegacyTossBrowserCredentials() {
  if(!localStorageAvailable())return false;
  try {
    localStorage.removeItem(LEGACY_DIRECT_CONFIG_KEY);
    return true;
  } catch (_) { return false; }
}

export function isTossBridgeConfigured() {
  return /^https:\/\//i.test(String(TOSS_BRIDGE_URL||'').trim());
}

function validDate(value: unknown,fallback: string) {
  const text=String(value||''),match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return fallback;
  const date=new Date(`${text}T00:00:00Z`);return !Number.isNaN(date.getTime())&&date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()+1===Number(match[2])&&date.getUTCDate()===Number(match[3])?text:fallback;
}

function cleanSymbols(values: unknown[] =[]) {
  return [...new Set(values.map((value: unknown)=>String(value||'').trim().toUpperCase()).filter((value)=>/^[A-Z0-9.-]{1,16}$/.test(value)))].slice(0,200);
}

const object=isRecord;
export function validateTossSnapshotPayload(value: unknown): TossSnapshotPayload {
  if(!object(value))throw Object.assign(new Error('토스 중계 서버 응답 형식이 올바르지 않습니다.'),{code:'invalid-bridge-response'});
  const rows=(key:string,limit:number):Record<string, unknown>[]=>{
    const items=value[key];
    if(!Array.isArray(items)||items.length>limit||!items.every(isRecord))throw Object.assign(new Error('토스 중계 서버 응답 형식이 올바르지 않습니다.'),{code:'invalid-bridge-response'});
    return items;
  };
  rows('holdings',25000);rows('prices',200);rows('orders',50000);rows('dividends',25000);rows('accountResults',5);
  if(typeof value.accountScopeId!=='string'||!/^[a-f0-9]{24}$/.test(value.accountScopeId)||value.syncStatus!=='complete'&&value.syncStatus!=='partial'||!object(value.syncCursor)||!object(value.capabilities))throw Object.assign(new Error('토스 중계 서버 응답 형식이 올바르지 않습니다.'),{code:'invalid-bridge-response'});
  // Every required field is checked above. Preserve the validated object identity.
  return value as TossSnapshotPayload;
}

const TOSS_SNAPSHOT_MAX_BYTES=16*1024*1024;
const FORBIDDEN_IMPORT_KEYS=new Set(['__proto__','prototype','constructor','accesstoken','access_token','clientsecret','client_secret','authorization']);

function assertSafeImportTree(value: unknown,depth: number=0) {
  if(depth>12)throw Object.assign(new Error('토스 조회 파일의 중첩 구조가 너무 깊습니다.'),{code:'invalid-toss-file'});
  if(!value||typeof value!=='object')return;
  for(const key of Object.keys(value)){
    if(FORBIDDEN_IMPORT_KEYS.has(key.toLowerCase()))throw Object.assign(new Error('토스 조회 파일에 허용되지 않은 보안 항목이 있습니다.'),{code:'unsafe-toss-file'});
    assertSafeImportTree((value as Record<string, unknown>)[key],depth+1);
  }
}

export async function readTossSnapshotFile(file: Pick<File,'name'|'size'|'text'>): Promise<TossSnapshotPayload> {
  if(!file||typeof file.text!=='function')throw Object.assign(new Error('토스 JSON 파일을 선택해 주세요.'),{code:'invalid-toss-file'});
  const name=String(file.name||'');
  if(name&&!/\.json$/i.test(name))throw Object.assign(new Error('토스 조회 JSON 파일만 불러올 수 있습니다.'),{code:'invalid-toss-file'});
  if(Number(file.size)>TOSS_SNAPSHOT_MAX_BYTES)throw Object.assign(new Error('토스 조회 파일은 16MB 이하여야 합니다.'),{code:'toss-file-too-large'});
  const text=await file.text();
  if(new TextEncoder().encode(text).byteLength>TOSS_SNAPSHOT_MAX_BYTES)throw Object.assign(new Error('토스 조회 파일은 16MB 이하여야 합니다.'),{code:'toss-file-too-large'});
  let envelope: unknown;
  try{envelope=JSON.parse(text);}catch (_){throw Object.assign(new Error('토스 조회 JSON을 읽을 수 없습니다.'),{code:'invalid-toss-file'});}
  assertSafeImportTree(envelope);
  if(!object(envelope)||envelope.format!=='dividend-os-toss-snapshot'||envelope.version!==1||!object(envelope.snapshot))throw Object.assign(new Error('DividendOS 토스 조회 파일 형식 또는 버전이 올바르지 않습니다.'),{code:'invalid-toss-file'});
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(String(envelope.exportedAt||''))||Number.isNaN(Date.parse(String(envelope.exportedAt))))throw Object.assign(new Error('토스 조회 파일의 생성 시각이 올바르지 않습니다.'),{code:'invalid-toss-file'});
  return validateTossSnapshotPayload(envelope.snapshot);
}

function publicBridgeError(status: number,value: unknown ={}) {
  if(status===401)return Object.assign(new Error('Google 로그인이 만료되었습니다. 다시 로그인해 주세요.'),{code:'invalid-login'});
  if(status===403)return Object.assign(new Error('이 계정은 토스 연동 사용 권한이 없습니다.'),{code:'owner-only'});
  if(status===429)return Object.assign(new Error('조회 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.'),{code:'too-many-requests'});
  const messages: Record<string, string>={
    'no-account':'조회 가능한 토스증권 계좌가 없습니다.',
    'bridge-not-configured':'토스 중계 서버 인증 설정을 확인해야 합니다.',
    'toss-rate-limit':'토스 조회 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
    'toss-unavailable':'토스 조회 서버가 일시적으로 응답하지 않습니다.'
  };
  const body=isRecord(value)?value:{},code=typeof body.code==='string'&&Object.hasOwn(messages,body.code)?body.code:'toss-bridge';
  return Object.assign(new Error(messages[code]||'토스 조회 서버에서 안전하게 처리하지 못했습니다.'),{code,status});
}

export async function fetchTossSnapshot({from=TOSS_SYNC_FROM,symbols=[]}: {from?:string;symbols?:unknown[]} ={}): Promise<TossSnapshotPayload> {
  if(!isTossBridgeConfigured())throw Object.assign(new Error('토스 읽기 전용 중계 서버가 아직 설정되지 않았습니다.'),{code:'bridge-not-configured'});
  const idToken=await getGoogleIdToken();
  if(!idToken)throw Object.assign(new Error('Google 로그인 후 토스 계좌를 조회할 수 있습니다.'),{code:'login-required'});
  const base=String(TOSS_BRIDGE_URL).replace(/\/+$/,'');
  const url=new URL(`${base}/v1/toss/snapshot`);
  const today=new Date().toISOString().slice(0,10),checkedFrom=validDate(from,TOSS_SYNC_FROM);
  url.searchParams.set('from',checkedFrom>today?today:checkedFrom);
  const clean=cleanSymbols(symbols);if(clean.length)url.searchParams.set('symbols',clean.join(','));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(url,{headers:{Authorization:`Bearer ${idToken}`,Accept:'application/json'},signal:controller.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw publicBridgeError(response.status,body);
    return validateTossSnapshotPayload(body);
  }catch (error: unknown){
    if(isRecord(error)&&error.name==='AbortError'||error instanceof Error&&error.name==='AbortError')throw Object.assign(new Error('토스 조회 시간이 초과되었습니다.'),{code:'timeout'});
    if(error instanceof TypeError)throw Object.assign(new Error('토스 중계 서버에 연결하지 못했습니다.'),{code:'bridge-unavailable'});
    throw error;
  }finally{clearTimeout(timer);}
}
