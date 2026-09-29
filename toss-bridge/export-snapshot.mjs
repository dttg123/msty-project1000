import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseAccounts,parseHoldings,parseOrders,parsePrices,summarizeAccountReads} from './toss-contract.mjs';

const API_BASE='https://openapi.tossinvest.com';
const wait=ms=>new Promise(resolveWait=>setTimeout(resolveWait,ms));

export function validateExportEnvironment(env){
  for(const key of ['TOSS_CLIENT_ID','TOSS_CLIENT_SECRET'])if(!String(env[key]||'').trim())throw new Error(`Missing ${key}`);
  if(String(env.TOSS_CLIENT_ID).length>256||String(env.TOSS_CLIENT_SECRET).length>512)throw new Error('Invalid credential length');
}

function date(value,fallback){
  const text=String(value||''),match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return fallback;
  const parsed=new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.getUTCFullYear()===Number(match[1])&&parsed.getUTCMonth()+1===Number(match[2])&&parsed.getUTCDate()===Number(match[3])?text:fallback;
}
function todayKST(now=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function maskAccount(value){const text=String(value||'');return text?`토스증권 •${text.slice(-4)}`:'토스증권 계좌';}
function scopeId(accounts){return createHash('sha256').update(accounts.map(row=>`${row.accountSeq}:${row.accountNo}`).sort().join('|')).digest('hex').slice(0,24);}
function symbolsOf(holdings){return [...new Set(holdings.map(row=>String(row.symbol||'').trim().toUpperCase()).filter(symbol=>/^[A-Z0-9.-]{1,16}$/.test(symbol)))].slice(0,200);}

async function responseJson(fetchImpl,url,options){
  const response=await fetchImpl(url,options),body=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(`Toss request failed (${response.status})`),{status:response.status});
  return body;
}

export async function createTossSnapshot({env=process.env,fetchImpl=fetch,now=new Date(),waitImpl=wait}={}){
  validateExportEnvironment(env);
  const tokenBody=new URLSearchParams({grant_type:'client_credentials',client_id:env.TOSS_CLIENT_ID,client_secret:env.TOSS_CLIENT_SECRET});
  const tokenResult=await responseJson(fetchImpl,`${API_BASE}/oauth2/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:tokenBody,signal:AbortSignal.timeout(15000)});
  const accessToken=String(tokenResult.access_token||'');
  if(!accessToken)throw new Error('Invalid Toss token response');
  const tossGet=async(path,accountSeq)=>{
    const headers={Authorization:`Bearer ${accessToken}`,Accept:'application/json'};
    if(accountSeq!==undefined)headers['X-Tossinvest-Account']=String(accountSeq);
    return (await responseJson(fetchImpl,`${API_BASE}${path}`,{headers,signal:AbortSignal.timeout(20000)})).result;
  };
  const accounts=parseAccounts(await tossGet('/api/v1/accounts'));
  const configured=String(env.TOSS_ACCOUNT_SEQ||'').trim();
  const selected=(configured?accounts.filter(row=>String(row.accountSeq)===configured):accounts.filter(row=>row.accountType==='BROKERAGE')).slice(0,5);
  if(!selected.length)throw new Error('조회 가능한 토스증권 종합매매 계좌가 없습니다.');
  const scoped=selected.map(account=>({...account,accountLabel:maskAccount(account.accountNo)}));
  const today=todayKST(now),requestedFrom=date(env.TOSS_DEFAULT_FROM,'2020-01-01'),from=requestedFrom>today?today:requestedFrom;
  const accountSettlements=await Promise.allSettled(scoped.map(async account=>{
    const holdings=parseHoldings(await tossGet('/api/v1/holdings',account.accountSeq),account),orders=[];let cursor='',truncated=false;
    for(let page=0;page<100;page++){
      const query=new URLSearchParams({status:'CLOSED',from,to:today,limit:'100'});if(cursor)query.set('cursor',cursor);
      const result=await tossGet(`/api/v1/orders?${query}`,account.accountSeq);
      if(!result||!Array.isArray(result.orders))throw new Error('Invalid order page');
      orders.push(...result.orders);
      if(!result.hasNext||!result.nextCursor)break;
      if(page===99){truncated=true;break;}
      cursor=result.nextCursor;await waitImpl(220);
    }
    return {account,holdings,orders:parseOrders({orders},account),truncated};
  }));
  const successfulHoldings=accountSettlements.filter(row=>row.status==='fulfilled').flatMap(row=>row.value.holdings),symbols=symbolsOf(successfulHoldings);
  const priceSettlement=await Promise.resolve(symbols.length?tossGet(`/api/v1/prices?${new URLSearchParams({symbols:symbols.join(',')})}`).then(parsePrices):[]).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
  const {successes,failedAccountCount,priceFailed,syncStatus}=summarizeAccountReads(accountSettlements,priceSettlement);
  if(!successes.length)throw new Error('모든 토스 계좌 조회가 실패했습니다.');
  const snapshot={
    accountLabel:scoped.length===1?scoped[0].accountLabel:`토스증권 ${scoped.length}계좌`,accountScopeId:scopeId(scoped),fetchedAt:now.toISOString(),from,
    syncStatus,syncCursor:{ordersThrough:today},capabilities:{orders:true,holdings:true,prices:!priceFailed,dividends:false},
    accountResults:accountSettlements.map((row,index)=>row.status==='fulfilled'?{accountId:String(row.value.account.accountSeq),accountLabel:row.value.account.accountLabel,status:'ok',holdingsCount:row.value.holdings.length,ordersCount:row.value.orders.length}:{accountId:String(scoped[index].accountSeq),accountLabel:scoped[index].accountLabel,status:'error'}),
    holdings:successes.flatMap(row=>row.holdings),prices:priceFailed?[]:priceSettlement.value,orders:successes.flatMap(row=>row.orders),dividends:[],
    failedAccountCount,historyTruncated:successes.some(row=>row.truncated)
  };
  return {format:'dividend-os-toss-snapshot',version:1,exportedAt:now.toISOString(),snapshot};
}

async function main(){
  const outputName=basename(process.argv[2]||`DividendOS_Toss_${Date.now()}.json`);
  if(!outputName.endsWith('.json'))throw new Error('Output must be a JSON file');
  const outputPath=resolve(process.cwd(),outputName),payload=await createTossSnapshot();
  await writeFile(outputPath,`${JSON.stringify(payload,null,2)}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
  console.log(`Toss read-only snapshot saved: ${outputName}`);
  console.log(`Accounts: ${payload.snapshot.accountResults.length}, holdings: ${payload.snapshot.holdings.length}, orders: ${payload.snapshot.orders.length}`);
}

const invoked=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(invoked)main().catch(error=>{console.error(`Toss export failed: ${error.message}`);process.exitCode=1;});
