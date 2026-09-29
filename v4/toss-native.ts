declare const window: any;

const SYMBOL: any=/^[A-Z0-9.-]{1,16}$/;
const CURRENCIES: any=new Set(['USD','KRW']);

function plugin(): any{return window?.Capacitor?.Plugins?.TossReadOnly||null;}
function text(value: any,max: any=256): any{const result: any=String(value??'').trim();return result&&result.length<=max?result:'';}
function symbol(value: any): any{const result: any=text(value,16).toUpperCase();return SYMBOL.test(result)?result:'';}
function decimal(value: any,{nullable=false,min=0,max=1e15}: any={}): any{if(nullable&&(value===null||value===undefined||value===''))return null;const number: any=Number(value);return Number.isFinite(number)&&number>=min&&number<=max?String(value):null;}
function dateTime(value: any): any{const result: any=text(value,64);return result&&!Number.isNaN(Date.parse(result))?result:'';}
function resultOf(response: any): any{return response?.data?.result;}

export function isNativeTossAvailable(): any{return !!plugin();}
export async function nativeTossCredentialStatus(): Promise<any>{const value: any=await plugin()?.credentialStatus();return {available:isNativeTossAvailable(),configured:!!value?.configured,lastPublicIp:text(value?.lastPublicIp,64)};}
export async function saveNativeTossCredentials(clientId: any,clientSecret: any): Promise<any>{if(!plugin())throw new Error('갤럭시 설치판에서만 사용할 수 있습니다.');await plugin().saveCredentials({clientId:String(clientId||'').trim(),clientSecret:String(clientSecret||'').trim()});}
export async function clearNativeTossCredentials(): Promise<any>{await plugin()?.clearCredentials();}
export async function nativePublicIp(): Promise<any>{if(!plugin())throw new Error('갤럭시 설치판에서만 사용할 수 있습니다.');return String((await plugin().publicIp())?.ip||'');}
export async function markNativeTossPublicIp(ip: any): Promise<any>{if(!plugin())return;await plugin().markPublicIp({ip:String(ip||'')});}
export async function openTossIpManagement(): Promise<any>{if(!plugin())return window.open('https://www.tossinvest.com/','_blank','noopener');await plugin().openToss();}

async function tossGet(path: any,accountSeq: any=''): Promise<any>{
  const value: any=await plugin().request({path,accountSeq:String(accountSeq||'')});
  return resultOf(value);
}

function parseAccounts(value: any): any{
  if(!Array.isArray(value)||value.length>20)throw new Error('토스 계좌 응답 형식이 올바르지 않습니다.');
  return value.map((row: any)=>({accountSeq:Number(row?.accountSeq),accountNo:text(row?.accountNo,64),accountType:text(row?.accountType,32)})).filter((row: any)=>Number.isSafeInteger(row.accountSeq)&&row.accountSeq>=0&&row.accountNo);
}
function accountLabel(account: any): any{return account.accountNo?`토스증권 •${account.accountNo.slice(-4)}`:'토스증권 계좌';}
function parseHoldings(value: any,account: any): any{
  if(!value||!Array.isArray(value.items)||value.items.length>5000)throw new Error('토스 보유주식 응답 형식이 올바르지 않습니다.');
  return value.items.map((row: any)=>{const marketValue: any=row?.marketValue||{},item: any={accountId:String(account.accountSeq),accountLabel:account.accountLabel,symbol:symbol(row?.symbol),name:text(row?.name,128),market:text(row?.marketCountry??row?.market,32).toUpperCase(),currency:text(row?.currency,3).toUpperCase(),quantity:decimal(row?.quantity,{max:1e12}),averagePurchasePrice:decimal(row?.averagePurchasePrice,{nullable:true}),lastPrice:decimal(row?.lastPrice,{nullable:true}),marketValue:{amount:decimal(marketValue?.amount,{nullable:true})}};return item.symbol&&CURRENCIES.has(item.currency)&&item.quantity!==null?item:null;}).filter(Boolean);
}
function parseOrders(value: any,account: any): any{
  if(!value||!Array.isArray(value.orders)||value.orders.length>10000)throw new Error('토스 체결 응답 형식이 올바르지 않습니다.');
  return value.orders.map((row: any)=>{const execution: any=row?.execution||{},item: any={accountId:String(account.accountSeq),accountLabel:account.accountLabel,orderId:text(row?.orderId,256),symbol:symbol(row?.symbol),side:text(row?.side,8).toUpperCase(),status:text(row?.status,32).toUpperCase(),currency:text(row?.currency,3).toUpperCase(),orderedAt:dateTime(row?.orderedAt),canceledAt:dateTime(row?.canceledAt)||null,execution:{filledQuantity:decimal(execution?.filledQuantity,{nullable:true,max:1e12}),averageFilledPrice:decimal(execution?.averageFilledPrice,{nullable:true}),filledAmount:decimal(execution?.filledAmount,{nullable:true}),commission:decimal(execution?.commission,{nullable:true}),tax:decimal(execution?.tax,{nullable:true}),filledAt:dateTime(execution?.filledAt)||null,settlementDate:text(execution?.settlementDate,10)||null}};item.market=item.currency==='USD'?'US':'KR';return item.orderId&&item.symbol&&['BUY','SELL'].includes(item.side)&&CURRENCIES.has(item.currency)&&item.orderedAt?item:null;}).filter(Boolean);
}
function parsePrices(value: any): any{
  if(!Array.isArray(value)||value.length>200)throw new Error('토스 현재가 응답 형식이 올바르지 않습니다.');
  return value.map((row: any)=>{const item: any={symbol:symbol(row?.symbol),currency:text(row?.currency,3).toUpperCase(),lastPrice:decimal(row?.lastPrice),timestamp:dateTime(row?.timestamp)};item.market=item.currency==='USD'?'US':'KR';return item.symbol&&CURRENCIES.has(item.currency)&&item.lastPrice!==null&&item.timestamp?item:null;}).filter(Boolean);
}
function validDate(value: any,fallback: any): any{const raw: any=String(value||''),match=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return fallback;const parsed: any=new Date(`${raw}T00:00:00Z`);return !Number.isNaN(parsed.getTime())&&parsed.getUTCFullYear()===Number(match[1])&&parsed.getUTCMonth()+1===Number(match[2])&&parsed.getUTCDate()===Number(match[3])?raw:fallback;}
function todayKST(): any{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
async function scopeId(accounts: any): Promise<any>{const source: any=accounts.map((row: any)=>`${row.accountSeq}:${row.accountNo}`).sort().join('|'),bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,24);}

export async function fetchNativeTossSnapshot({from='2020-01-01',symbols=[]}: any={}): Promise<any>{
  if(!plugin())throw new Error('갤럭시 설치판에서만 토스 원터치 갱신을 사용할 수 있습니다.');
  const accounts: any=parseAccounts(await tossGet('/api/v1/accounts'));
  const selected: any=accounts.filter((row: any)=>row.accountType==='BROKERAGE').slice(0,5).map((row: any)=>({...row,accountLabel:accountLabel(row)}));
  if(!selected.length)throw new Error('조회 가능한 토스증권 종합매매 계좌가 없습니다.');
  const today: any=todayKST(),checkedFrom=validDate(from,'2020-01-01'),start=checkedFrom>today?today:checkedFrom;
  const settlements: any=await Promise.allSettled(selected.map(async(account: any)=>{
    const holdings: any=parseHoldings(await tossGet('/api/v1/holdings',account.accountSeq),account),orders: any=[];let cursor: any='',truncated=false;
    for(let page: any=0;page<100;page++){
      const query: any=new URLSearchParams({status:'CLOSED',from:start,to:today,limit:'100'});if(cursor)query.set('cursor',cursor);
      const result: any=await tossGet(`/api/v1/orders?${query}`,account.accountSeq);
      if(!result||!Array.isArray(result.orders))throw new Error('토스 체결 페이지를 읽지 못했습니다.');
      orders.push(...result.orders);
      if(!result.hasNext||!result.nextCursor)break;
      if(page===99){truncated=true;break;}
      cursor=result.nextCursor;
    }
    return {account,holdings,orders:parseOrders({orders},account),truncated};
  }));
  const successes: any=settlements.filter((row: any)=>row.status==='fulfilled').map((row: any)=>row.value),failedAccountCount=settlements.length-successes.length;
  if(!successes.length)throw new Error('모든 토스 계좌 조회가 실패했습니다.');
  const cleanSymbols: any=[...new Set([...(Array.isArray(symbols)?symbols:[]),...successes.flatMap((row: any)=>row.holdings.map((holding: any)=>holding.symbol))].map(symbol).filter(Boolean))].slice(0,200);
  let prices: any=[],priceFailed=false;
  if(cleanSymbols.length)try{prices=parsePrices(await tossGet(`/api/v1/prices?symbols=${encodeURIComponent(cleanSymbols.join(','))}`));}catch (_: any){priceFailed=true;}
  const now: any=new Date().toISOString();
  return {accountLabel:selected.length===1?selected[0].accountLabel:`토스증권 ${selected.length}계좌`,accountScopeId:await scopeId(selected),fetchedAt:now,from:start,syncStatus:failedAccountCount||priceFailed?'partial':'complete',syncCursor:{ordersThrough:today},capabilities:{orders:true,holdings:true,prices:!priceFailed,dividends:false},accountResults:settlements.map((row: any,index: any)=>row.status==='fulfilled'?{accountId:String(row.value.account.accountSeq),accountLabel:row.value.account.accountLabel,status:'ok',holdingsCount:row.value.holdings.length,ordersCount:row.value.orders.length}:{accountId:String(selected[index].accountSeq),accountLabel:selected[index].accountLabel,status:'error'}),holdings:successes.flatMap((row: any)=>row.holdings),prices,orders:successes.flatMap((row: any)=>row.orders),dividends:[],failedAccountCount,historyTruncated:successes.some((row: any)=>row.truncated)};
}
