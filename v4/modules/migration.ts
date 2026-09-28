import { repairLegacy } from './state.js';
import { clone, n } from './utils.js';

const EPSILON: any = 1e-7;

function legacyRows(raw: any, key: any): any {
  return Array.isArray(raw?.[key]) ? raw[key] : [];
}

export function summarizeLegacyState(input: any): any {
  const raw: any=repairLegacy(clone(input));
  const trades: any=legacyRows(raw,'trades'),dividends=legacyRows(raw,'dividends'),splits=legacyRows(raw,'splits');
  const events: any=[
    ...trades.map((row: any)=>({...row,eventType:'trade'})),
    ...splits.map((row: any)=>({...row,eventType:'split'}))
  ].sort((a,b)=>String(a.date).localeCompare(String(b.date))||((a.eventType==='split'?0:1)-(b.eventType==='split'?0:1))||String(a.createdAt||a.id).localeCompare(String(b.createdAt||b.id)));
  let factor: any=1,shares=0,normalizedShares=0,costBasis=0,realized=0,directBuyCost=0,sellProceeds=0,reinvestAmount=0;
  for(const event of events){
    if(event.eventType==='split'){
      const ratio: any=n(event.to)/n(event.from);if(ratio>0&&Number.isFinite(ratio)){shares*=ratio;factor*=ratio;}
      continue;
    }
    const quantity: any=Math.max(0,n(event.shares)),price=Math.max(0,n(event.price)),amount=quantity*price;
    if(event.type==='buy'){
      shares+=quantity;normalizedShares+=quantity/factor;costBasis+=amount;
      if(event.buyType==='direct'||event.buyType==='opening')directBuyCost+=amount;
      if(event.buyType==='reinvest')reinvestAmount+=amount;
      if(event.buyType==='mixed'){
        const dividendPart: any=Math.min(amount,Math.max(0,n(event.reinvestAmountUSD)));
        reinvestAmount+=dividendPart;directBuyCost+=Math.max(0,amount-dividendPart);
      }
      continue;
    }
    if(event.type==='sell'){
      const safeQuantity: any=Math.min(quantity,Math.max(0,shares)),average=shares>0?costBasis/shares:0;
      realized+=safeQuantity*(price-average);costBasis-=safeQuantity*average;shares-=safeQuantity;
      normalizedShares-=safeQuantity/factor;sellProceeds+=safeQuantity*price;
    }
  }
  shares=Math.abs(shares)<1e-9?0:shares;costBasis=Math.max(0,Math.abs(costBasis)<1e-7?0:costBasis);
  const currentPrice: any=Math.max(0,n(raw.settings?.currentPrice));
  const dividendsTotal: any=dividends.reduce((sum: any,row: any)=>sum+n(row.amountUSD),0);
  const initialDividendBalance: any=Math.max(0,n(raw.settings?.initialDividendBalance));
  return {
    tradeCount:trades.length,dividendCount:dividends.length,splitCount:splits.length,
    factor,shares,normalizedShares,costBasis,realized,directBuyCost,sellProceeds,
    currentTarget:Math.max(.000001,n(raw.settings?.targetUnits)||500)*factor,
    marketValue:shares*currentPrice,dividendsTotal,reinvestAmount,
    dividendAvailable:initialDividendBalance+dividendsTotal-reinvestAmount,
    recoveryLocked:!!raw.recovery?.locked,recoveryBasis:Math.max(0,n(raw.recovery?.basis)),
    recoveryStartDate:String(raw.recovery?.startDate||'')
  };
}

function closeEnough(a: any,b: any): any {
  return Math.abs(n(a)-n(b))<=EPSILON*Math.max(1,Math.abs(n(a)),Math.abs(n(b)));
}

export function buildMigrationAudit(legacyRaw: any,migratedState: any,migratedCalc: any): any {
  const source: any=summarizeLegacyState(legacyRaw);
  const target: any={
    tradeCount:migratedCalc.trades.length,dividendCount:migratedCalc.dividends.length,
    splitCount:migratedState.splits.filter((row: any)=>row.projectId===migratedCalc.project.id).length,
    factor:migratedCalc.factor,shares:migratedCalc.shares,normalizedShares:migratedCalc.normalizedShares,
    costBasis:migratedCalc.costBasis,realized:migratedCalc.realized,directBuyCost:migratedCalc.directBuyCost,
    sellProceeds:migratedCalc.sellProceeds,currentTarget:migratedCalc.currentTarget,
    marketValue:migratedCalc.marketValue,dividendsTotal:migratedCalc.dividendsTotal,
    reinvestAmount:migratedCalc.reinvestAmount,dividendAvailable:migratedCalc.dividendAvailable,
    recoveryLocked:!!migratedCalc.project.recovery?.locked,
    recoveryBasis:Math.max(0,n(migratedCalc.project.recovery?.basis)),
    recoveryStartDate:String(migratedCalc.project.recovery?.startDate||'')
  };
  const exact: any=['tradeCount','dividendCount','splitCount','recoveryLocked','recoveryStartDate'];
  const numeric: any=['factor','shares','normalizedShares','costBasis','realized','directBuyCost','sellProceeds','currentTarget','marketValue','dividendsTotal','reinvestAmount','dividendAvailable','recoveryBasis'];
  const checks: any=[
    ...exact.map((key: any)=>({key,source:source[key],target:target[key],passed:source[key]===target[key]})),
    ...numeric.map((key: any)=>({key,source:source[key],target:target[key],passed:closeEnough(source[key],target[key])}))
  ];
  return {version:1,checkedAt:new Date().toISOString(),passed:checks.every((check: any)=>check.passed),checks,source,target};
}
