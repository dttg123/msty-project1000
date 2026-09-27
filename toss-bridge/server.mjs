import express from 'express';
import { createPublicKey, verify } from 'node:crypto';
import { authorizeOwnerClaims, bearerToken, isAllowedReadPath, parseAllowedOrigins, safeBridgeError, validateEnvironment } from './security.mjs';

validateEnvironment(process.env);

const app=express();
app.disable('x-powered-by');
const port=Number(process.env.PORT)||8080;
const allowedOrigins=parseAllowedOrigins(process.env.ALLOWED_ORIGIN);
const apiBase='https://openapi.tossinvest.com';
let tokenCache={value:'',expiresAt:0};
let firebaseCertCache={certs:{},expiresAt:0};
const lastRequestByUser=new Map();

function cors(req,res,next){
  const origin=req.get('origin');
  const allowed=!origin||allowedOrigins.has(origin);
  if(origin&&allowed)res.set({'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Authorization','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Max-Age':'600'});
  if(req.method==='OPTIONS')return allowed?res.sendStatus(204):res.sendStatus(403);
  if(!allowed)return res.status(403).json({code:'origin-not-allowed',message:'허용되지 않은 앱 주소입니다.'});
  next();
}
app.use(cors);
app.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});next();});

function decodePart(value){return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}
async function firebaseCerts(){
  if(Date.now()<firebaseCertCache.expiresAt&&Object.keys(firebaseCertCache.certs).length)return firebaseCertCache.certs;
  const response=await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Google 로그인 인증서를 확인할 수 없습니다.');
  const cacheControl=response.headers.get('cache-control')||'',maxAge=Number(cacheControl.match(/max-age=(\d+)/)?.[1]||300);
  firebaseCertCache={certs:await response.json(),expiresAt:Date.now()+maxAge*1000};
  return firebaseCertCache.certs;
}
async function verifyFirebaseIdToken(token){
  const parts=String(token||'').split('.');if(parts.length!==3)throw new Error('invalid token');
  const [encodedHeader,encodedPayload,encodedSignature]=parts,header=decodePart(encodedHeader),payload=decodePart(encodedPayload);
  if(header.alg!=='RS256'||!header.kid)throw new Error('invalid algorithm');
  const cert=(await firebaseCerts())[header.kid];if(!cert)throw new Error('unknown key');
  const valid=verify('RSA-SHA256',Buffer.from(`${encodedHeader}.${encodedPayload}`),createPublicKey(cert),Buffer.from(encodedSignature,'base64url'));
  if(!valid)throw new Error('invalid signature');
  return payload;
}
async function authorize(req,res,next){
  try{
    const token=bearerToken(req.get('authorization'));
    if(!token)return res.status(401).json({code:'login-required',message:'Google 로그인이 필요합니다.'});
    req.user=await verifyFirebaseIdToken(token);
    const decision=authorizeOwnerClaims(req.user,process.env);
    if(!decision.ok)return res.status(decision.status).json({code:decision.code,message:decision.status===403?'이 계정은 토스 연동 사용 권한이 없습니다.':'로그인 확인이 만료되었습니다. 다시 로그인해 주세요.'});
    const last=lastRequestByUser.get(req.user.sub)||0,now=Date.now();
    if(now-last<2000)return res.status(429).json({code:'too-many-requests',message:'잠시 후 다시 조회해 주세요.'});
    lastRequestByUser.set(req.user.sub,now);
    if(lastRequestByUser.size>500)for(const [uid,time] of lastRequestByUser)if(now-time>3600000)lastRequestByUser.delete(uid);
    next();
  }catch(_){res.status(401).json({code:'invalid-login',message:'로그인 확인이 만료되었습니다. 다시 로그인해 주세요.'});}
}

async function tossToken(){
  if(tokenCache.value&&Date.now()<tokenCache.expiresAt-60000)return tokenCache.value;
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:process.env.TOSS_CLIENT_ID,client_secret:process.env.TOSS_CLIENT_SECRET});
  const response=await fetch(`${apiBase}/oauth2/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error('Toss token request failed'),{status:response.status,code:'toss-auth'});
  if(typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(Number(data.expires_in)))throw Object.assign(new Error('Invalid Toss token response'),{status:502,code:'toss-auth-response'});
  tokenCache={value:data.access_token,expiresAt:Date.now()+Number(data.expires_in||0)*1000};
  return tokenCache.value;
}

async function tossGet(path,accountSeq,retry=true){
  if(!isAllowedReadPath(path))throw Object.assign(new Error('Blocked Toss path'),{status:500,code:'blocked-path'});
  const token=await tossToken();
  const headers={Authorization:`Bearer ${token}`,Accept:'application/json'};
  if(accountSeq!==undefined&&accountSeq!==null)headers['X-Tossinvest-Account']=String(accountSeq);
  const response=await fetch(`${apiBase}${path}`,{headers,signal:AbortSignal.timeout(20000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===401&&retry){tokenCache={value:'',expiresAt:0};return tossGet(path,accountSeq,false);}
    throw Object.assign(new Error('Toss read failed'),{status:response.status,code:`toss-${response.status}`});
  }
  return data.result;
}

function validDate(value,fallback){
  const text=String(value||''),match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return fallback;
  const date=new Date(`${text}T00:00:00Z`);return !Number.isNaN(date.getTime())&&date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()+1===Number(match[2])&&date.getUTCDate()===Number(match[3])?text:fallback;
}
function validSymbols(value){
  const seen=new Set();
  return String(value||'').split(',').map(item=>item.trim().toUpperCase()).filter(symbol=>/^[A-Z0-9.-]{1,16}$/.test(symbol)&&!seen.has(symbol)&&seen.add(symbol)).slice(0,200);
}
function maskAccount(value){const text=String(value||'');return text?`토스증권 •${text.slice(-4)}`:'토스증권 계좌';}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function closedOrders(accountSeq,from,to){
  const orders=[];let cursor='';
  let truncated=false;
  for(let page=0;page<100;page++){
    const query=new URLSearchParams({status:'CLOSED',from,to,limit:'100'});if(cursor)query.set('cursor',cursor);
    const result=await tossGet(`/api/v1/orders?${query}`,accountSeq);
    orders.push(...(Array.isArray(result?.orders)?result.orders:[]));
    if(!result?.hasNext||!result?.nextCursor)break;
    if(page===99){truncated=true;break;}
    cursor=result.nextCursor;await wait(220);
  }
  return {orders,truncated};
}

app.get('/health',(_req,res)=>res.json({ok:true,mode:'read-only',ordersEnabled:false}));
app.get('/v1/toss/snapshot',authorize,async(req,res)=>{
  try{
    const today=new Date().toISOString().slice(0,10);
    const requestedFrom=validDate(req.query.from,process.env.TOSS_DEFAULT_FROM||'2020-01-01'),from=requestedFrom>today?today:requestedFrom;
    const accounts=await tossGet('/api/v1/accounts');
    const configured=process.env.TOSS_ACCOUNT_SEQ;
    const account=accounts.find(row=>configured&&String(row.accountSeq)===String(configured))||accounts.find(row=>row.accountType==='BROKERAGE')||accounts[0];
    if(!account)return res.status(404).json({code:'no-account',message:'조회 가능한 토스증권 종합매매 계좌가 없습니다.'});
    const symbols=validSymbols(req.query.symbols);
    const [holdingResult,orderResult,priceResult]=await Promise.all([
      tossGet('/api/v1/holdings',account.accountSeq),
      closedOrders(account.accountSeq,from,today),
      symbols.length?tossGet(`/api/v1/prices?${new URLSearchParams({symbols:symbols.join(',')})}`):Promise.resolve([])
    ]);
    res.json({
      accountLabel:maskAccount(account.accountNo),fetchedAt:new Date().toISOString(),from,
      holdings:Array.isArray(holdingResult?.items)?holdingResult.items:[],prices:Array.isArray(priceResult)?priceResult:[],orders:orderResult.orders,historyTruncated:orderResult.truncated
    });
  }catch(error){
    const safe=safeBridgeError(error);
    console.error('Toss read-only sync failed',{code:safe.code,status:safe.status});
    res.status(safe.status).json({code:safe.code,message:safe.message});
  }
});

app.use((_req,res)=>res.status(404).json({code:'not-found',message:'지원하지 않는 경로입니다.'}));
app.listen(port,()=>console.log(`DividendOS Toss read-only bridge listening on ${port}`));
