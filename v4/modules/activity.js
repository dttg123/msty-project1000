import { isDate, n } from './utils.js';

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
