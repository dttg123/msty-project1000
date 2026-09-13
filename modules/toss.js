import { isDate, n, todayISO } from './utils.js';

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
  const value=String(order?.externalId||order?.orderId||order?.id||'').trim();
  return value.length<=256?value:'';
}

function tradeSignature(row) {
  const symbol=symbolOf(row?.symbol),date=dateOf(row?.date),type=String(row?.type||'').toLowerCase();
  const shares=Math.max(0,n(row?.shares)),price=Math.max(0,n(row?.price));
  if(!symbol||!date||!['buy','sell'].includes(type)||shares<=0||price<=0)return '';
  return [symbol,date,type,shares.toFixed(8),price.toFixed(4)].join('|');
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
  if(!externalId||!symbol||!date||date>todayISO()||!type||shares<=0||shares>1e9||price<=0||price>1e9)return null;
  return {
    externalId,symbol,name:String(order?.name||symbol).trim()||symbol,date,type,shares,price,currency,
    buyType:type==='buy'?'direct':'',reinvestAmountUSD:0,note:'토스 체결 승인 가져오기'
  };
}

export function buildTossSync(snapshot, {existingTrades=[], appPositions=[]}={}) {
  const existingIds=new Set(existingTrades.filter(row=>row?.source?.provider==='toss').map(row=>String(row.source.externalId||'')));
  const manualSignatureCounts=new Map();
  for(const trade of existingTrades.filter(row=>row?.source?.provider!=='toss')){
    const signature=tradeSignature(trade);if(signature)manualSignatureCounts.set(signature,(manualSignatureCounts.get(signature)||0)+1);
  }
  const holdings=(Array.isArray(snapshot?.holdings)?snapshot.holdings:[]).map(normalizeTossHolding).filter(Boolean);
  const prices=(Array.isArray(snapshot?.prices)?snapshot.prices:[]).map(normalizeTossPrice).filter(Boolean);
  const appMap=new Map(appPositions.map(row=>[symbolOf(row.symbol),Math.max(0,n(row.shares))]));
  const comparisons=holdings.map(row=>({
    ...row,
    appShares:appMap.get(row.symbol)||0,
    difference:row.shares-(appMap.get(row.symbol)||0),
    supported:row.currency==='USD'
  }));
  const seen=new Set(),ignored=[];let matchedExistingCount=0;
  const candidates=[];
  for(const raw of Array.isArray(snapshot?.orders)?snapshot.orders:[]) {
    const row=normalizeTossOrder(raw);
    if(!row){ignored.push({reason:'invalid'});continue;}
    if(row.currency!=='USD'){ignored.push({...row,reason:'currency'});continue;}
    if(seen.has(row.externalId)||existingIds.has(row.externalId))continue;
    const signature=tradeSignature(row),manualMatches=manualSignatureCounts.get(signature)||0;
    if(manualMatches>0){manualSignatureCounts.set(signature,manualMatches-1);matchedExistingCount++;seen.add(row.externalId);continue;}
    seen.add(row.externalId);candidates.push(row);
  }
  candidates.sort((a,b)=>a.date.localeCompare(b.date)||a.externalId.localeCompare(b.externalId));
  return {
    accountLabel:String(snapshot?.accountLabel||'토스증권 계좌'),
    fetchedAt:String(snapshot?.fetchedAt||new Date().toISOString()),
    holdings,prices,comparisons,candidates,
    ignoredCount:ignored.length,matchedExistingCount,historyTruncated:!!snapshot?.historyTruncated,
    unsupportedCurrencyCount:ignored.filter(row=>row.reason==='currency').length
  };
}

export function mergeTossCandidates(current=[], incoming=[]) {
  const map=new Map();
  for(const raw of [...current,...incoming]) {
    const row=normalizeTossOrder(raw),id=String(row?.externalId||'');
    if(row?.currency==='USD'&&id&&!map.has(id))map.set(id,row);
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
