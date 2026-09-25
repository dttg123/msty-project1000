import { isDate, n } from './utils.js?v=0.12.6-r63';

export const FREQUENCIES = {
  weekly: {label:'주배당',year:52,months:0,stable:8,short:4,maxAge:45,maxGap:21},
  monthly: {label:'월배당',year:12,months:1,stable:3,short:1,maxAge:75,maxGap:75},
  quarterly: {label:'분기배당',year:4,months:3,stable:4,short:1,maxAge:140,maxGap:140},
  semiannual: {label:'반기배당',year:2,months:6,stable:2,short:1,maxAge:240,maxGap:240},
  annual: {label:'연배당',year:1,months:12,stable:2,short:1,maxAge:430,maxGap:430}
};
const validFrequency = value => FREQUENCIES[value] ? value : 'monthly';

export function detectDistributionFrequency(dividends=[],fallback='monthly') {
  const dates=[...new Set((Array.isArray(dividends)?dividends:[]).filter(row=>isDate(row?.date)&&n(row?.amountUSD)>0).map(row=>row.date))]
    .sort((a,b)=>b.localeCompare(a)).slice(0,13);
  const gaps=dates.slice(0,-1).map((date,index)=>(new Date(`${date}T12:00:00Z`)-new Date(`${dates[index+1]}T12:00:00Z`))/86400000)
    .filter(gap=>Number.isFinite(gap)&&gap>=3&&gap<=430).sort((a,b)=>a-b);
  if(gaps.length<2)return {key:validFrequency(fallback),detected:false,medianGap:null,sampleSize:gaps.length};
  const medianGap=gaps[Math.floor(gaps.length/2)];
  const key=medianGap<=15?'weekly':medianGap<=50?'monthly':medianGap<=130?'quarterly':medianGap<=250?'semiannual':'annual';
  return {key,detected:true,medianGap,sampleSize:gaps.length};
}

export function frequencyOf(project={},dividends=[]) {
  const fallback=validFrequency(project.distributionFrequency);
  const automatic=project.distributionFrequencyMode!=='manual';
  const result=automatic?detectDistributionFrequency(dividends,fallback):{key:fallback,detected:false,medianGap:null,sampleSize:0};
  return {...FREQUENCIES[result.key],key:result.key,automatic,detected:result.detected,medianGap:result.medianGap,sampleSize:result.sampleSize};
}

// Historical cash remains untouched. Only per-share comparisons are split-adjusted.
export function incomeEstimate(project, dividends, splits, shares, now=new Date()) {
  const today=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const rows=dividends.filter(row=>isDate(row.date)&&row.date<=today&&n(row.amountUSD)>0).sort((a,b)=>b.date.localeCompare(a.date));
  const spec=frequencyOf(project,rows);
  const grouped=new Map();
  for(const row of rows){
    const factor=splits.filter(s=>isDate(s.date)&&s.date>row.date&&s.date<=today&&n(s.from)>0&&n(s.to)>0).reduce((a,s)=>a*n(s.to)/n(s.from),1);
    const key=row.date, previous=grouped.get(key)||{date:key,amount:0,perShare:0,known:true,ids:[]};
    previous.amount+=n(row.amountUSD);
    previous.ids.push(row.id);
    if(n(row.sharesAtPayment)>0)previous.perShare+=n(row.amountUSD)/(n(row.sharesAtPayment)*factor);else previous.known=false;
    grouped.set(key,previous);
  }
  const payments=[...grouped.values()], stable=payments.slice(0,spec.stable),short=payments.slice(0,spec.short);
  const avg=(items,key)=>items.length?items.reduce((s,r)=>s+r[key],0)/items.length:0;
  const age=payments.length?Math.max(0,(new Date(today)-new Date(payments[0].date))/86400000):Infinity;
  const gaps=stable.slice(1).map((r,i)=>(new Date(stable[i].date)-new Date(r.date))/86400000).sort((a,b)=>a-b);
  const gap=gaps.length?gaps[Math.floor(gaps.length/2)]:Infinity;
  const known=stable.length>0&&stable.every(r=>r.known);
  const reliable=known&&shares>0&&stable.length>=(spec.months?1:2)&&age<=spec.maxAge&&(stable.length<2||gap<=spec.maxGap);
  const perShare=avg(stable.filter(r=>r.known),'perShare'),shortPerShare=avg(short.filter(r=>r.known),'perShare');
  const payout=known?perShare*shares:avg(stable,'amount'),shortPayout=known?shortPerShare*shares:avg(short,'amount');
  return {spec,payments,reliable,known,age,gap,perShare,shortPerShare,payout:reliable?payout:0,
    monthly:reliable?payout*spec.year/12:0,shortMonthly:reliable?shortPayout*spec.year/12:0,
    historicalMonthly:avg(stable,'amount')*spec.year/12,
    trend:known&&stable.length>=spec.stable&&perShare>0?(shortPerShare/perShare-1)*100:null};
}

export function paymentDate(anchor, index, spec, gap=7) {
  const date=new Date(`${anchor}T12:00:00`);
  if(!spec.months){date.setDate(date.getDate()+index*gap);return date;}
  const day=date.getDate();
  date.setDate(1);date.setMonth(date.getMonth()+index*spec.months);
  const lastDay=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();
  date.setDate(Math.min(day,lastDay));return date;
}
