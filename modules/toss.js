import { isDate, n } from './utils.js';

const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,16}$/;

function symbolOf(value) {
  const symbol=String(value||'').trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol)?symbol:'';
}

function dateOf(value) {
  const text=String(value||'');
  const match=text.match(/^\d{4}-\d{2}-\d{2}/);
  return match&&isDate(match[0])?match[0]:'';
}

function orderIdOf(order) {
  return String(order?.externalId||order?.orderId||order?.id||'').trim();
}

export function normalizeTossHolding(row) {
  const symbol=symbolOf(row?.symbol);
  if(!symbol)return null;
  return {
    symbol,
    name:String(row?.name||symbol).trim()||symbol,
    currency:String(row?.currency||'').toUpperCase(),
    shares:Math.max(0,n(row?.shares??row?.quantity)),
    avgPrice:Math.max(0,n(row?.avgPrice??row?.averagePurchasePrice)),
    lastPrice:Math.max(0,n(row?.lastPrice)),
    marketValue:Math.max(0,n(row?.marketValue?.amount??row?.marketValue))
  };
}

export function normalizeTossPrice(row) {
  const symbol=symbolOf(row?.symbol),currency=String(row?.currency||'').toUpperCase(),lastPrice=Math.max(0,n(row?.lastPrice));
  if(!symbol||!currency||lastPrice<=0)return null;
  return {symbol,currency,lastPrice,timestamp:String(row?.timestamp||'')};
}

export function normalizeTossOrder(order) {
  const execution=order?.execution||{};
  const externalId=orderIdOf(order),symbol=symbolOf(order?.symbol);
  const shares=Math.max(0,n(order?.shares??execution.filledQuantity??order?.filledQuantity));
  const price=Math.max(0,n(order?.priceFilled??execution.averageFilledPrice??order?.averageFilledPrice??order?.price));
  const date=dateOf(order?.date??execution.filledAt??order?.filledAt??order?.orderedAt);
  const side=String(order?.type??order?.side??'').toUpperCase();
  const type=side==='SELL'||side==='매도'?'sell':side==='BUY'||side==='매수'?'buy':'';
  const currency=String(order?.currency||'').toUpperCase();
  if(!externalId||!symbol||!date||!type||shares<=0||price<=0)return null;
  return {
    externalId,symbol,name:String(order?.name||symbol).trim()||symbol,date,type,shares,price,currency,
    buyType:type==='buy'?'direct':'',reinvestAmountUSD:0,note:'토스 체결 승인 가져오기'
  };
}

export function buildTossSync(snapshot, {existingTrades=[], appPositions=[]}={}) {
  const existingIds=new Set(existingTrades.filter(row=>row?.source?.provider==='toss').map(row=>String(row.source.externalId||'')));
  const holdings=(Array.isArray(snapshot?.holdings)?snapshot.holdings:[]).map(normalizeTossHolding).filter(Boolean);
  const prices=(Array.isArray(snapshot?.prices)?snapshot.prices:[]).map(normalizeTossPrice).filter(Boolean);
  const appMap=new Map(appPositions.map(row=>[symbolOf(row.symbol),Math.max(0,n(row.shares))]));
  const comparisons=holdings.map(row=>({
    ...row,
    appShares:appMap.get(row.symbol)||0,
    difference:row.shares-(appMap.get(row.symbol)||0),
    supported:row.currency==='USD'
  }));
  const seen=new Set(),ignored=[];
  const candidates=[];
  for(const raw of Array.isArray(snapshot?.orders)?snapshot.orders:[]) {
    const row=normalizeTossOrder(raw);
    if(!row){ignored.push({reason:'invalid'});continue;}
    if(row.currency!=='USD'){ignored.push({...row,reason:'currency'});continue;}
    if(seen.has(row.externalId)||existingIds.has(row.externalId))continue;
    seen.add(row.externalId);candidates.push(row);
  }
  candidates.sort((a,b)=>a.date.localeCompare(b.date)||a.externalId.localeCompare(b.externalId));
  return {
    accountLabel:String(snapshot?.accountLabel||'토스증권 계좌'),
    fetchedAt:String(snapshot?.fetchedAt||new Date().toISOString()),
    holdings,prices,comparisons,candidates,
    ignoredCount:ignored.length,historyTruncated:!!snapshot?.historyTruncated,
    unsupportedCurrencyCount:ignored.filter(row=>row.reason==='currency').length
  };
}

export function mergeTossCandidates(current=[], incoming=[]) {
  const map=new Map();
  for(const row of [...current,...incoming]) {
    const id=String(row?.externalId||'');
    if(id&&!map.has(id))map.set(id,row);
  }
  return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.externalId).localeCompare(String(b.externalId)));
}

export function tossCandidateToTrade(candidate,{projectId,id,createdAt=new Date().toISOString()}={}) {
  const row=normalizeTossOrder(candidate);
  if(!row||row.currency!=='USD'||!projectId||!id)return null;
  return {
    id,projectId,symbol:row.symbol,date:row.date,type:row.type,buyType:row.buyType,
    shares:row.shares,price:row.price,reinvestAmountUSD:0,note:row.note,createdAt,
    source:{provider:'toss',externalId:row.externalId}
  };
}
