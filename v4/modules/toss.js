import { isDate, n, todayISO } from './utils.js?v=0.12.7-r64';

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
  const value=String(order?.rawExternalId||order?.externalId||order?.orderId||order?.id||'').trim();
  return value.length<=256?value:'';
}

function accountIdOf(row) {
  return String(row?.accountId??row?.accountSeq??'').trim().slice(0,128);
}

function marketOf(row) {
  return String(row?.market??row?.exchange??row?.exchangeCode??'').trim().toUpperCase().slice(0,32);
}

function securityIdOf(row) {
  return String(row?.securityId??row?.instrumentId??row?.stockCode??row?.productCode??row?.isin??'').trim().toUpperCase().slice(0,64);
}

export function tossIdentityOf(row) {
  const symbol=symbolOf(row?.symbol),currency=String(row?.currency||'').toUpperCase(),market=marketOf(row),securityId=securityIdOf(row),accountId=accountIdOf(row);
  const instrumentKey=securityId?`${market||'UNKNOWN'}:${securityId}`:`${market||'UNKNOWN'}:${symbol}:${currency||'UNKNOWN'}`;
  return {accountId,market,securityId,instrumentKey,assetKey:`toss:${instrumentKey}`};
}

function tradeSignature(row) {
  const symbol=symbolOf(row?.symbol),date=dateOf(row?.date),type=String(row?.type||'').toLowerCase();
  const shares=Math.max(0,n(row?.shares)),price=Math.max(0,n(row?.price));
  if(!symbol||!date||!['buy','sell'].includes(type)||shares<=0||price<=0)return '';
  return [symbol,date,type,shares.toFixed(8),price.toFixed(4)].join('|');
}

function dividendSignature(row) {
  const symbol=symbolOf(row?.symbol),date=dateOf(row?.date),amount=Math.max(0,n(row?.amountUSD));
  if(!symbol||!date||amount<=0)return '';
  return [symbol,date,amount.toFixed(2)].join('|');
}

export function normalizeTossHolding(row) {
  const symbol=symbolOf(row?.symbol);
  if(!symbol)return null;
  const identity=tossIdentityOf(row);
  return {
    ...identity,
    accountLabel:String(row?.accountLabel||'').trim().slice(0,64),
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
  return {...tossIdentityOf(row),symbol,currency,lastPrice,timestamp:String(row?.timestamp||'')};
}

export function normalizeTossOrder(order) {
  const execution=order?.execution||{};
  const rawExternalId=orderIdOf(order),symbol=symbolOf(order?.symbol),identity=tossIdentityOf(order);
  const shares=Math.max(0,n(order?.shares??execution.filledQuantity??order?.filledQuantity));
  const price=Math.max(0,n(order?.priceFilled??execution.averageFilledPrice??order?.averageFilledPrice??order?.price));
  const date=dateOf(order?.date??execution.filledAt??order?.filledAt??order?.orderedAt);
  const side=String(order?.type??order?.side??'').toUpperCase();
  const type=side==='SELL'||side==='매도'?'sell':side==='BUY'||side==='매수'?'buy':'';
  const currency=String(order?.currency||'').toUpperCase();
  if(!rawExternalId||!symbol||!date||date>todayISO()||!type||shares<=0||shares>1e9||price<=0||price>1e9)return null;
  const externalId=identity.accountId?`${identity.accountId}:${rawExternalId}`:rawExternalId;
  return {
    ...identity,externalId,rawExternalId,accountLabel:String(order?.accountLabel||'').trim().slice(0,64),symbol,name:String(order?.name||symbol).trim()||symbol,date,type,shares,price,currency,
    buyType:type==='buy'?'direct':'',reinvestAmountUSD:0,note:'토스 체결 승인 가져오기'
  };
}

export function normalizeTossDividend(row) {
  const rawExternalId=orderIdOf(row),symbol=symbolOf(row?.symbol),date=dateOf(row?.date??row?.paidAt??row?.paymentDate),identity=tossIdentityOf(row);
  const amountUSD=Math.max(0,n(row?.amountUSD??row?.netAmount??row?.amount));
  const currency=String(row?.currency||'').toUpperCase();
  if(!rawExternalId||!symbol||!date||date>todayISO()||amountUSD<=0||amountUSD>1e9)return null;
  const externalId=identity.accountId?`${identity.accountId}:${rawExternalId}`:rawExternalId;
  return {...identity,externalId,rawExternalId,accountLabel:String(row?.accountLabel||'').trim().slice(0,64),symbol,name:String(row?.name||symbol).trim()||symbol,date,amountUSD,currency};
}

export function mergeTossSourceLedger(current={},snapshot={},observedAt=new Date().toISOString()) {
  const merge=(existing,incoming,normalizer)=>{
    const map=new Map((Array.isArray(existing)?existing:[]).filter(row=>row?.externalId).map(row=>[String(row.externalId),row]));
    for(const raw of Array.isArray(incoming)?incoming:[]){
      const row=normalizer(raw);if(!row)continue;
      const previous=map.get(row.externalId);
      map.set(row.externalId,{...(previous||{}),...row,firstSeenAt:previous?.firstSeenAt||observedAt,lastSeenAt:observedAt});
    }
    return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.externalId).localeCompare(String(b.externalId)));
  };
  return {
    orders:merge(current.orders,snapshot.orders,normalizeTossOrder),
    dividends:merge(current.dividends,snapshot.dividends,normalizeTossDividend)
  };
}

export function buildTossSync(snapshot, {existingTrades=[],existingDividends=[], appPositions=[]}={}) {
  const existingIds=new Set(existingTrades.filter(row=>row?.source?.provider==='toss').flatMap(row=>[String(row.source.externalId||''),String(row.source.rawExternalId||'')]).filter(Boolean));
  const manualSignatureCounts=new Map();
  for(const trade of existingTrades.filter(row=>row?.source?.provider!=='toss')){
    const signature=tradeSignature(trade);if(signature)manualSignatureCounts.set(signature,(manualSignatureCounts.get(signature)||0)+1);
  }
  const normalizedHoldings=(Array.isArray(snapshot?.holdings)?snapshot.holdings:[]).map(normalizeTossHolding).filter(Boolean);
  const holdingMap=new Map();
  for(const row of normalizedHoldings){
    const previous=holdingMap.get(row.assetKey);
    if(previous){previous.shares+=row.shares;previous.marketValue+=row.marketValue;previous.accounts=[...new Set([...previous.accounts,row.accountId].filter(Boolean))];}
    else holdingMap.set(row.assetKey,{...row,accounts:row.accountId?[row.accountId]:[]});
  }
  const holdings=[...holdingMap.values()];
  const prices=(Array.isArray(snapshot?.prices)?snapshot.prices:[]).map(normalizeTossPrice).filter(Boolean);
  const appMap=new Map();
  for(const row of appPositions){const key=String(row?.assetKey||'');if(key)appMap.set(key,Math.max(0,n(row.shares)));else appMap.set(`symbol:${symbolOf(row.symbol)}`,Math.max(0,n(row.shares)));}
  const comparisons=holdings.map(row=>({
    ...row,
    appShares:appMap.get(row.assetKey)??appMap.get(`symbol:${row.symbol}`)??0,
    difference:row.shares-(appMap.get(row.assetKey)??appMap.get(`symbol:${row.symbol}`)??0),
    supported:row.currency==='USD'
  }));
  const seen=new Set(),ignored=[];let matchedExistingCount=0;
  const candidates=[];
  for(const raw of Array.isArray(snapshot?.orders)?snapshot.orders:[]) {
    const row=normalizeTossOrder(raw);
    if(!row){ignored.push({reason:'invalid'});continue;}
    if(row.currency!=='USD'){ignored.push({...row,reason:'currency'});continue;}
    if(seen.has(row.externalId)||existingIds.has(row.externalId)||existingIds.has(row.rawExternalId))continue;
    const signature=tradeSignature(row),manualMatches=manualSignatureCounts.get(signature)||0;
    if(manualMatches>0){manualSignatureCounts.set(signature,manualMatches-1);matchedExistingCount++;seen.add(row.externalId);continue;}
    seen.add(row.externalId);candidates.push(row);
  }
  const existingDividendIds=new Set(existingDividends.filter(row=>row?.source?.provider==='toss').flatMap(row=>[String(row.source.externalId||''),String(row.source.rawExternalId||'')]).filter(Boolean));
  const manualDividendSignatureCounts=new Map();
  for(const dividend of existingDividends.filter(row=>row?.source?.provider!=='toss')){
    const signature=dividendSignature(dividend);if(signature)manualDividendSignatureCounts.set(signature,(manualDividendSignatureCounts.get(signature)||0)+1);
  }
  const seenDividends=new Set(),dividendCandidates=[];let matchedExistingDividendCount=0;
  for(const raw of Array.isArray(snapshot?.dividends)?snapshot.dividends:[]){
    const row=normalizeTossDividend(raw);
    if(!row){ignored.push({reason:'invalid-dividend'});continue;}
    if(row.currency!=='USD'){ignored.push({...row,reason:'currency'});continue;}
    if(seenDividends.has(row.externalId)||existingDividendIds.has(row.externalId)||existingDividendIds.has(row.rawExternalId))continue;
    const signature=dividendSignature(row),manualMatches=manualDividendSignatureCounts.get(signature)||0;
    if(manualMatches>0){manualDividendSignatureCounts.set(signature,manualMatches-1);matchedExistingDividendCount++;seenDividends.add(row.externalId);continue;}
    seenDividends.add(row.externalId);dividendCandidates.push(row);
  }
  candidates.sort((a,b)=>a.date.localeCompare(b.date)||a.externalId.localeCompare(b.externalId));
  dividendCandidates.sort((a,b)=>a.date.localeCompare(b.date)||a.externalId.localeCompare(b.externalId));
  return {
    accountLabel:String(snapshot?.accountLabel||'토스증권 계좌'),
    fetchedAt:String(snapshot?.fetchedAt||new Date().toISOString()),
    holdings,prices,comparisons,candidates,dividendCandidates,
    ignoredCount:ignored.length,matchedExistingCount,matchedExistingDividendCount,historyTruncated:!!snapshot?.historyTruncated,
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

export function mergeTossDividendCandidates(current=[],incoming=[]){
  const map=new Map();
  for(const raw of [...current,...incoming]){
    const row=normalizeTossDividend(raw),id=String(row?.externalId||'');
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
    source:{provider:'toss',externalId:row.externalId,rawExternalId:row.rawExternalId,accountId:row.accountId,assetKey:row.assetKey,market:row.market,securityId:row.securityId}
  };
}


export function tossCandidateToDividend(candidate,{projectId,id,sharesAtPayment=0,createdAt=new Date().toISOString()}={}){
  const row=normalizeTossDividend(candidate);
  if(!row||row.currency!=='USD'||!projectId||!id)return null;
  return {
    id,projectId,symbol:row.symbol,date:row.date,amountUSD:row.amountUSD,sharesAtPayment:Math.max(0,n(sharesAtPayment)),
    referencePrice:0,rocPercent:null,rocStatus:'estimated',note:'토스 배당 승인 가져오기',createdAt,
    source:{provider:'toss',externalId:row.externalId,rawExternalId:row.rawExternalId,accountId:row.accountId,assetKey:row.assetKey,market:row.market,securityId:row.securityId}
  };
}
