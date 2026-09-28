import { isDate, n } from './utils.js';

export function historicalIncome(rows: any, mode: any, year: any, today: any): any {
  const posted: any=rows.filter((r: any)=>isDate(r.date)&&r.date<=today&&n(r.amountUSD)>0);
  if(mode==='month'&&year)return Array.from({length:12},(_,i)=>{const key: any=`${year}-${String(i+1).padStart(2,'0')}`;return {key,label:`${i+1}월`,value:posted.filter((r: any)=>r.date.startsWith(key)).reduce((s: any,r: any)=>s+n(r.amountUSD),0)};});
  const grouped: any=new Map();for(const r of posted){const key: any=r.date.slice(0,4);grouped.set(key,(grouped.get(key)||0)+n(r.amountUSD));}
  if(!grouped.size)return [];
  const first: any=Math.min(...[...grouped.keys()].map(Number)),last=Number(String(today).slice(0,4));
  return Array.from({length:last-first+1},(_,index)=>{const key: any=String(first+index);return {key,label:key,value:grouped.get(key)||0};});
}

export function selectRecords(rows: any, filter: any ={}): any {
  const query: any=String(filter.query||'').trim().toLocaleLowerCase();
  return rows.filter((row: any)=>(!filter.month||row.date?.startsWith(filter.month))&&
    (!filter.kind||row.kind===filter.kind)&&
    (!query||[row.date,row.note,row.label,row.symbol,row.amountUSD,row.shares,row.price].join(' ').toLocaleLowerCase().includes(query)));
}

// Fixed day ranges avoid a six-row calendar being mislabeled as five weeks.
export function monthWeeks(rows: any, month: any): any {
  return Array.from({length:5},(_,index)=>{
    const from: any=index*7+1,to=index===4?31:from+6;
    return {label:`${index+1}주차`,range:`${from}~${to}일`,value:rows.filter((r: any)=>isDate(r.date)&&r.date.startsWith(month)&&+r.date.slice(8)>=from&&+r.date.slice(8)<=to).reduce((sum: any,r: any)=>sum+n(r.amountUSD),0)};
  });
}

export function monthActivity(state: any, forecast: any, month: any, today: any): any {
  const projects: any=new Map(state.projects.map((p: any)=>[p.id,p]));
  const actual: any=state.dividends.filter((r: any)=>isDate(r.date)&&r.date<=today&&r.date.startsWith(month)).map((r: any)=>({...r,symbol:projects.get(r.projectId)?.symbol||r.symbol||'보관 종목',estimated:false,archived:!!projects.get(r.projectId)?.archived}));
  const expected: any=forecast.filter((r: any)=>r.date.startsWith(month)).map((r: any)=>({...r,estimated:true}));
  return [...actual,...expected].sort((a,b)=>a.date.localeCompare(b.date)||a.symbol.localeCompare(b.symbol));
}
