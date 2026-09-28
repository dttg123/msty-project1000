import { isDate, n } from './utils.js';
import { dividendCashBreakdown } from './finance.js';

const iso: any = (date: any) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const monthKey: any = (date: any) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;

export function nextMilestone(calc: any): any {
  const target: any=Math.max(1,n(calc.currentTarget));
  const thresholds: any=[.25,.5,.75,1].map(ratio=>({ratio,shares:target*ratio}));
  const next: any=thresholds.find((item: any)=>calc.shares<item.shares-.000001);
  return next?{...next,remaining:Math.max(0,next.shares-calc.shares),reached:false}:{ratio:1,shares:target,remaining:0,reached:true};
}

export function buildHomeMetrics(calcs: any, dividendRows: any, now=new Date()) {
  const today: any=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12),todayString=iso(today),currentMonth=monthKey(today),currentYear=String(today.getFullYear());
  const actual: any=(dividendRows||[]).filter((row: any)=>isDate(row.date)&&row.date<=todayString&&dividendCashBreakdown(row).status==='actual'&&dividendCashBreakdown(row).netUSD>0);
  const sum: any=(rows: any)=>rows.reduce((total: any,row: any)=>total+dividendCashBreakdown(row).netUSD,0);
  const monthRows: any=actual.filter((row: any)=>row.date.startsWith(currentMonth));
  const yearRows: any=actual.filter((row: any)=>row.date.startsWith(currentYear));
  const previousMonthDate: any=new Date(today.getFullYear(),today.getMonth()-1,1,12),previousMonthKey=monthKey(previousMonthDate);
  const previousMonth: any=sum(actual.filter((row: any)=>row.date.startsWith(previousMonthKey)));
  const previousYear: any=sum(actual.filter((row: any)=>row.date.startsWith(String(today.getFullYear()-1))));
  const months: any=Array.from({length:12},(_,index)=>{
    const key: any=`${currentYear}-${String(index+1).padStart(2,'0')}`,rows=actual.filter((row: any)=>row.date.startsWith(key));
    return {key,label:`${index+1}월`,actual:sum(rows),estimated:0,count:rows.length};
  });
  const yearMap: any=new Map();
  actual.forEach((row: any)=>{const key: any=row.date.slice(0,4),item=yearMap.get(key)||{key,label:key,actual:0,count:0};item.actual+=dividendCashBreakdown(row).netUSD;item.count++;yearMap.set(key,item);});
  const firstYear: any=yearMap.size?Math.min(...[...yearMap.keys()].map(Number)):null;
  const years: any=firstYear===null?[]:Array.from({length:Number(currentYear)-firstYear+1},(_,index)=>{
    const key: any=String(firstYear+index);return yearMap.get(key)||{key,label:key,actual:0,count:0};
  });
  const trailingMonths: any=Array.from({length:6},(_,index)=>{
    const date: any=new Date(today.getFullYear(),today.getMonth()-5+index,1,12),key=monthKey(date);
    return sum(actual.filter((row: any)=>row.date.startsWith(key)));
  });
  const previous3: any=trailingMonths.slice(0,3).reduce((a: any,b: any)=>a+b,0)/3,recent3=trailingMonths.slice(3).reduce((a: any,b: any)=>a+b,0)/3;
  const projectMonth: any=calcs.map((calc: any)=>({
    projectId:calc.project.id,
    symbol:calc.project.symbol,
    actual:sum(monthRows.filter((row: any)=>row.projectId===calc.project.id)),
    count:monthRows.filter((row: any)=>row.projectId===calc.project.id).length
  })).filter((row: any)=>row.actual>0).sort((a: any,b: any)=>b.actual-a.actual);
  const goals: any=calcs.map((calc: any)=>({calc,milestone:nextMilestone(calc)})).sort((a: any,b: any)=>{
    if(a.milestone.reached!==b.milestone.reached)return a.milestone.reached?1:-1;
    return a.milestone.remaining/Math.max(1,a.calc.currentTarget)-b.milestone.remaining/Math.max(1,b.calc.currentTarget);
  });
  const ownedGoals: any=goals.filter((item: any)=>item.calc.shares>0);
  const monthActual: any=sum(monthRows),yearActual=sum(yearRows);
  return {
    month:{actual:monthActual,count:monthRows.length,previous:previousMonth,change:previousMonth>0?(monthActual/previousMonth-1)*100:null,remaining:0,total:monthActual},
    year:{actual:yearActual,count:yearRows.length,previous:previousYear,change:previousYear>0?(yearActual/previousYear-1)*100:null,remaining:0,total:yearActual},
    pace:{monthly:recent3,annualized:recent3*12,change:previous3>0?(recent3/previous3-1)*100:null,available:actual.length>0},
    months,years,projectMonth,nextDividend:null,forecast:[],missingEstimateCount:0,nextGoal:(ownedGoals.length?ownedGoals:goals)[0]||null
  };
}
