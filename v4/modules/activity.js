import { isDate, n } from './utils.js?v=0.12.4-r61';

export function historicalIncome(rows, mode, year, today) {
  const posted=rows.filter(r=>isDate(r.date)&&r.date<=today&&n(r.amountUSD)>0);
  if(mode==='month'&&year)return Array.from({length:12},(_,i)=>{const key=`${year}-${String(i+1).padStart(2,'0')}`;return {key,label:`${i+1}월`,value:posted.filter(r=>r.date.startsWith(key)).reduce((s,r)=>s+n(r.amountUSD),0)};});
  const grouped=new Map();for(const r of posted){const key=r.date.slice(0,4);grouped.set(key,(grouped.get(key)||0)+n(r.amountUSD));}
  if(!grouped.size)return [];
  const first=Math.min(...[...grouped.keys()].map(Number)),last=Number(String(today).slice(0,4));
  return Array.from({length:last-first+1},(_,index)=>{const key=String(first+index);return {key,label:key,value:grouped.get(key)||0};});
}

export function selectRecords(rows, filter={}) {
  const query=String(filter.query||'').trim().toLocaleLowerCase();
  return rows.filter(row=>(!filter.month||row.date?.startsWith(filter.month))&&
    (!filter.kind||row.kind===filter.kind)&&
    (!query||[row.date,row.note,row.label,row.symbol,row.amountUSD,row.shares,row.price].join(' ').toLocaleLowerCase().includes(query)));
}

// Fixed day ranges avoid a six-row calendar being mislabeled as five weeks.
export function monthWeeks(rows, month) {
  return Array.from({length:5},(_,index)=>{
    const from=index*7+1,to=index===4?31:from+6;
    return {label:`${index+1}주차`,range:`${from}~${to}일`,value:rows.filter(r=>isDate(r.date)&&r.date.startsWith(month)&&+r.date.slice(8)>=from&&+r.date.slice(8)<=to).reduce((sum,r)=>sum+n(r.amountUSD),0)};
  });
}

export function monthActivity(state, forecast, month, today) {
  const projects=new Map(state.projects.map(p=>[p.id,p]));
  const actual=state.dividends.filter(r=>isDate(r.date)&&r.date<=today&&r.date.startsWith(month)).map(r=>({...r,symbol:projects.get(r.projectId)?.symbol||r.symbol||'보관 종목',estimated:false,archived:!!projects.get(r.projectId)?.archived}));
  const expected=forecast.filter(r=>r.date.startsWith(month)).map(r=>({...r,estimated:true}));
  return [...actual,...expected].sort((a,b)=>a.date.localeCompare(b.date)||a.symbol.localeCompare(b.symbol));
}
