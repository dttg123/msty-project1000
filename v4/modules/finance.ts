import type { DividendCashBreakdown, DividendRecord, DividendStatus, Trade, TradeCashBreakdown } from '../types/domain.js';

const finiteNonNegative=(value:unknown):number=>{
  const parsed=typeof value==='number'?value:Number(value);
  return Number.isFinite(parsed)&&parsed>0?parsed:0;
};

export function tradeCashBreakdown(trade:Trade):TradeCashBreakdown {
  const shares=finiteNonNegative(trade.shares),price=finiteNonNegative(trade.price),executionAmountUSD=shares*price;
  const feeUSD=finiteNonNegative(trade.feeUSD),taxUSD=finiteNonNegative(trade.taxUSD);
  return {executionAmountUSD,feeUSD,taxUSD,grossBuyCostUSD:trade.type==='buy'?executionAmountUSD+feeUSD+taxUSD:0,netSellProceedsUSD:trade.type==='sell'?Math.max(0,executionAmountUSD-feeUSD-taxUSD):0};
}

export function dividendCashBreakdown(record:DividendRecord):DividendCashBreakdown {
  const status:DividendStatus=record.status==='confirmed'||record.status==='estimated'?record.status:'actual';
  if(record.currency==='KRW')return {grossUSD:0,withholdingTaxUSD:0,feeUSD:0,netUSD:0,netKRW:finiteNonNegative(record.amountKRW),rocUSD:0,incomeUSD:0,status};
  const legacyNet=finiteNonNegative(record.amountUSD),tax=finiteNonNegative(record.withholdingTaxUSD??record.taxUSD),fee=finiteNonNegative(record.feeUSD);
  const explicitGross=finiteNonNegative(record.grossAmountUSD),explicitNet=finiteNonNegative(record.netAmountUSD);
  const grossUSD=explicitGross||(explicitNet?explicitNet+tax+fee:legacyNet+tax+fee);
  const netUSD=explicitNet||legacyNet||Math.max(0,grossUSD-tax-fee);
  const explicitRoc=finiteNonNegative(record.rocAmountUSD),rocPercent=Math.min(100,finiteNonNegative(record.rocPercent));
  const rocUSD=Math.min(netUSD,explicitRoc||(rocPercent>0?netUSD*rocPercent/100:0));
  return {grossUSD,withholdingTaxUSD:tax,feeUSD:fee,netUSD,rocUSD,incomeUSD:Math.max(0,netUSD-rocUSD),status};
}

export function isPostedDividend(record:DividendRecord,asOf:string):boolean {
  const cash=dividendCashBreakdown(record);
  return record.date<=asOf&&cash.status==='actual'&&(cash.netUSD>0||(cash.netKRW||0)>0);
}

// View-only conversion: never persist a fabricated USD receipt or fund the USD cash ledger with it.
export function reportingDividends(rows:DividendRecord[],rate:number):DividendRecord[] {
  return rows.map(row=>row.currency==='KRW'?{...row,currency:'USD',amountUSD:(dividendCashBreakdown(row).netKRW||0)/Math.max(.000001,rate),netAmountUSD:undefined,grossAmountUSD:undefined,taxUSD:0,withholdingTaxUSD:0,feeUSD:0,rocPercent:undefined,rocAmountUSD:0,sharesAtPayment:0}:row);
}

export interface DividendReplacementRow {date:string;amountKRW?:number;amountUSD?:number;}
export interface DividendReplacement {symbol:string;currency:'KRW'|'USD';rows:DividendReplacementRow[];totalKRW:number;totalUSD:number;}
export function parseDividendReplacement(input:unknown,today:string):DividendReplacement {
  const raw=input as {format?:unknown;scope?:unknown;symbol?:unknown;currency?:unknown;rows?:unknown};
  if(raw?.format!=='dividend-os-dividend-replacement-v1'||raw.scope!=='all-dividends'||typeof raw.symbol!=='string'||!/^[A-Z0-9.-]{1,16}$/.test(raw.symbol)||!Array.isArray(raw.rows)||!raw.rows.length||raw.rows.length>5000||raw.currency!==undefined&&!['KRW','USD'].includes(String(raw.currency)))throw new Error('올바른 배당 교체 파일이 아닙니다.');
  const currency=raw.currency==='USD'?'USD':'KRW',dates=new Set<string>();
  const rows=raw.rows.map((value:unknown):DividendReplacementRow=>{
    const row=value as {date?:unknown;amountKRW?:unknown;amountUSD?:unknown};
    const amount=currency==='KRW'?row?.amountKRW:row?.amountUSD;
    if(typeof row?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(Date.parse(row.date+'T12:00:00Z'))||new Date(row.date+'T12:00:00Z').toISOString().slice(0,10)!==row.date||row.date>today||dates.has(row.date)||typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||amount>1e12||(currency==='KRW'?!Number.isSafeInteger(amount):Math.abs(Math.round(amount*100)-amount*100)>1e-6))throw new Error('날짜·중복·입금 금액을 확인해 주세요.');
    dates.add(row.date);return currency==='KRW'?{date:row.date,amountKRW:amount}:{date:row.date,amountUSD:amount};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  return {symbol:raw.symbol,currency,rows,totalKRW:rows.reduce((sum,row)=>sum+(row.amountKRW||0),0),totalUSD:Math.round(rows.reduce((sum,row)=>sum+(row.amountUSD||0),0)*100)/100};
}

export function economicTotalReturn({marketValueUSD,buyCashOutUSD,sellCashInUSD,dividendCashInUSD}:{marketValueUSD:number;buyCashOutUSD:number;sellCashInUSD:number;dividendCashInUSD:number}):number {
  return finiteNonNegative(marketValueUSD)+finiteNonNegative(sellCashInUSD)+finiteNonNegative(dividendCashInUSD)-finiteNonNegative(buyCashOutUSD);
}

export function applyRocToBasis(costBasisUSD:number,rocUSD:number):{costBasisUSD:number;basisReductionUSD:number;excessRocUSD:number} {
  const basis=finiteNonNegative(costBasisUSD),roc=finiteNonNegative(rocUSD),basisReductionUSD=Math.min(basis,roc);
  return {costBasisUSD:basis-basisReductionUSD,basisReductionUSD,excessRocUSD:Math.max(0,roc-basisReductionUSD)};
}

export function parseReferenceExchangeRate(data: any,now: Date=new Date()): {rate:number,date:string} {
  const rate=Number(data?.rate),date=String(data?.date||'');
  const day=Date.parse(date+'T00:00:00Z'),age=now.getTime()-day;
  if(data?.base!=='USD'||data?.quote!=='KRW'||!Number.isFinite(rate)||rate<=0||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==date||age < -86400000||age>7*86400000)throw new Error('유효한 최신 달러·원 참고 환율이 아닙니다.');
  return {rate,date};
}
export async function fetchReferenceExchangeRate(): Promise<{rate:number,date:string}> {
  const response=await fetch('https://api.frankfurter.dev/v2/rate/USD/KRW',{signal:AbortSignal.timeout(10000),credentials:'omit',cache:'no-store'});
  if(!response.ok)throw new Error('환율 조회에 실패했습니다.');
  return parseReferenceExchangeRate(await response.json());
}
