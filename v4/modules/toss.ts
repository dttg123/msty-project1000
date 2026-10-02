import { isDate, n, todayISO, uid } from './utils.js';

const SYMBOL_PATTERN: any = /^[A-Z0-9.-]{1,16}$/;

function symbolOf(value: any): any {
  const symbol: any=String(value||'').trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol)?symbol:'';
}

function dateOf(value: any): any {
  const text: any=String(value||'');
  const match: any=text.match(/^\d{4}-\d{2}-\d{2}/);
  return match&&isDate(match[0])?match[0]:'';
}

function orderIdOf(order: any): any {
  const source: any=order&&Object.hasOwn(order,'rawExternalId')?order.rawExternalId:(order?.externalId||order?.orderId||order?.id||'');
  const value: any=String(source||'').trim();
  return value.length<=256?value:'';
}

function fingerprint(value: any): any {
  let hash: any=14695981039346656037n;
  for(const char of String(value)){hash^=BigInt(char.codePointAt(0)??0);hash=BigInt.asUintN(64,hash*1099511628211n);}
  return hash.toString(16).padStart(16,'0');
}

function sourceId(rawExternalId: any,identity: any,signature: any): any {
  const base: any=rawExternalId||`fp-${fingerprint([identity.accountId,identity.instrumentKey,signature].join('|'))}`;
  return identity.accountId?`${identity.accountId}:${base}`:base;
}

function accountIdOf(row: any): any {
  return String(row?.accountId??row?.accountSeq??'').trim().slice(0,128);
}

function marketOf(row: any): any {
  return String(row?.market??row?.exchange??row?.exchangeCode??'').trim().toUpperCase().slice(0,32);
}

function securityIdOf(row: any): any {
  return String(row?.securityId??row?.instrumentId??row?.stockCode??row?.productCode??row?.isin??'').trim().toUpperCase().slice(0,64);
}

export function tossIdentityOf(row: any): any {
  const symbol: any=symbolOf(row?.symbol),currency=String(row?.currency||'').toUpperCase(),market=marketOf(row),securityId=securityIdOf(row),accountId=accountIdOf(row);
  const instrumentKey: any=securityId?`${market||'UNKNOWN'}:${securityId}`:`${market||'UNKNOWN'}:${symbol}:${currency||'UNKNOWN'}`;
  return {accountId,market,securityId,instrumentKey,assetKey:`toss:${instrumentKey}`};
}

function tradeSignature(row: any): any {
  const symbol: any=symbolOf(row?.symbol),date=dateOf(row?.date),type=String(row?.type||'').toLowerCase();
  const shares: any=Math.max(0,n(row?.shares)),price=Math.max(0,n(row?.price));
  if(!symbol||!date||!['buy','sell'].includes(type)||shares<=0||price<=0)return '';
  return [symbol,date,type,shares.toFixed(8),price.toFixed(4)].join('|');
}

function dividendSignature(row: any): any {
  const symbol: any=symbolOf(row?.symbol),date=dateOf(row?.date),amount=Math.max(0,n(row?.amountUSD));
  if(!symbol||!date||amount<=0)return '';
  return [symbol,date,amount.toFixed(2)].join('|');
}

function orderVersionFingerprint(row: any): any {
  return fingerprint([row?.status,row?.symbol,row?.date,row?.type,n(row?.shares).toFixed(8),n(row?.price).toFixed(8),n(row?.feeUSD).toFixed(8),n(row?.taxUSD).toFixed(8),row?.currency].join('|'));
}

function dividendVersionFingerprint(row: any): any {
  return fingerprint([row?.symbol,row?.date,n(row?.amountUSD).toFixed(8),n(row?.grossAmountUSD).toFixed(8),n(row?.withholdingTaxUSD).toFixed(8),n(row?.feeUSD).toFixed(8),row?.currency].join('|'));
}

export function normalizeTossHolding(row: any): any {
  const symbol: any=symbolOf(row?.symbol);
  if(!symbol)return null;
  const identity: any=tossIdentityOf(row);
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

export function normalizeTossPrice(row: any): any {
  const symbol: any=symbolOf(row?.symbol),currency=String(row?.currency||'').toUpperCase(),lastPrice=Math.max(0,n(row?.lastPrice));
  if(!symbol||!currency||lastPrice<=0)return null;
  return {...tossIdentityOf(row),symbol,currency,lastPrice,timestamp:String(row?.timestamp||'')};
}

export function normalizeTossOrder(order: any): any {
  const execution: any=order?.execution||{};
  const rawExternalId: any=orderIdOf(order),symbol=symbolOf(order?.symbol),identity=tossIdentityOf(order);
  const shares: any=Math.max(0,n(order?.shares??execution.filledQuantity??order?.filledQuantity));
  const price: any=Math.max(0,n(order?.priceFilled??execution.averageFilledPrice??order?.averageFilledPrice??order?.price));
  const date: any=dateOf(order?.date??execution.filledAt??order?.filledAt??order?.orderedAt);
  const side: any=String(order?.type??order?.side??'').toUpperCase();
  const type: any=side==='SELL'||side==='매도'?'sell':side==='BUY'||side==='매수'?'buy':'';
  const currency: any=String(order?.currency||'').toUpperCase();
  const feeUSD: any=Math.max(0,n(order?.feeUSD??execution.commission??order?.commission)),taxUSD=Math.max(0,n(order?.taxUSD??execution.tax??order?.tax));
  const status: any=String(order?.status||'FILLED').trim().toUpperCase().slice(0,32);
  if(!symbol||!date||date>todayISO()||!type||!['USD','KRW'].includes(currency)||shares<=0||shares>1e9||price<=0||price>1e9||feeUSD>1e9||taxUSD>1e9)return null;
  const signature: any=[symbol,date,type,shares.toFixed(8),price.toFixed(8),currency].join('|');
  const externalId: any=sourceId(rawExternalId,identity,signature);
  const normalized: any={
    ...identity,externalId,rawExternalId,accountLabel:String(order?.accountLabel||'').trim().slice(0,64),symbol,name:String(order?.name||symbol).trim()||symbol,date,type,shares,price,currency,
    status,feeUSD,taxUSD,filledAmount:Math.max(0,n(execution.filledAmount??order?.filledAmount)),filledAt:String((execution.filledAt??order?.filledAt)||''),settlementDate:String((execution.settlementDate??order?.settlementDate)||''),
    sourceIdKind:rawExternalId?'source':'fingerprint',buyType:type==='buy'?'direct':'',reinvestAmountUSD:0,note:'토스 체결 승인 가져오기'
  };
  normalized.sourceFingerprint=orderVersionFingerprint(normalized);
  return normalized;
}

export function normalizeTossDividend(row: any): any {
  const rawExternalId: any=orderIdOf(row),symbol=symbolOf(row?.symbol),date=dateOf(row?.date??row?.paidAt??row?.paymentDate),identity=tossIdentityOf(row);
  const grossAmountUSD: any=Math.max(0,n(row?.grossAmountUSD??row?.grossAmount)),withholdingTaxUSD=Math.max(0,n(row?.withholdingTaxUSD??row?.tax)),feeUSD=Math.max(0,n(row?.feeUSD??row?.fee));
  const explicitAmount: any=row?.amountUSD??row?.netAmountUSD??row?.netAmount??row?.amount;
  const amountUSD: any=Math.max(0,n(explicitAmount??(grossAmountUSD-withholdingTaxUSD-feeUSD)));
  const currency: any=String(row?.currency||'').toUpperCase();
  if(!symbol||!date||date>todayISO()||!['USD','KRW'].includes(currency)||amountUSD<=0||amountUSD>1e9||grossAmountUSD>1e9||withholdingTaxUSD>1e9||feeUSD>1e9)return null;
  const externalId: any=sourceId(rawExternalId,identity,[symbol,date,amountUSD.toFixed(8),currency].join('|'));
  const normalized: any={...identity,externalId,rawExternalId,sourceIdKind:rawExternalId?'source':'fingerprint',accountLabel:String(row?.accountLabel||'').trim().slice(0,64),symbol,name:String(row?.name||symbol).trim()||symbol,date,amountUSD,grossAmountUSD:grossAmountUSD||amountUSD+withholdingTaxUSD+feeUSD,withholdingTaxUSD,feeUSD,currency};
  normalized.sourceFingerprint=dividendVersionFingerprint(normalized);
  return normalized;
}

function normalizeTossOrderSource(order: any): any{
  const importable: any=normalizeTossOrder(order);if(importable)return {...importable,importable:true};
  const rawExternalId: any=orderIdOf(order),symbol=symbolOf(order?.symbol),identity=tossIdentityOf(order),execution=order?.execution||{};
  const date: any=dateOf(order?.date??execution.filledAt??order?.filledAt??order?.orderedAt),side=String(order?.type??order?.side??'').toUpperCase(),type=side==='SELL'?'sell':side==='BUY'?'buy':'',currency=String(order?.currency||'').toUpperCase();
  if(!rawExternalId||!symbol||!date||!type||!['USD','KRW'].includes(currency))return null;
  const normalized: any={...identity,externalId:sourceId(rawExternalId,identity,''),rawExternalId,symbol,date,type,currency,status:String(order?.status||'').toUpperCase().slice(0,32),shares:Math.max(0,n(execution.filledQuantity??order?.filledQuantity)),price:Math.max(0,n(execution.averageFilledPrice??order?.averageFilledPrice)),feeUSD:Math.max(0,n(execution.commission??order?.commission)),taxUSD:Math.max(0,n(execution.tax??order?.tax)),importable:false};
  normalized.sourceFingerprint=orderVersionFingerprint(normalized);
  return normalized;
}

export function mergeTossSourceLedger(current: any={},snapshot: any={},observedAt: any=new Date().toISOString()): any {
  const revisionOf: any=(row: any)=>({observedAt,status:String(row?.status||''),date:String(row?.date||''),shares:Math.max(0,n(row?.shares)),price:Math.max(0,n(row?.price)),feeUSD:Math.max(0,n(row?.feeUSD)),taxUSD:Math.max(0,n(row?.taxUSD)),amountUSD:Math.max(0,n(row?.amountUSD)),sourceFingerprint:String(row?.sourceFingerprint||'')});
  const merge: any=(existing: any,incoming: any,normalizer: any)=>{
    const map: any=new Map((Array.isArray(existing)?existing:[]).filter(row=>row?.externalId).map(row=>[String(row.externalId),row]));
    for(const raw of Array.isArray(incoming)?incoming:[]){
      const row: any=normalizer(raw);if(!row)continue;
      const previous: any=map.get(row.externalId);
      const changed: any=!!(previous?.sourceFingerprint&&row.sourceFingerprint&&previous.sourceFingerprint!==row.sourceFingerprint);
      const revisions: any=changed?[...(Array.isArray(previous?.revisions)?previous.revisions:[]),revisionOf(previous)].slice(-10):(Array.isArray(previous?.revisions)?previous.revisions:[]);
      map.set(row.externalId,{...(previous||{}),...row,revisions,firstSeenAt:previous?.firstSeenAt||observedAt,lastSeenAt:observedAt,lastChangedAt:changed?observedAt:(previous?.lastChangedAt||''),revisionCount:Math.max(1,n(previous?.revisionCount)||1)+(changed?1:0)});
    }
    return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.externalId).localeCompare(String(b.externalId)));
  };
  return {
    orders:merge(current.orders,snapshot.orders,normalizeTossOrderSource),
    dividends:merge(current.dividends,snapshot.dividends,normalizeTossDividend)
  };
}

export function buildTossSync(snapshot: any, {existingTrades=[],existingDividends=[], appPositions=[]}: any ={}): any {
  const existingById: any=new Map();
  for(const row of existingTrades.filter((item: any)=>item?.source?.provider==='toss'))for(const id of [row.source.externalId,row.source.rawExternalId].map(value=>String(value||'')).filter(Boolean))existingById.set(id,row);
  const manualBySignature: any=new Map();
  for(const trade of existingTrades.filter((row: any)=>row?.source?.provider!=='toss')){
    const signature: any=tradeSignature(trade);if(signature)manualBySignature.set(signature,[...(manualBySignature.get(signature)||[]),trade.id]);
  }
  const normalizedHoldings: any=(Array.isArray(snapshot?.holdings)?snapshot.holdings:[]).map(normalizeTossHolding).filter(Boolean);
  const holdingMap: any=new Map();
  for(const row of normalizedHoldings){
    const previous: any=holdingMap.get(row.assetKey);
    if(previous){previous.shares+=row.shares;previous.marketValue+=row.marketValue;previous.accounts=[...new Set([...previous.accounts,row.accountId].filter(Boolean))];}
    else holdingMap.set(row.assetKey,{...row,accounts:row.accountId?[row.accountId]:[]});
  }
  const holdings: any=[...holdingMap.values()];
  const prices: any=(Array.isArray(snapshot?.prices)?snapshot.prices:[]).map(normalizeTossPrice).filter(Boolean);
  const appMap: any=new Map();
  for(const row of appPositions){const key: any=String(row?.assetKey||'');if(key)appMap.set(key,Math.max(0,n(row.shares)));else appMap.set(`symbol:${symbolOf(row.symbol)}`,Math.max(0,n(row.shares)));}
  const comparisons: any=holdings.map((row: any)=>({
    ...row,
    appShares:appMap.get(row.assetKey)??appMap.get(`symbol:${row.symbol}`)??0,
    difference:row.shares-(appMap.get(row.assetKey)??appMap.get(`symbol:${row.symbol}`)??0),
    supported:row.currency==='USD'
  }));
  const seen: any=new Set(),ignored=[];let matchedExistingCount: any=0;
  const candidates: any=[],correctionCandidates=[];
  for(const raw of Array.isArray(snapshot?.orders)?snapshot.orders:[]) {
    const sourceRow: any=normalizeTossOrderSource(raw);
    const row: any=normalizeTossOrder(raw);
    if(!row){
      const existing: any=sourceRow&&(existingById.get(sourceRow.externalId)||existingById.get(sourceRow.rawExternalId));
      if(existing&&sourceRow.currency==='USD'){
        const previousFingerprint: any=existing.source?.sourceFingerprint||orderVersionFingerprint({...existing,status:existing.source?.status||'FILLED',currency:'USD',feeUSD:existing.feeUSD,taxUSD:existing.taxUSD});
        if(previousFingerprint!==sourceRow.sourceFingerprint)correctionCandidates.push({...sourceRow,existingRecordId:existing.id,previousFingerprint,changeType:'voided'});
      }else ignored.push({reason:sourceRow?'not-importable':'invalid'});
      continue;
    }
    if(row.currency!=='USD'){ignored.push({...row,reason:'currency'});continue;}
    if(seen.has(row.externalId))continue;
    seen.add(row.externalId);
    const existing: any=existingById.get(row.externalId)||existingById.get(row.rawExternalId);
    if(existing){
      const previousFingerprint: any=existing.source?.sourceFingerprint||orderVersionFingerprint({...existing,status:existing.source?.status||'FILLED',currency:'USD',feeUSD:existing.feeUSD,taxUSD:existing.taxUSD});
      if(previousFingerprint!==row.sourceFingerprint)correctionCandidates.push({...row,existingRecordId:existing.id,previousFingerprint,changeType:'changed'});
      continue;
    }
    const signature: any=tradeSignature(row),manualMatchIds=manualBySignature.get(signature)||[];
    if(manualMatchIds.length){matchedExistingCount++;manualBySignature.set(signature,manualMatchIds.slice(1));}
    candidates.push({...row,possibleManualDuplicate:manualMatchIds.length>0,manualMatchIds:manualMatchIds.slice(0,5)});
  }
  const existingDividendById: any=new Map();
  for(const row of existingDividends.filter((item: any)=>item?.source?.provider==='toss'))for(const id of [row.source.externalId,row.source.rawExternalId].map(value=>String(value||'')).filter(Boolean))existingDividendById.set(id,row);
  const manualDividendBySignature: any=new Map();
  for(const dividend of existingDividends.filter((row: any)=>row?.source?.provider!=='toss')){
    const signature: any=dividendSignature(dividend);if(signature)manualDividendBySignature.set(signature,[...(manualDividendBySignature.get(signature)||[]),dividend.id]);
  }
  const seenDividends: any=new Set(),dividendCandidates=[],dividendCorrectionCandidates=[];let matchedExistingDividendCount: any=0;
  for(const raw of Array.isArray(snapshot?.dividends)?snapshot.dividends:[]){
    const row: any=normalizeTossDividend(raw);
    if(!row){ignored.push({reason:'invalid-dividend'});continue;}
    if(row.currency!=='USD'){ignored.push({...row,reason:'currency'});continue;}
    if(seenDividends.has(row.externalId))continue;
    seenDividends.add(row.externalId);
    const existing: any=existingDividendById.get(row.externalId)||existingDividendById.get(row.rawExternalId);
    if(existing){
      const previousFingerprint: any=existing.source?.sourceFingerprint||dividendVersionFingerprint({...existing,currency:'USD'});
      if(previousFingerprint!==row.sourceFingerprint)dividendCorrectionCandidates.push({...row,existingRecordId:existing.id,previousFingerprint,changeType:'changed'});
      continue;
    }
    const signature: any=dividendSignature(row),manualMatchIds=manualDividendBySignature.get(signature)||[];
    if(manualMatchIds.length){matchedExistingDividendCount++;manualDividendBySignature.set(signature,manualMatchIds.slice(1));}
    dividendCandidates.push({...row,possibleManualDuplicate:manualMatchIds.length>0,manualMatchIds:manualMatchIds.slice(0,5)});
  }
  candidates.sort((a: any,b: any)=>a.date.localeCompare(b.date)||a.externalId.localeCompare(b.externalId));
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

export function mergeTossCandidates(current: any =[], incoming: any =[]): any {
  const map: any=new Map();
  for(const raw of [...current,...incoming]) {
    const row: any=normalizeTossOrder(raw),id=String(row?.externalId||'');
    if(row?.currency==='USD'&&id)map.set(id,{...(map.get(id)||{}),...raw,...row});
  }
  return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.externalId).localeCompare(String(b.externalId)));
}

export function mergeTossCorrectionCandidates(current: any =[],incoming: any =[]): any{
  const map: any=new Map();
  for(const raw of [...current,...incoming]){
    const row: any=normalizeTossOrderSource(raw),id=String(row?.externalId||'');
    if(row?.currency==='USD'&&id)map.set(id,{...(map.get(id)||{}),...raw,...row,existingRecordId:raw?.existingRecordId||map.get(id)?.existingRecordId||''});
  }
  return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.externalId).localeCompare(String(b.externalId)));
}

export function mergeTossDividendCandidates(current: any =[],incoming: any =[]): any{
  const map: any=new Map();
  for(const raw of [...current,...incoming]){
    const row: any=normalizeTossDividend(raw),id=String(row?.externalId||'');
    if(row?.currency==='USD'&&id)map.set(id,{...(map.get(id)||{}),...raw,...row});
  }
  return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.externalId).localeCompare(String(b.externalId)));
}

export function tossCandidateToTrade(candidate: any,{projectId,id,createdAt=new Date().toISOString()}: any={}): any {
  const row: any=normalizeTossOrder(candidate);
  if(!row||row.currency!=='USD'||!projectId||!id)return null;
  return {
    id,projectId,symbol:row.symbol,date:row.date,type:row.type,buyType:row.buyType,
    shares:row.shares,price:row.price,feeUSD:row.feeUSD,taxUSD:row.taxUSD,reinvestAmountUSD:0,note:row.note,createdAt,
    source:{provider:'toss',externalId:row.externalId,rawExternalId:row.rawExternalId,sourceIdKind:row.sourceIdKind,sourceFingerprint:row.sourceFingerprint,status:row.status,accountId:row.accountId,assetKey:row.assetKey,market:row.market,securityId:row.securityId,importedAt:createdAt}
  };
}


export function tossCandidateToDividend(candidate: any,{projectId,id,sharesAtPayment=0,createdAt=new Date().toISOString()}: any={}): any{
  const row: any=normalizeTossDividend(candidate);
  if(!row||row.currency!=='USD'||!projectId||!id)return null;
  return {
    id,projectId,symbol:row.symbol,date:row.date,amountUSD:row.amountUSD,grossAmountUSD:row.grossAmountUSD,withholdingTaxUSD:row.withholdingTaxUSD,feeUSD:row.feeUSD,sharesAtPayment:Math.max(0,n(sharesAtPayment)),
    referencePrice:0,rocPercent:null,rocStatus:'estimated',note:'토스 배당 승인 가져오기',createdAt,
    source:{provider:'toss',externalId:row.externalId,rawExternalId:row.rawExternalId,sourceIdKind:row.sourceIdKind,sourceFingerprint:row.sourceFingerprint,accountId:row.accountId,assetKey:row.assetKey,market:row.market,securityId:row.securityId,importedAt:createdAt}
  };
}

export function rebuildProjectFromTossSource({project,sourceLedger,currentTrades=[],currentDividends=[],capabilities={},syncStatus='',failedAccountCount=0,historyTruncated=false,makeId=uid,createdAt=new Date().toISOString(),sharesAtDate=()=>0}: any={}): any{
  if(!project?.id||!symbolOf(project.symbol))return {ok:false,reason:'project'};
  if(syncStatus!=='complete'||Math.max(0,n(failedAccountCount))>0)return {ok:false,reason:'partial'};
  if(historyTruncated)return {ok:false,reason:'truncated'};
  const symbol: any=symbolOf(project.symbol);
  const unique: any=(rows: any,normalizer: any)=>{
    const map: any=new Map();
    for(const raw of Array.isArray(rows)?rows:[]){
      const row: any=normalizer(raw);
      if(row?.symbol===symbol&&row.currency==='USD'&&row.externalId)map.set(row.externalId,row);
    }
    return [...map.values()].sort((a: any,b: any)=>a.date.localeCompare(b.date)||a.externalId.localeCompare(b.externalId));
  };
  const orders: any=unique(sourceLedger?.orders,normalizeTossOrder);
  if(!orders.length)return {ok:false,reason:'empty-orders'};
  const rebuiltTrades: any=orders.map((row: any)=>tossCandidateToTrade(row,{projectId:project.id,id:makeId('t'),createdAt})).filter(Boolean);
  const projectTrades: any=currentTrades.filter((row: any)=>row.projectId===project.id);
  const keepTrades: any=currentTrades.filter((row: any)=>row.projectId!==project.id);
  const dividendSourceSupported: any=capabilities?.dividends===true;
  const projectDividends: any=currentDividends.filter((row: any)=>row.projectId===project.id);
  const keepDividends: any=currentDividends.filter((row: any)=>row.projectId!==project.id);
  let rebuiltDividends: any=projectDividends;
  if(dividendSourceSupported){
    const rows: any=unique(sourceLedger?.dividends,normalizeTossDividend);
    rebuiltDividends=rows.map((row: any)=>tossCandidateToDividend(row,{projectId:project.id,id:makeId('d'),sharesAtPayment:Math.max(0,n(sharesAtDate(row.date))),createdAt})).filter(Boolean);
  }
  return {
    ok:true,reason:'',trades:[...keepTrades,...rebuiltTrades],dividends:[...keepDividends,...rebuiltDividends],
    importedTrades:rebuiltTrades.length,replacedTrades:projectTrades.length,
    importedDividends:dividendSourceSupported?rebuiltDividends.length:0,replacedDividends:dividendSourceSupported?projectDividends.length:0,
    preservedDividends:dividendSourceSupported?0:projectDividends.length,dividendSourceSupported
  };
}

export function nextTossSyncFrom(toss: any ={},fallback: any ='2020-01-01',overlapDays: any =14): any{
  const cursor: any=dateOf(toss?.syncCursor?.ordersThrough)||dateOf(toss?.lastSuccessfulAt);
  if(!cursor)return dateOf(fallback)||'2020-01-01';
  const date: any=new Date(`${cursor}T12:00:00Z`);date.setUTCDate(date.getUTCDate()-Math.max(1,Math.min(90,n(overlapDays)||14)));
  const candidate: any=date.toISOString().slice(0,10),minimum=dateOf(fallback)||'2020-01-01';
  return candidate<minimum?minimum:candidate;
}

export function accountScopeChanged(previous: any,next: any): any{return !!(previous&&next&&String(previous)!==String(next));}

export function tossSyncProgress(previous: any ={},result: any ={}): any{
  const complete: any=result.syncStatus==='complete',accountsComplete=Math.max(0,n(result.failedAccountCount))===0;
  return {syncCursor:accountsComplete?(result.syncCursor||previous.syncCursor||{}):(previous.syncCursor||{}),lastSuccessfulAt:complete?String(result.fetchedAt||''):String(previous.lastSuccessfulAt||''),lastPartialAt:complete?String(previous.lastPartialAt||''):String(result.fetchedAt||previous.lastPartialAt||'')};
}

export function automaticTossImportPlan(toss: any ={}): any{
  const candidates: any=Array.isArray(toss.candidates)?toss.candidates:[];
  const dividendCandidates: any=Array.isArray(toss.dividendCandidates)?toss.dividendCandidates:[];
  const corrections: any=[...(Array.isArray(toss.correctionCandidates)?toss.correctionCandidates:[]),...(Array.isArray(toss.dividendCorrectionCandidates)?toss.dividendCorrectionCandidates:[])];
  const total: any=candidates.length+dividendCandidates.length;
  if(toss.syncStatus!=='complete'||Math.max(0,n(toss.failedAccountCount))>0)return {eligible:false,reason:'partial',candidates,dividendCandidates};
  if(toss.historyTruncated)return {eligible:false,reason:'truncated',candidates,dividendCandidates};
  if(corrections.length)return {eligible:false,reason:'correction',candidates,dividendCandidates};
  if(!total)return {eligible:false,reason:'empty',candidates,dividendCandidates};
  // Existing manual matches stay pending; they must not block unrelated new receipts.
  // The caller still validates chronology and reconciles the resulting holdings before saving.
  const newTrades=candidates.filter((row: any)=>!row?.possibleManualDuplicate);
  const newDividends=dividendCandidates.filter((row: any)=>!row?.possibleManualDuplicate);
  if(!newTrades.length&&!newDividends.length)return {eligible:false,reason:'duplicate',candidates:[],dividendCandidates:[]};
  return {eligible:true,reason:'',candidates:newTrades,dividendCandidates:newDividends};
}

export function refreshTossCandidateConflicts(toss: any ={},existingTrades: any[]=[],existingDividends: any[]=[]): any{
  const manualTradeIds: any=new Set(existingTrades.filter((row: any)=>row?.source?.provider!=='toss').map((row: any)=>String(row?.id||'')).filter(Boolean));
  const manualDividendIds: any=new Set(existingDividends.filter((row: any)=>row?.source?.provider!=='toss').map((row: any)=>String(row?.id||'')).filter(Boolean));
  const refresh: any=(rows: any,ids: any)=>(Array.isArray(rows)?rows:[]).map((row: any)=>{
    const matches: any=(Array.isArray(row?.manualMatchIds)?row.manualMatchIds:[]).map(String).filter((id: any)=>ids.has(id));
    return {...row,possibleManualDuplicate:matches.length>0,manualMatchIds:matches};
  });
  toss.candidates=refresh(toss.candidates,manualTradeIds);
  toss.dividendCandidates=refresh(toss.dividendCandidates,manualDividendIds);
  return toss;
}

export function automaticTossDividendAdoptions(candidates: any=[]): any{
  const used: any=new Set(),adoptions=[];
  for(const row of Array.isArray(candidates)?candidates:[]){
    const matches: any=Array.isArray(row?.manualMatchIds)?row.manualMatchIds.filter(Boolean):[];
    if(!row?.possibleManualDuplicate||matches.length!==1||used.has(matches[0]))continue;
    used.add(matches[0]);adoptions.push({candidate:row,manualId:matches[0]});
  }
  return adoptions;
}

export function disconnectedTossState(toss: any ={}): any{
  return {...toss,status:'not_connected',lastError:'',accountLabel:'',holdings:[],comparisons:[],candidates:[],dividendCandidates:[],correctionCandidates:[],dividendCorrectionCandidates:[],accountResults:[],failedAccountCount:0};
}

export const TOSS_EXCEPTION_FIELDS = ['candidates','dividendCandidates','correctionCandidates','dividendCorrectionCandidates'] as const;
export function tossExceptionKey(field: string,row: any,scope: string=''): string {
  return JSON.stringify([scope,field,String(row?.externalId||''),String(row?.sourceFingerprint||'')]);
}
export function filterDismissedTossExceptions(toss: any,keys: string[]=toss.dismissedExceptionKeys||[]): any {
  const dismissed=new Set(keys),result={...toss};
  for(const field of TOSS_EXCEPTION_FIELDS)result[field]=(toss[field]||[]).filter((row: any)=>!dismissed.has(tossExceptionKey(field,row,toss.accountScopeId||'')));
  return result;
}
export function dismissTossExceptions(toss: any,selectedKeys: string[]): any {
  const available=new Set(TOSS_EXCEPTION_FIELDS.flatMap(field=>(toss[field]||[]).map((row: any)=>tossExceptionKey(field,row,toss.accountScopeId||''))));
  const dismissedExceptionKeys=[...new Set([...(toss.dismissedExceptionKeys||[]),...selectedKeys.filter(key=>available.has(key))])];
  return filterDismissedTossExceptions({...toss,dismissedExceptionKeys});
}
