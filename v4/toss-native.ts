import type {TossSnapshotPayload} from './toss-client.js';
import { isRecord } from './modules/utils.js';
const object=(value:unknown):Record<string, unknown>=>isRecord(value)?value:{};
interface NativeAccount {accountSeq:number;accountNo:string;accountType:string;accountLabel?:string;}

const SYMBOL=/^[A-Z0-9.-]{1,16}$/;
const CURRENCIES=new Set(['USD','KRW']);

function plugin(){return window?.Capacitor?.Plugins?.TossReadOnly||null;}
function text(value: unknown,max: number=256){const result=String(value??'').trim();return result&&result.length<=max?result:'';}
function symbol(value: unknown){const result=text(value,16).toUpperCase();return SYMBOL.test(result)?result:'';}
function decimal(value: unknown,{nullable=false,min=0,max=1e15}: {nullable?:boolean;min?:number;max?:number}={}){if(nullable&&(value===null||value===undefined||value===''))return null;const number=Number(value);return Number.isFinite(number)&&number>=min&&number<=max?String(value):null;}
function dateTime(value: unknown){const result=text(value,64);return result&&!Number.isNaN(Date.parse(result))?result:'';}
function resultOf(response: unknown){return object(object(response).data).result;}

export function isNativeTossAvailable(){return !!plugin();}
export async function nativeTossCredentialStatus(){const value=await plugin()?.credentialStatus();return {available:isNativeTossAvailable(),configured:!!value?.configured,lastPublicIp:text(value?.lastPublicIp,64)};}
export async function saveNativeTossCredentials(clientId: string,clientSecret: string): Promise<void>{const target=plugin();if(!target)throw new Error('갤럭시 설치판에서만 사용할 수 있습니다.');await target.saveCredentials({clientId:String(clientId||'').trim(),clientSecret:String(clientSecret||'').trim()});}
export async function clearNativeTossCredentials(): Promise<void>{await plugin()?.clearCredentials();}
export async function nativePublicIp(): Promise<string>{const target=plugin();if(!target)throw new Error('갤럭시 설치판에서만 사용할 수 있습니다.');return String((await target.publicIp())?.ip||'');}
export async function markNativeTossPublicIp(ip: string): Promise<void>{const target=plugin();if(!target)return;await target.markPublicIp({ip:String(ip||'')});}
export async function openTossIpManagement(){const target=plugin();if(!target)return window.open('https://www.tossinvest.com/','_blank','noopener');await target.openToss();}

async function tossGet(path: string,accountSeq: string|number=''): Promise<Record<string, unknown>>{
  const target=plugin();if(!target)throw new Error('갤럭시 설치판에서만 사용할 수 있습니다.');
  const value=await target.request({path,accountSeq:String(accountSeq||'')});
  const result=resultOf(value);
  if(Array.isArray(result))return {items:result};
  return object(result);
}

function parseAccounts(value: unknown){
  if(!Array.isArray(value)||value.length>20)throw new Error('토스 계좌 응답 형식이 올바르지 않습니다.');
  return value.map((value:unknown)=>{const row=object(value);return {accountSeq:Number(row.accountSeq),accountNo:text(row.accountNo,64),accountType:text(row.accountType,32)};}).filter((row)=>Number.isSafeInteger(row.accountSeq)&&row.accountSeq>=0&&row.accountNo);
}
function accountLabel(account: NativeAccount){return account.accountNo?`토스증권 •${account.accountNo.slice(-4)}`:'토스증권 계좌';}
function parseHoldings(value: unknown,account: NativeAccount){
  const items=object(value).items;if(!Array.isArray(items)||items.length>5000)throw new Error('토스 보유주식 응답 형식이 올바르지 않습니다.');
  return items.map((value:unknown)=>{const row=object(value);const marketValue=object(row.marketValue),item={accountId:String(account.accountSeq),accountLabel:account.accountLabel,symbol:symbol(row?.symbol),name:text(row?.name,128),market:text(row?.marketCountry??row?.market,32).toUpperCase(),currency:text(row?.currency,3).toUpperCase(),quantity:decimal(row?.quantity,{max:1e12}),averagePurchasePrice:decimal(row?.averagePurchasePrice,{nullable:true}),lastPrice:decimal(row?.lastPrice,{nullable:true}),marketValue:{amount:decimal(marketValue?.amount,{nullable:true})}};return item.symbol&&CURRENCIES.has(item.currency)&&item.quantity!==null?item:null;}).filter((item):item is NonNullable<typeof item>=>item!==null);
}
function parseOrders(value: unknown,account: NativeAccount){
  const orders=object(value).orders;if(!Array.isArray(orders)||orders.length>10000)throw new Error('토스 체결 응답 형식이 올바르지 않습니다.');
  return orders.map((value:unknown)=>{const row=object(value);const execution=object(row.execution),item={accountId:String(account.accountSeq),accountLabel:account.accountLabel,orderId:text(row?.orderId,256),symbol:symbol(row?.symbol),side:text(row?.side,8).toUpperCase(),status:text(row?.status,32).toUpperCase(),currency:text(row?.currency,3).toUpperCase(),orderedAt:dateTime(row?.orderedAt),canceledAt:dateTime(row?.canceledAt)||null,execution:{filledQuantity:decimal(execution?.filledQuantity,{nullable:true,max:1e12}),averageFilledPrice:decimal(execution?.averageFilledPrice,{nullable:true}),filledAmount:decimal(execution?.filledAmount,{nullable:true}),commission:decimal(execution?.commission,{nullable:true}),tax:decimal(execution?.tax,{nullable:true}),filledAt:dateTime(execution?.filledAt)||null,settlementDate:text(execution?.settlementDate,10)||null}};const withMarket={...item,market:item.currency==='USD'?'US':'KR'};return item.orderId&&item.symbol&&['BUY','SELL'].includes(item.side)&&CURRENCIES.has(item.currency)&&item.orderedAt?withMarket:null;}).filter((item):item is NonNullable<typeof item>=>item!==null);
}
function parsePrices(value: unknown){
  if(!Array.isArray(value)||value.length>200)throw new Error('토스 현재가 응답 형식이 올바르지 않습니다.');
  return value.map((value:unknown)=>{const row=object(value);const item={symbol:symbol(row?.symbol),currency:text(row?.currency,3).toUpperCase(),lastPrice:decimal(row?.lastPrice),timestamp:dateTime(row?.timestamp)};const withMarket={...item,market:item.currency==='USD'?'US':'KR'};return item.symbol&&CURRENCIES.has(item.currency)&&item.lastPrice!==null&&item.timestamp?withMarket:null;}).filter((item):item is NonNullable<typeof item>=>item!==null);
}
function validDate(value: unknown,fallback: string){const raw=String(value||''),match=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return fallback;const parsed=new Date(`${raw}T00:00:00Z`);return !Number.isNaN(parsed.getTime())&&parsed.getUTCFullYear()===Number(match[1])&&parsed.getUTCMonth()+1===Number(match[2])&&parsed.getUTCDate()===Number(match[3])?raw:fallback;}
function todayKST(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
async function scopeId(accounts: NativeAccount[]): Promise<string>{const source=accounts.map((row)=>`${row.accountSeq}:${row.accountNo}`).sort().join('|'),bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,24);}

export async function fetchNativeTossSnapshot({from='2020-01-01',symbols=[]}: {from?:string;symbols?:unknown[]}={}):Promise<TossSnapshotPayload>{
  if(!plugin())throw new Error('갤럭시 설치판에서만 토스 원터치 갱신을 사용할 수 있습니다.');
  const accounts=parseAccounts((await tossGet('/api/v1/accounts')).items);
  const selected=accounts.filter((row)=>row.accountType==='BROKERAGE').slice(0,5).map((row)=>({...row,accountLabel:accountLabel(row)}));
  if(!selected.length)throw new Error('조회 가능한 토스증권 종합매매 계좌가 없습니다.');
  const today=todayKST(),checkedFrom=validDate(from,'2020-01-01'),start=checkedFrom>today?today:checkedFrom;
  const settlements=await Promise.allSettled(selected.map(async(account: NativeAccount)=>{
    const holdings=parseHoldings(await tossGet('/api/v1/holdings',account.accountSeq),account),orders: unknown[]=[];let cursor='',truncated=false;
    for(let page=0;page<100;page++){
      const query=new URLSearchParams({status:'CLOSED',from:start,to:today,limit:'100'});if(cursor)query.set('cursor',cursor);
      const result=await tossGet(`/api/v1/orders?${query}`,account.accountSeq);
      if(!result||!Array.isArray(result.orders))throw new Error('토스 체결 페이지를 읽지 못했습니다.');
      orders.push(...result.orders);
      if(!result.hasNext||!result.nextCursor)break;
      if(page===99){truncated=true;break;}
      cursor=String(result.nextCursor);
    }
    return {account,holdings,orders:parseOrders({orders},account),truncated};
  }));
  const successes=settlements.filter(row=>row.status==='fulfilled').map(row=>row.value),failedAccountCount=settlements.length-successes.length;
  if(!successes.length)throw new Error('모든 토스 계좌 조회가 실패했습니다.');
  const cleanSymbols=[...new Set([...(Array.isArray(symbols)?symbols:[]),...successes.flatMap((row)=>row.holdings.map((holding)=>holding.symbol))].map(symbol).filter(item=>item!==''))].slice(0,200);
  let prices: ReturnType<typeof parsePrices>=[],priceFailed=false;
  if(cleanSymbols.length)try{prices=parsePrices((await tossGet(`/api/v1/prices?symbols=${encodeURIComponent(cleanSymbols.join(','))}`)).items);}catch (_){priceFailed=true;}
  const now=new Date().toISOString();
  return {accountLabel:selected.length===1?selected[0].accountLabel:`토스증권 ${selected.length}계좌`,accountScopeId:await scopeId(selected),fetchedAt:now,from:start,syncStatus:failedAccountCount||priceFailed?'partial':'complete',syncCursor:{ordersThrough:today},capabilities:{orders:true,holdings:true,prices:!priceFailed,dividends:false},accountResults:settlements.map((row,index)=>row.status==='fulfilled'?{accountId:String(row.value.account.accountSeq),accountLabel:row.value.account.accountLabel,status:'ok',holdingsCount:row.value.holdings.length,ordersCount:row.value.orders.length}:{accountId:String(selected[index].accountSeq),accountLabel:selected[index].accountLabel,status:'error'}),holdings:successes.flatMap((row)=>row.holdings),prices,orders:successes.flatMap((row)=>row.orders),dividends:[],failedAccountCount,historyTruncated:successes.some((row)=>row.truncated)};
}
