import { isDate, n } from './utils.js';
import { dividendCashBreakdown } from './finance.js';

export const FREQUENCIES: any = {
  weekly: {label:'주배당',year:52,months:0,stable:8,short:4,maxAge:45,maxGap:21},
  monthly: {label:'월배당',year:12,months:1,stable:3,short:1,maxAge:75,maxGap:75},
  quarterly: {label:'분기배당',year:4,months:3,stable:4,short:1,maxAge:140,maxGap:140},
  semiannual: {label:'반기배당',year:2,months:6,stable:2,short:1,maxAge:240,maxGap:240},
  annual: {label:'연배당',year:1,months:12,stable:2,short:1,maxAge:430,maxGap:430}
};
const validFrequency: any = (value: any) => FREQUENCIES[value] ? value : 'monthly';

export function detectDistributionFrequency(dividends: any =[],fallback: any ='monthly'): any {
  const dates: any=[...new Set((Array.isArray(dividends)?dividends:[]).filter(row=>isDate(row?.date)&&dividendCashBreakdown(row).status==='actual'&&dividendCashBreakdown(row).netUSD>0).map(row=>row.date))]
    .sort((a: any,b: any)=>b.localeCompare(a)).slice(0,13);
  const gaps: any=dates.slice(0,-1).map((date: any,index: any)=>(new Date(`${date}T12:00:00Z`).getTime()-new Date(`${dates[index+1]}T12:00:00Z`).getTime())/86400000)
    .filter((gap: any)=>Number.isFinite(gap)&&gap>=3&&gap<=430).sort((a: any,b: any)=>a-b);
  if(gaps.length<2)return {key:validFrequency(fallback),detected:false,medianGap:null,sampleSize:gaps.length};
  const medianGap: any=gaps[Math.floor(gaps.length/2)];
  const key: any=medianGap<=15?'weekly':medianGap<=50?'monthly':medianGap<=130?'quarterly':medianGap<=250?'semiannual':'annual';
  return {key,detected:true,medianGap,sampleSize:gaps.length};
}

export function frequencyOf(project: any ={},dividends: any =[]): any {
  const fallback: any=validFrequency(project.distributionFrequency);
  const automatic: any=project.distributionFrequencyMode!=='manual';
  const result: any=automatic?detectDistributionFrequency(dividends,fallback):{key:fallback,detected:false,medianGap:null,sampleSize:0};
  return {...FREQUENCIES[result.key],key:result.key,automatic,detected:result.detected,medianGap:result.medianGap,sampleSize:result.sampleSize};
}

// Historical cash remains untouched. Only per-share comparisons are split-adjusted.
export function incomeEstimate(project: any, dividends: any, splits: any, shares: any, now=new Date()) {
  const today: any=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const rows: any=dividends.filter((row: any)=>isDate(row.date)&&row.date<=today&&dividendCashBreakdown(row).status==='actual'&&dividendCashBreakdown(row).netUSD>0).sort((a: any,b: any)=>b.date.localeCompare(a.date));
  const spec: any=frequencyOf(project,rows);
  const grouped: any=new Map();
  for(const row of rows){
    const factor: any=splits.filter((s: any)=>isDate(s.date)&&s.date>row.date&&s.date<=today&&n(s.from)>0&&n(s.to)>0).reduce((a: any,s: any)=>a*n(s.to)/n(s.from),1);
    const key: any=row.date, previous=grouped.get(key)||{date:key,amount:0,perShare:0,known:true,ids:[]};
    const net: any=dividendCashBreakdown(row).netUSD;previous.amount+=net;
    previous.ids.push(row.id);
    if(n(row.sharesAtPayment)>0)previous.perShare+=net/(n(row.sharesAtPayment)*factor);else previous.known=false;
    grouped.set(key,previous);
  }
  const payments: any=[...grouped.values()], stable=payments.slice(0,spec.stable),short=payments.slice(0,spec.short);
  const avg: any=(items: any,key: any)=>items.length?items.reduce((s: any,r: any)=>s+r[key],0)/items.length:0;
  const age: any=payments.length?Math.max(0,(new Date(today).getTime()-new Date(payments[0].date).getTime())/86400000):Infinity;
  const gaps: any=stable.slice(1).map((r: any,i: any)=>(new Date(stable[i].date).getTime()-new Date(r.date).getTime())/86400000).sort((a: any,b: any)=>a-b);
  const gap: any=gaps.length?gaps[Math.floor(gaps.length/2)]:Infinity;
  const known: any=stable.length>0&&stable.every((r: any)=>r.known);
  const reliable: any=known&&shares>0&&stable.length>=(spec.months?1:2)&&age<=spec.maxAge&&(stable.length<2||gap<=spec.maxGap);
  const perShare: any=avg(stable.filter((r: any)=>r.known),'perShare'),shortPerShare=avg(short.filter((r: any)=>r.known),'perShare');
  const payout: any=known?perShare*shares:avg(stable,'amount'),shortPayout=known?shortPerShare*shares:avg(short,'amount');
  return {spec,payments,reliable,known,age,gap,perShare,shortPerShare,payout:reliable?payout:0,
    monthly:reliable?payout*spec.year/12:0,shortMonthly:reliable?shortPayout*spec.year/12:0,
    historicalMonthly:avg(stable,'amount')*spec.year/12,
    trend:known&&stable.length>=spec.stable&&perShare>0?(shortPerShare/perShare-1)*100:null};
}

export function paymentDate(anchor: any, index: any, spec: any, gap: any =7): any {
  const date: any=new Date(`${anchor}T12:00:00`);
  if(!spec.months){date.setDate(date.getDate()+index*gap);return date;}
  const day: any=date.getDate();
  date.setDate(1);date.setMonth(date.getMonth()+index*spec.months);
  const lastDay: any=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();
  date.setDate(Math.min(day,lastDay));return date;
}
