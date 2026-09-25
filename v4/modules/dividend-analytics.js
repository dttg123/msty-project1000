import { isDate, n } from './utils.js?v=0.12.5-r62';

function splitFactorAfter(date,splits,today){
  return splits.filter(row=>isDate(row.date)&&row.date>date&&row.date<=today&&n(row.from)>0&&n(row.to)>0)
    .reduce((factor,row)=>factor*n(row.to)/n(row.from),1);
}

function pctChange(current,previous){return previous>0?(current/previous-1)*100:null;}

function cagr(current,previous,years){
  return current>0&&previous>0&&years>0?(Math.pow(current/previous,1/years)-1)*100:null;
}

export function buildDividendAnalytics(project,dividends,splits=[],avgCost=0,todayString=new Date().toISOString().slice(0,10)){
  const rows=dividends.filter(row=>isDate(row.date)&&row.date<=todayString&&n(row.amountUSD)>0).sort((a,b)=>a.date.localeCompare(b.date));
  const yearly=new Map();
  for(const row of rows){
    const year=row.date.slice(0,4),item=yearly.get(year)||{year,net:0,dps:0,known:true,count:0};
    item.net+=n(row.amountUSD);item.count++;
    if(n(row.sharesAtPayment)>0)item.dps+=n(row.amountUSD)/(n(row.sharesAtPayment)*splitFactorAfter(row.date,splits,todayString));
    else item.known=false;
    yearly.set(year,item);
  }
  const years=[...yearly.values()].sort((a,b)=>a.year.localeCompare(b.year));
  const currentYear=todayString.slice(0,4),completed=years.filter(item=>item.year<currentYear&&item.known&&item.dps>0);
  const latest=completed.at(-1),previous=completed.at(-2);
  const growthYears=completed.map((item,index)=>({...item,change:index?pctChange(item.dps,completed[index-1].dps):null}));
  const cagrFor=count=>{
    if(completed.length<count+1)return null;
    const end=completed.at(-1),startYear=String(Number(end.year)-count),start=completed.find(item=>item.year===startYear);
    if(!start)return null;
    return cagr(end.dps,start.dps,count);
  };
  let increaseStreak=0,cutCount=0,flatCount=0;
  for(let index=completed.length-1;index>0;index--){
    if(Number(completed[index].year)-Number(completed[index-1].year)!==1)break;
    const change=pctChange(completed[index].dps,completed[index-1].dps);
    if(change!==null&&change>.5)increaseStreak++;else break;
  }
  growthYears.slice(1).forEach(item=>{if(item.change<-.5)cutCount++;else if(Math.abs(item.change)<=.5)flatCount++;});
  const trailingStart=new Date(`${todayString}T12:00:00Z`);trailingStart.setUTCFullYear(trailingStart.getUTCFullYear()-1);
  const trailingStartString=trailingStart.toISOString().slice(0,10);
  const trailingRows=rows.filter(row=>row.date>trailingStartString);
  const trailingNet=trailingRows.reduce((sum,row)=>sum+n(row.amountUSD),0);
  const trailingDps=trailingRows.every(row=>n(row.sharesAtPayment)>0)?trailingRows.reduce((sum,row)=>sum+n(row.amountUSD)/(n(row.sharesAtPayment)*splitFactorAfter(row.date,splits,todayString)),0):0;
  const trailingYoc=avgCost>0&&trailingDps>0?trailingDps/avgCost*100:null;
  const monthDay=todayString.slice(4),currentYtd=years.find(item=>item.year===currentYear);
  const priorYear=String(Number(currentYear)-1),priorYtdRows=rows.filter(row=>row.date.startsWith(priorYear)&&row.date.slice(4)<=monthDay);
  const priorYtd=priorYtdRows.reduce((sum,row)=>sum+n(row.amountUSD),0);
  return {
    years:growthYears,latestCompleted:latest||null,previousCompleted:previous||null,
    annualDpsChange:latest&&previous?pctChange(latest.dps,previous.dps):null,
    cagr3:cagrFor(3),cagr5:cagrFor(5),cagr10:cagrFor(10),increaseStreak,cutCount,flatCount,
    trailingNet,trailingDps,trailingYoc,currentYtd:currentYtd?.net||0,priorYtd,ytdChange:pctChange(currentYtd?.net||0,priorYtd)
  };
}
