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
  return record.date<=asOf&&cash.status==='actual'&&cash.netUSD>0;
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
