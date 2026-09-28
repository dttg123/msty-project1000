const REQUIRED_ENV=['TOSS_CLIENT_ID','TOSS_CLIENT_SECRET','FIREBASE_PROJECT_ID','ALLOWED_FIREBASE_UID'];

export function validateEnvironment(env) {
  const missing=REQUIRED_ENV.filter(key=>!String(env[key]||'').trim());
  if(missing.length)throw new Error(`Missing server environment: ${missing.join(', ')}`);
  if(String(env.TOSS_CLIENT_ID).length>256||String(env.TOSS_CLIENT_SECRET).length>512)throw new Error('Invalid Toss credential length');
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(env.ALLOWED_FIREBASE_UID)))throw new Error('Invalid allowed Firebase UID');
}

export function parseAllowedOrigins(value='https://dttg123.github.io') {
  const origins=String(value).split(',').map(item=>item.trim()).filter(Boolean);
  if(!origins.length||origins.length>5)throw new Error('ALLOWED_ORIGIN must contain 1 to 5 origins');
  for(const origin of origins){
    const url=new URL(origin);
    if(url.protocol!=='https:'||url.origin!==origin)throw new Error('ALLOWED_ORIGIN must contain exact HTTPS origins');
  }
  return new Set(origins);
}

export function bearerToken(value) {
  const match=String(value||'').match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  return match?.[1]||'';
}

export function authorizeOwnerClaims(payload,env,nowSeconds=Math.floor(Date.now()/1000)) {
  if(!payload||typeof payload!=='object')return {ok:false,status:401,code:'invalid-login'};
  const valid=payload.aud===env.FIREBASE_PROJECT_ID&&payload.iss===`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`&&typeof payload.sub==='string'&&payload.sub.length>0&&payload.sub.length<=128&&Number(payload.exp)>nowSeconds&&Number(payload.iat)<=nowSeconds+300&&Number(payload.auth_time)<=nowSeconds+300;
  if(!valid)return {ok:false,status:401,code:'invalid-login'};
  if(payload.sub!==env.ALLOWED_FIREBASE_UID)return {ok:false,status:403,code:'owner-only'};
  return {ok:true,status:200,code:'ok',uid:payload.sub};
}

export function safeBridgeError(error) {
  const status=Number(error?.status)||502;
  if(status===429)return {status:429,code:'toss-rate-limit',message:'토스 조회 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'};
  if(status===404)return {status:404,code:'no-account',message:'조회 가능한 토스증권 계좌가 없습니다.'};
  if(status===401||status===403)return {status:502,code:'bridge-not-configured',message:'토스 중계 서버 인증 설정을 확인해야 합니다.'};
  return {status:502,code:'toss-unavailable',message:'토스 조회 서버가 일시적으로 응답하지 않습니다.'};
}

export function isAllowedReadPath(path) {
  const pathname=String(path||'').split('?')[0];
  return ['/api/v1/accounts','/api/v1/holdings','/api/v1/orders','/api/v1/prices'].includes(pathname);
}
