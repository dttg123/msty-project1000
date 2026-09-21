import { getGoogleIdToken } from './modules/cloud-api.js';
import { TOSS_BRIDGE_URL, TOSS_SYNC_FROM } from './runtime-config.js';

const API_BASE = 'https://openapi.tossinvest.com';
const LOCAL_CONFIG_KEY = 'dividend-os-toss-direct-v1';
const TOSS_SETTINGS_URL = 'https://www.tossinvest.com/';
let directToken = { value:'', expiresAt:0, clientId:'' };

function localStorageAvailable() {
  try { return typeof localStorage !== 'undefined'; } catch (_) { return false; }
}

export function getTossLocalConfig() {
  if(!localStorageAvailable())return {clientId:'',clientSecret:'',hasSecret:false};
  try {
    const value=JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEY)||'{}');
    const clientId=String(value.clientId||'').trim(),clientSecret=String(value.clientSecret||'').trim();
    return {clientId,clientSecret,hasSecret:!!clientSecret};
  } catch (_) { return {clientId:'',clientSecret:'',hasSecret:false}; }
}

export function saveTossLocalConfig({clientId,clientSecret}={}) {
  if(!localStorageAvailable())throw new Error('이 브라우저에서는 기기 저장소를 사용할 수 없습니다.');
  const previous=getTossLocalConfig();
  const nextId=String(clientId||'').trim(),nextSecret=String(clientSecret||'').trim()||previous.clientSecret;
  if(!nextId||!nextSecret)throw new Error('Client ID와 Client Secret을 모두 입력해 주세요.');
  if(nextId.length>256||nextSecret.length>512)throw new Error('토스 API 키 형식을 확인해 주세요.');
  localStorage.setItem(LOCAL_CONFIG_KEY,JSON.stringify({clientId:nextId,clientSecret:nextSecret,updatedAt:new Date().toISOString()}));
  directToken={value:'',expiresAt:0,clientId:''};
  return {clientId:nextId,clientSecret:nextSecret,hasSecret:true};
}

export function clearTossLocalConfig() {
  if(localStorageAvailable())localStorage.removeItem(LOCAL_CONFIG_KEY);
  directToken={value:'',expiresAt:0,clientId:''};
}

export function getTossSettingsUrl() { return TOSS_SETTINGS_URL; }
export function isTossDirectConfigured() { const value=getTossLocalConfig();return !!(value.clientId&&value.clientSecret); }
export function isTossBridgeConfigured() { return isTossDirectConfigured()||/^https:\/\//i.test(String(TOSS_BRIDGE_URL||'').trim()); }
export function getTossConnectionMode() { return isTossDirectConfigured()?'direct':(/^https:\/\//i.test(String(TOSS_BRIDGE_URL||'').trim())?'bridge':'none'); }

function validIPv4(value) {
  const parts=String(value||'').trim().split('.');
  return parts.length===4&&parts.every(part=>/^\d{1,3}$/.test(part)&&Number(part)>=0&&Number(part)<=255);
}

export async function fetchCurrentPublicIp() {
  const sources=[
    async()=>{const response=await fetch('https://api.ipify.org?format=json',{cache:'no-store'});if(!response.ok)throw new Error();return (await response.json()).ip;},
    async()=>{const response=await fetch('https://ipv4.icanhazip.com/',{cache:'no-store'});if(!response.ok)throw new Error();return (await response.text()).trim();}
  ];
  for(const source of sources){try{const ip=await source();if(validIPv4(ip))return ip;}catch(_){}}
  throw new Error('현재 공인 IP를 확인하지 못했습니다. 모바일 데이터가 켜져 있는지 확인해 주세요.');
}

function directFetchError(error) {
  if(error?.name==='AbortError'||error?.name==='TimeoutError')return Object.assign(new Error('토스 응답 시간이 초과되었습니다.'),{code:'timeout'});
  if(error instanceof TypeError)return Object.assign(new Error('토스가 웹브라우저 직접 연결을 허용하지 않았습니다. APK 또는 중계 서버가 필요합니다.'),{code:'browser-blocked'});
  return error;
}

async function issueDirectToken(force=false) {
  const config=getTossLocalConfig();
  if(!config.clientId||!config.clientSecret)throw Object.assign(new Error('이 기기에 토스 Client ID와 Secret을 먼저 저장해 주세요.'),{code:'credentials-required'});
  if(!force&&directToken.value&&directToken.clientId===config.clientId&&Date.now()<directToken.expiresAt-60000)return directToken.value;
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:config.clientId,client_secret:config.clientSecret});
  try{
    const response=await fetch(`${API_BASE}/oauth2/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,cache:'no-store',signal:AbortSignal.timeout(15000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=response.status===403?'현재 휴대폰 IP가 토스 허용 IP에 등록되지 않았습니다.':response.status===401?'Client ID 또는 Client Secret이 맞지 않습니다.':data.error_description||`토스 인증 실패 (${response.status})`;
      throw Object.assign(new Error(message),{code:response.status===403?'ip-not-allowed':data.error||`http-${response.status}`,status:response.status});
    }
    if(!data.access_token)throw Object.assign(new Error('토스가 액세스 토큰을 반환하지 않았습니다.'),{code:'invalid-token-response'});
    directToken={value:data.access_token,expiresAt:Date.now()+Number(data.expires_in||0)*1000,clientId:config.clientId};
    return directToken.value;
  }catch(error){throw directFetchError(error);}
}

async function directGet(path,accountSeq) {
  const token=await issueDirectToken();
  const headers={Authorization:`Bearer ${token}`,Accept:'application/json'};
  if(accountSeq!==undefined&&accountSeq!==null)headers['X-Tossinvest-Account']=String(accountSeq);
  try{
    const response=await fetch(`${API_BASE}${path}`,{headers,cache:'no-store',signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===401)directToken={value:'',expiresAt:0,clientId:''};
      throw Object.assign(new Error(data?.error?.message||data?.message||`토스 조회 실패 (${response.status})`),{status:response.status,code:data?.error?.code||`http-${response.status}`});
    }
    return data.result;
  }catch(error){throw directFetchError(error);}
}

export async function testTossDirectConnection() {
  await issueDirectToken(true);
  const accounts=await directGet('/api/v1/accounts');
  if(!Array.isArray(accounts))throw new Error('토스 계좌 응답 형식을 확인할 수 없습니다.');
  return {ok:true,accountCount:accounts.length};
}

function validDate(value,fallback) {
  const text=String(value||''),match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return fallback;
  const date=new Date(`${text}T00:00:00Z`);return !Number.isNaN(date.getTime())&&date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()+1===Number(match[2])&&date.getUTCDate()===Number(match[3])?text:fallback;
}
function cleanSymbols(values=[]) { return [...new Set(values.map(value=>String(value||'').trim().toUpperCase()).filter(value=>/^[A-Z0-9.-]{1,16}$/.test(value)))].slice(0,200); }
function maskAccount(value){const text=String(value||'');return text?`토스증권 •${text.slice(-4)}`:'토스증권 계좌';}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function directClosedOrders(accountSeq,from,to) {
  const orders=[];let cursor='',truncated=false;
  for(let page=0;page<100;page++){
    const query=new URLSearchParams({status:'CLOSED',from,to,limit:'100'});if(cursor)query.set('cursor',cursor);
    const result=await directGet(`/api/v1/orders?${query}`,accountSeq);
    orders.push(...(Array.isArray(result?.orders)?result.orders:[]));
    if(!result?.hasNext||!result?.nextCursor)break;
    if(page===99){truncated=true;break;}
    cursor=result.nextCursor;await wait(220);
  }
  return {orders,truncated};
}

async function fetchDirectSnapshot({from=TOSS_SYNC_FROM,symbols=[]}={}) {
  const today=new Date().toISOString().slice(0,10),checkedFrom=validDate(from,TOSS_SYNC_FROM),safeFrom=checkedFrom>today?today:checkedFrom;
  const accounts=await directGet('/api/v1/accounts');
  const list=Array.isArray(accounts)?accounts:[],account=list.find(row=>row.accountType==='BROKERAGE')||list[0];
  if(!account)throw Object.assign(new Error('조회 가능한 토스증권 계좌가 없습니다.'),{code:'no-account'});
  const clean=cleanSymbols(symbols);
  const [holdingResult,orderResult,priceResult]=await Promise.all([
    directGet('/api/v1/holdings',account.accountSeq),
    directClosedOrders(account.accountSeq,safeFrom,today),
    clean.length?directGet(`/api/v1/prices?${new URLSearchParams({symbols:clean.join(',')})}`):Promise.resolve([])
  ]);
  return {accountLabel:maskAccount(account.accountNo),fetchedAt:new Date().toISOString(),from:safeFrom,holdings:Array.isArray(holdingResult?.items)?holdingResult.items:[],prices:Array.isArray(priceResult)?priceResult:[],orders:orderResult.orders,dividends:[],historyTruncated:orderResult.truncated};
}

async function fetchBridgeSnapshot({from=TOSS_SYNC_FROM,symbols=[]}={}) {
  const idToken=await getGoogleIdToken();
  if(!idToken)throw Object.assign(new Error('Google 로그인 후 토스 계좌를 조회할 수 있습니다.'),{code:'login-required'});
  const base=String(TOSS_BRIDGE_URL).replace(/\/+$/,'');
  const url=new URL(`${base}/v1/toss/snapshot`);
  if(from)url.searchParams.set('from',from);
  const clean=cleanSymbols(symbols);if(clean.length)url.searchParams.set('symbols',clean.join(','));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(url,{headers:{Authorization:`Bearer ${idToken}`,Accept:'application/json'},signal:controller.signal,cache:'no-store'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(body?.message||`토스 조회 실패 (${response.status})`),{code:body?.code||`http-${response.status}`});
    return body;
  }catch(error){if(error?.name==='AbortError')throw Object.assign(new Error('토스 조회 시간이 초과되었습니다.'),{code:'timeout'});throw error;}finally{clearTimeout(timer);}
}

export async function fetchTossSnapshot(options={}) {
  if(isTossDirectConfigured())return fetchDirectSnapshot(options);
  if(/^https:\/\//i.test(String(TOSS_BRIDGE_URL||'').trim()))return fetchBridgeSnapshot(options);
  throw Object.assign(new Error('토스 연결 정보를 먼저 설정해 주세요.'),{code:'not-configured'});
}
