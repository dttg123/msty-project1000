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
  const source=order&&Object.hasOwn(order,'rawExternalId')?order.rawExternalId:(order?.externalId||order?.orderId||order?.id||'');
  const value=String(source||'').trim();
  return value.length<=256?value:'';
}

function fingerprint(value) {
  let hash=14695981039346656037n;
  for(const char of String(value)){hash^=BigInt(char.codePointAt(0));hash=BigInt.asUintN(64,hash*1099511628211n);}
  return hash.toString(16).padStart(16,'0');
}

function sourceId(rawExternalId,identity,signature) {
  const base=rawExternalId||`fp-${fingerprint([identity.accountId,identity.instrumentKey,signature].join('|'))}`;
  return identity.accountId?`${identity.accountId}:${base}`:base;
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

function orderVersionFingerprint(row) {
  return fingerprint([row?.status,row?.symbol,row?.date,row?.type,n(row?.shares).toFixed(8),n(row?.price).toFixed(8),n(row?.feeUSD).toFixed(8),n(row?.taxUSD).toFixed(8),row?.currency].join('|'));
}

function dividendVersionFingerprint(row) {
  return fingerprint([row?.symbol,row?.date,n(row?.amountUSD).toFixed(8),n(row?.grossAmountUSD).toFixed(8),n(row?.withholdingTaxUSD).toFixed(8),n(row?.feeUSD).toFixed(8),row?.currency].join('|'));
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
  const feeUSD=Math.max(0,n(order?.feeUSD??execution.commission??order?.commission)),taxUSD=Math.max(0,n(order?.taxUSD??execution.tax??order?.tax));
  const status=String(order?.status||'FILLED').trim().toUpperCase().slice(0,32);
  if(!symbol||!date||date>todayISO()||!type||!['USD','KRW'].includes(currency)||shares<=0||shares>1e9||price<=0||price>1e9||feeUSD>1e9||taxUSD>1e9)return null;
  const signature=[symbol,date,type,shares.toFixed(8),price.toFixed(8),currency].join('|');
  const externalId=sourceId(rawExternalId,identity,signature);
  const normalized={
    ...identity,externalId,rawExternalId,accountLabel:String(order?.accountLabel||'').trim().slice(0,64),symbol,name:String(order?.name||symbol).trim()||symbol,date,type,shares,price,currency,
    status,feeUSD,taxUSD,filledAmount:Math.max(0,n(execution.filledAmount??order?.filledAmount)),filledAt:String((execution.filledAt??order?.filledAt)||''),settlementDate:String((execution.settlementDate??order?.settlementDate)||''),
    sourceIdKind:rawExternalId?'source':'fingerprint',buyType:type==='buy'?'direct':'',reinvestAmountUSD:0,note:'토스 체결 승인 가져오기'
  };
  normalized.sourceFingerprint=orderVersionFingerprint(normalized);
  return normalized;
}

export function normalizeTossDividend(row) {
  const rawExternalId=orderIdOf(row),symbol=symbolOf(row?.symbol),date=dateOf(row?.date??row?.paidAt??row?.paymentDate),identity=tossIdentityOf(row);
  const grossAmountUSD=Math.max(0,n(row?.grossAmountUSD??row?.grossAmount)),withholdingTaxUSD=Math.max(0,n(row?.withholdingTaxUSD??row?.tax)),feeUSD=Math.max(0,n(row?.feeUSD??row?.fee));
  const explicitAmount=row?.amountUSD??row?.netAmountUSD??row?.netAmount??row?.amount;
  const amountUSD=Math.max(0,n(explicitAmount??(grossAmountUSD-withholdingTaxUSD-feeUSD)));
  const currency=String(row?.currency||'').toUpperCase();
  if(!symbol||!date||date>todayISO()||!['USD','KRW'].includes(currency)||amountUSD<=0||amountUSD>1e9||grossAmountUSD>1e9||withholdingTaxUSD>1e9||feeUSD>1e9)return null;
  const externalId=sourceId(rawExternalId,identity,[symbol,date,amountUSD.toFixed(8),currency].join('|'));
  const normalized={...identity,externalId,rawExternalId,sourceIdKind:rawExternalId?'source':'fingerprint',accountLabel:String(row?.accountLabel||'').trim().slice(0,64),symbol,name:String(row?.name||symbol).trim()||symbol,date,amountUSD,grossAmountUSD:grossAmountUSD||amountUSD+withholdingTaxUSD+feeUSD,withholdingTaxUSD,feeUSD,currency};
  normalized.sourceFingerprint=dividendVersionFingerprint(normalized);
  return normalized;
}

function normalizeTossOrderSource(order){
  const importable=normalizeTossOrder(order);if(importable)return {...importable,importable:true};
  const rawExternalId=orderIdOf(order),symbol=symbolOf(order?.symbol),identity=tossIdentityOf(order),execution=order?.execution||{};
  const date=dateOf(order?.date??execution.filledAt??order?.filledAt??order?.orderedAt),side=String(order?.type??order?.side??'').toUpperCase(),type=side==='SELL'?'sell':side==='BUY'?'buy':'',currency=String(order?.currency||'').toUpperCase();
  if(!rawExternalId||!symbol||!date||!type||!['USD','KRW'].includes(currency))return null;
  const normalized={...identity,externalId:sourceId(rawExternalId,identity,''),rawExternalId,symbol,date,type,currency,status:String(order?.status||'').toUpperCase().slice(0,32),shares:Math.max(0,n(execution.filledQuantity??order?.filledQuantity)),price:Math.max(0,n(execution.averageFilledPrice??order?.averageFilledPrice)),feeUSD:Math.max(0,n(execution.commission??order?.commission)),taxUSD:Math.max(0,n(execution.tax??order?.tax)),importable:false};
  normalized.sourceFingerprint=orderVersionFingerprint(normalized);
  return normalized;
}

export function mergeTossSourceLedger(current={},snapshot={},observedAt=new Date().toISOString()) {
  const revisionOf=row=>({observedAt,status:String(row?.status||''),date:String(row?.date||''),shares:Math.max(0,n(row?.shares)),price:Math.max(0,n(row?.price)),feeUSD:Math.max(0,n(row?.feeUSD)),taxUSD:Math.max(0,n(row?.taxUSD)),amountUSD:Math.max(0,n(row?.amountUSD)),sourceFingerprint:String(row?.sourceFingerprint||'')});
  const merge=(existing,incoming,normalizer)=>{
    const map=new Map((Array.isArray(existing)?existing:[]).filter(row=>row?.externalId).map(row=>[String(row.externalId),row]));
    for(const raw of Array.isArray(incoming)?incoming:[]){
      const row=normalizer(raw);if(!row)continue;
      const previous=map.get(row.externalId);
      const changed=!!(previous?.sourceFingerprint&&row.sourceFingerprint&&previous.sourceFingerprint!==row.sourceFingerprint);
      const revisions=changed?[...(Array.isArray(previous?.revisions)?previous.revisions:[]),revisionOf(previous)].slice(-10):(Array.isArray(previous?.revisions)?previous.revisions:[]);
      map.set(row.externalId,{...(previous||{}),...row,revisions,firstSeenAt:previous?.firstSeenAt||observedAt,lastSeenAt:observedAt,lastChangedAt:changed?observedAt:(previous?.lastChangedAt||''),revisionCount:Math.max(1,n(previous?.revisionCount)||1)+(changed?1:0)});
    }
    return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.externalId).localeCompare(String(b.externalId)));
  };
  return {
    orders:merge(current.orders,snapshot.orders,normalizeTossOrderSource),
    dividends:merge(current.dividends,snapshot.dividends,normalizeTossDividend)
  };
}

export function buildTossSync(snapshot, {existingTrades=[],existingDividends=[], appPositions=[]}={}) {
  const existingById=new Map();
  for(const row of existingTrades.filter(item=>item?.source?.provider==='toss'))for(const id of [row.source.externalId,row.source.rawExternalId].map(value=>String(value||'')).filter(Boolean))existingById.set(id,row);
  const manualBySignature=new Map();
  for(const trade of existingTrades.filter(row=>row?.source?.provider!=='toss')){
    const signature=tradeSignature(trade);if(signature)manualBySignature.set(signature,[...(manualBySignature.get(signature)||[]),trade.id]);
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
  const candidates=[],correctionCandidates=[];
  for(const raw of Array.isArray(snapshot?.orders)?snapshot.orders:[]) {
    const sourceRow=normalizeTossOrderSource(raw);
    const row=normalizeTossOrder(raw);
    if(!row){
      const existing=sourceRow&&(existingById.get(sourceRow.externalId)||existingById.get(sourceRow.rawExternalId));
      if(existing&&sourceRow.currency==='USD'){
        const previousFingerprint=existing.source?.sourceFingerprint||orderVersionFingerprint({...existing,status:existing.source?.status||'FILLED',currency:'USD',feeUSD:existing.feeUSD,taxUSD:existing.taxUSD});
        if(previousFingerprint!==sourceRow.sourceFingerprint)correctionCandidates.push({...sourceRow,existingRecordId:existing.id,previousFingerprint,changeType:'voided'});
      }else ignored.push({reason:sourceRow?'not-importable':'invalid'});
      continue;
    }
    if(row.currency!=='USD'){ignored.push({...row,reason:'currency'});continue;}
    if(seen.has(row.externalId))continue;
    seen.add(row.externalId);
    const existing=existingById.get(row.externalId)||existingById.get(row.rawExternalId);
    if(existing){
      const previousFingerprint=existing.source?.sourceFingerprint||orderVersionFingerprint({...existing,status:existing.source?.status||'FILLED',currency:'USD',feeUSD:existing.feeUSD,taxUSD:existing.taxUSD});
      if(previousFingerprint!==row.sourceFingerprint)correctionCandidates.push({...row,existingRecordId:existing.id,previousFingerprint,changeType:'changed'});
      continue;
    }
    const signature=tradeSignature(row),manualMatchIds=manualBySignature.get(signature)||[];
    if(manualMatchIds.length){matchedExistingCount++;manualBySignature.set(signature,manualMatchIds.slice(1));}
    candidates.push({...row,possibleManualDuplicate:manualMatchIds.length>0,manualMatchIds:manualMatchIds.slice(0,5)});
  }
  const existingDividendById=new Map();
  for(const row of existingDividends.filter(item=>item?.source?.provider==='toss'))for(const id of [row.source.externalId,row.source.rawExternalId].map(value=>String(value||'')).filter(Boolean))existingDividendById.set(id,row);
  const manualDividendBySignature=new Map();
  for(const dividend of existingDividends.filter(row=>row?.source?.provider!=='toss')){
    const signature=dividendSignature(dividend);if(signature)manualDividendBySignature.set(signature,[...(manualDividendBySignature.get(signature)||[]),dividend.id]);
  }
  const seenDividends=new Set(),dividendCandidates=[],dividendCorrectionCandidates=[];let matchedExistingDividendCount=0;
  for(const raw of Array.isArray(snapshot?.dividends)?snapshot.dividends:[]){
    const row=normalizeTossDividend(raw);
    if(!row){ignored.push({reason:'invalid-dividend'});continue;}
    if(row.currency!=='USD'){ignored.push({...row,reason:'currency'});continue;}
    if(seenDividends.has(row.externalId))continue;
    seenDividends.add(row.externalId);
    const existing=existingDividendById.get(row.externalId)||existingDividendById.get(row.rawExternalId);
    if(existing){
      const previousFingerprint=existing.source?.sourceFingerprint||dividendVersionFingerprint({...existing,currency:'USD'});
      if(previousFingerprint!==row.sourceFingerprint)dividendCorrectionCandidates.push({...row,existingRecordId:existing.id,previousFingerprint,changeType:'changed'});
      continue;
    }
    const signature=dividendSignature(row),manualMatchIds=manualDividendBySignature.get(signature)||[];
    if(manualMatchIds.length){matchedExistingDividendCount++;manualDividendBySignature.set(signature,manualMatchIds.slice(1));}
    dividendCandidates.push({...row,possibleManualDuplicate:manualMatchIds.length>0,manualMatchIds:manualMatchIds.slice(0,5)});
  }
  candidates.sort((a,b)=>a.date.localeCompare(b.date)||a.externalId.localeCompare(b.externalId));
  dividendCandidates.sort((a,b)=>a.date.localeCompare(b.date)||a.externalId.localeCompare(b.externalId));
  correctionCandidates.sort((a,b)=>a.date.localeCompare(b.date)||a.externalId.localeCompare(b.externalId));
  dividendCorrectionCandidates.sort((a,b)=>a.date.localeCompare(b.date)||a.externalId.localeCompare(b.externalId));
  return {
    accountLabel:String(snapshot?.accountLabel||'토스증권 계좌'),
    fetchedAt:String(snapshot?.fetchedAt||new Date().toISOString()),
    accountScopeId:String(snapshot?.accountScopeId||''),syncStatus:snapshot?.syncStatus==='partial'?'partial':'complete',syncCursor:snapshot?.syncCursor||{},accountResults:Array.isArray(snapshot?.accountResults)?snapshot.accountResults:[],capabilities:snapshot?.capabilities||{},failedAccountCount:Math.max(0,n(snapshot?.failedAccountCount)),
    holdings,prices,comparisons,candidates,dividendCandidates,correctionCandidates,dividendCorrectionCandidates,
    ignoredCount:ignored.length,matchedExistingCount,matchedExistingDividendCount,historyTruncated:!!snapshot?.historyTruncated,
    unsupportedCurrencyCount:ignored.filter(row=>row.reason==='currency').length
  };
}

export function mergeTossCandidates(current=[], incoming=[]) {
  const map=new Map();
  for(const raw of [...current,...incoming]) {
    const row=normalizeTossOrder(raw),id=String(row?.externalId||'');
    if(row?.currency==='USD'&&id)map.set(id,{...(map.get(id)||{}),...raw,...row});
  }
  return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.externalId).localeCompare(String(b.externalId)));
}

export function mergeTossCorrectionCandidates(current=[],incoming=[]){
  const map=new Map();
  for(const raw of [...current,...incoming]){
    const row=normalizeTossOrderSource(raw),id=String(row?.externalId||'');
    if(row?.currency==='USD'&&id)map.set(id,{...(map.get(id)||{}),...raw,...row,existingRecordId:raw?.existingRecordId||map.get(id)?.existingRecordId||''});
  }
  return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.externalId).localeCompare(String(b.externalId)));
}

export function mergeTossDividendCandidates(current=[],incoming=[]){
  const map=new Map();
  for(const raw of [...current,...incoming]){
    const row=normalizeTossDividend(raw),id=String(row?.externalId||'');
    if(row?.currency==='USD'&&id)map.set(id,{...(map.get(id)||{}),...raw,...row});
  }
  return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.externalId).localeCompare(String(b.externalId)));
}

export function tossCandidateToTrade(candidate,{projectId,id,createdAt=new Date().toISOString()}={}) {
  const row=normalizeTossOrder(candidate);
  if(!row||row.currency!=='USD'||!projectId||!id)return null;
  return {
    id,projectId,symbol:row.symbol,date:row.date,type:row.type,buyType:row.buyType,
    shares:row.shares,price:row.price,feeUSD:row.feeUSD,taxUSD:row.taxUSD,reinvestAmountUSD:0,note:row.note,createdAt,
    source:{provider:'toss',externalId:row.externalId,rawExternalId:row.rawExternalId,sourceIdKind:row.sourceIdKind,sourceFingerprint:row.sourceFingerprint,status:row.status,accountId:row.accountId,assetKey:row.assetKey,market:row.market,securityId:row.securityId,importedAt:createdAt}
  };
}


export function tossCandidateToDividend(candidate,{projectId,id,sharesAtPayment=0,createdAt=new Date().toISOString()}={}){
  const row=normalizeTossDividend(candidate);
  if(!row||row.currency!=='USD'||!projectId||!id)return null;
  return {
    id,projectId,symbol:row.symbol,date:row.date,amountUSD:row.amountUSD,grossAmountUSD:row.grossAmountUSD,withholdingTaxUSD:row.withholdingTaxUSD,feeUSD:row.feeUSD,sharesAtPayment:Math.max(0,n(sharesAtPayment)),
    referencePrice:0,rocPercent:null,rocStatus:'estimated',note:'토스 배당 승인 가져오기',createdAt,
    source:{provider:'toss',externalId:row.externalId,rawExternalId:row.rawExternalId,sourceIdKind:row.sourceIdKind,sourceFingerprint:row.sourceFingerprint,accountId:row.accountId,assetKey:row.assetKey,market:row.market,securityId:row.securityId,importedAt:createdAt}
  };
}

export function nextTossSyncFrom(toss={},fallback='2020-01-01',overlapDays=14){
  const cursor=dateOf(toss?.syncCursor?.ordersThrough)||dateOf(toss?.lastSuccessfulAt);
  if(!cursor)return dateOf(fallback)||'2020-01-01';
  const date=new Date(`${cursor}T12:00:00Z`);date.setUTCDate(date.getUTCDate()-Math.max(1,Math.min(90,n(overlapDays)||14)));
  const candidate=date.toISOString().slice(0,10),minimum=dateOf(fallback)||'2020-01-01';
  return candidate<minimum?minimum:candidate;
}

export function accountScopeChanged(previous,next){return !!(previous&&next&&String(previous)!==String(next));}

export function tossSyncProgress(previous={},result={}){
  const complete=result.syncStatus==='complete',accountsComplete=Math.max(0,n(result.failedAccountCount))===0;
  return {syncCursor:accountsComplete?(result.syncCursor||previous.syncCursor||{}):(previous.syncCursor||{}),lastSuccessfulAt:complete?String(result.fetchedAt||''):String(previous.lastSuccessfulAt||''),lastPartialAt:complete?String(previous.lastPartialAt||''):String(result.fetchedAt||previous.lastPartialAt||'')};
}

export function disconnectedTossState(toss={}){
  return {...toss,status:'not_connected',lastError:'',accountLabel:'',holdings:[],comparisons:[],candidates:[],dividendCandidates:[],correctionCandidates:[],dividendCorrectionCandidates:[],accountResults:[],failedAccountCount:0};
}
