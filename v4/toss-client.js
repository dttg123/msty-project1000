import { getGoogleIdToken } from './auth.js';
import { TOSS_BRIDGE_URL, TOSS_SYNC_FROM } from './runtime-config.js';

export function isTossBridgeConfigured() {
  return /^https:\/\//i.test(String(TOSS_BRIDGE_URL||'').trim());
}

export async function fetchTossSnapshot({from=TOSS_SYNC_FROM}={}) {
  if(!isTossBridgeConfigured())throw Object.assign(new Error('토스 중계 서버가 아직 설정되지 않았습니다.'),{code:'not-configured'});
  const idToken=await getGoogleIdToken();
  if(!idToken)throw Object.assign(new Error('Google 로그인 후 토스 계좌를 조회할 수 있습니다.'),{code:'login-required'});
  const base=String(TOSS_BRIDGE_URL).replace(/\/+$/,'');
  const url=new URL(`${base}/v1/toss/snapshot`);
  if(from)url.searchParams.set('from',from);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(url,{headers:{Authorization:`Bearer ${idToken}`,Accept:'application/json'},signal:controller.signal,cache:'no-store'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(body?.message||`토스 조회 실패 (${response.status})`),{code:body?.code||`http-${response.status}`});
    return body;
  }catch(error){
    if(error?.name==='AbortError')throw Object.assign(new Error('토스 조회 시간이 초과되었습니다.'),{code:'timeout'});
    throw error;
  }finally{clearTimeout(timer);}
}
