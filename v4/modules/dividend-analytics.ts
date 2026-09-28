import { isDate, n } from './utils.js';
import { dividendCashBreakdown } from './finance.js';

function splitFactorAfter(date: any,splits: any,today: any): any{
  return splits.filter((row: any)=>isDate(row.date)&&row.date>date&&row.date<=today&&n(row.from)>0&&n(row.to)>0)
    .reduce((factor: any,row: any)=>factor*n(row.to)/n(row.from),1);
}

function pctChange(current: any,previous: any): any{return previous>0?(current/previous-1)*100:null;}

function cagr(current: any,previous: any,years: any): any{
  return current>0&&previous>0&&years>0?(Math.pow(current/previous,1/years)-1)*100:null;
}

export function buildDividendAnalytics(project: any,dividends: any,splits=[],avgCost=0,todayString=new Date().toISOString().slice(0,10)){
  const rows: any=dividends.filter((row: any)=>isDate(row.date)&&row.date<=todayString&&dividendCashBreakdown(row).status==='actual'&&dividendCashBreakdown(row).netUSD>0).sort((a: any,b: any)=>a.date.localeCompare(b.date));
  const yearly: any=new Map();
  for(const row of rows){
    const year: any=row.date.slice(0,4),item=yearly.get(year)||{year,net:0,dps:0,known:true,count:0};
    const net: any=dividendCashBreakdown(row).netUSD;item.net+=net;item.count++;
    if(n(row.sharesAtPayment)>0)item.dps+=net/(n(row.sharesAtPayment)*splitFactorAfter(row.date,splits,todayString));
    else item.known=false;
    yearly.set(year,item);
  }
  const years: any=[...yearly.values()].sort((a,b)=>a.year.localeCompare(b.year));
  const currentYear: any=todayString.slice(0,4),completed=years.filter((item: any)=>item.year<currentYear&&item.known&&item.dps>0);
  const latest: any=completed.at(-1),previous=completed.at(-2);
  const growthYears: any=completed.map((item: any,index: any)=>({...item,change:index?pctChange(item.dps,completed[index-1].dps):null}));
  const cagrFor: any=(count: any)=>{
    if(completed.length<count+1)return null;
    const end: any=completed.at(-1),startYear=String(Number(end.year)-count),start=completed.find((item: any)=>item.year===startYear);
    if(!start)return null;
    return cagr(end.dps,start.dps,count);
  };
  let increaseStreak: any=0,cutCount=0,flatCount=0;
  for(let index: any=completed.length-1;index>0;index--){
    if(Number(completed[index].year)-Number(completed[index-1].year)!==1)break;
    const change: any=pctChange(completed[index].dps,completed[index-1].dps);
    if(change!==null&&change>.5)increaseStreak++;else break;
  }
  growthYears.slice(1).forEach((item: any)=>{if(item.change<-.5)cutCount++;else if(Math.abs(item.change)<=.5)flatCount++;});
  const trailingStart: any=new Date(`${todayString}T12:00:00Z`);trailingStart.setUTCFullYear(trailingStart.getUTCFullYear()-1);
  const trailingStartString: any=trailingStart.toISOString().slice(0,10);
  const trailingRows: any=rows.filter((row: any)=>row.date>trailingStartString);
  const trailingNet: any=trailingRows.reduce((sum: any,row: any)=>sum+dividendCashBreakdown(row).netUSD,0);
  const trailingDps: any=trailingRows.every((row: any)=>n(row.sharesAtPayment)>0)?trailingRows.reduce((sum: any,row: any)=>sum+dividendCashBreakdown(row).netUSD/(n(row.sharesAtPayment)*splitFactorAfter(row.date,splits,todayString)),0):0;
  const trailingYoc: any=avgCost>0&&trailingDps>0?trailingDps/avgCost*100:null;
  const monthDay: any=todayString.slice(4),currentYtd=years.find((item: any)=>item.year===currentYear);
  const priorYear: any=String(Number(currentYear)-1),priorYtdRows=rows.filter((row: any)=>row.date.startsWith(priorYear)&&row.date.slice(4)<=monthDay);
  const priorYtd: any=priorYtdRows.reduce((sum: any,row: any)=>sum+dividendCashBreakdown(row).netUSD,0);
  return {
    years:growthYears,latestCompleted:latest||null,previousCompleted:previous||null,
    annualDpsChange:latest&&previous?pctChange(latest.dps,previous.dps):null,
    cagr3:cagrFor(3),cagr5:cagrFor(5),cagr10:cagrFor(10),increaseStreak,cutCount,flatCount,
    trailingNet,trailingDps,trailingYoc,currentYtd:currentYtd?.net||0,priorYtd,ytdChange:pctChange(currentYtd?.net||0,priorYtd)
  };
}
