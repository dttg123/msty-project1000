import { isDate, n } from './utils.js?v=0.12.4-r61';

const iso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const monthKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;

export function nextMilestone(calc) {
  const target=Math.max(1,n(calc.currentTarget));
  const thresholds=[.25,.5,.75,1].map(ratio=>({ratio,shares:target*ratio}));
  const next=thresholds.find(item=>calc.shares<item.shares-.000001);
  return next?{...next,remaining:Math.max(0,next.shares-calc.shares),reached:false}:{ratio:1,shares:target,remaining:0,reached:true};
}

export function buildHomeMetrics(calcs, dividendRows, now=new Date()) {
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12),todayString=iso(today),currentMonth=monthKey(today),currentYear=String(today.getFullYear());
  const actual=(dividendRows||[]).filter(row=>isDate(row.date)&&row.date<=todayString&&n(row.amountUSD)>0);
  const sum=rows=>rows.reduce((total,row)=>total+n(row.amountUSD),0);
  const monthRows=actual.filter(row=>row.date.startsWith(currentMonth));
  const yearRows=actual.filter(row=>row.date.startsWith(currentYear));
  const previousMonthDate=new Date(today.getFullYear(),today.getMonth()-1,1,12),previousMonthKey=monthKey(previousMonthDate);
  const previousMonth=sum(actual.filter(row=>row.date.startsWith(previousMonthKey)));
  const previousYear=sum(actual.filter(row=>row.date.startsWith(String(today.getFullYear()-1))));
  const months=Array.from({length:12},(_,index)=>{
    const key=`${currentYear}-${String(index+1).padStart(2,'0')}`,rows=actual.filter(row=>row.date.startsWith(key));
    return {key,label:`${index+1}월`,actual:sum(rows),estimated:0,count:rows.length};
  });
  const yearMap=new Map();
  actual.forEach(row=>{const key=row.date.slice(0,4),item=yearMap.get(key)||{key,label:key,actual:0,count:0};item.actual+=n(row.amountUSD);item.count++;yearMap.set(key,item);});
  const firstYear=yearMap.size?Math.min(...[...yearMap.keys()].map(Number)):null;
  const years=firstYear===null?[]:Array.from({length:Number(currentYear)-firstYear+1},(_,index)=>{
    const key=String(firstYear+index);return yearMap.get(key)||{key,label:key,actual:0,count:0};
  });
  const trailingMonths=Array.from({length:6},(_,index)=>{
    const date=new Date(today.getFullYear(),today.getMonth()-5+index,1,12),key=monthKey(date);
    return sum(actual.filter(row=>row.date.startsWith(key)));
  });
  const previous3=trailingMonths.slice(0,3).reduce((a,b)=>a+b,0)/3,recent3=trailingMonths.slice(3).reduce((a,b)=>a+b,0)/3;
  const projectMonth=calcs.map(calc=>({
    projectId:calc.project.id,
    symbol:calc.project.symbol,
    actual:sum(monthRows.filter(row=>row.projectId===calc.project.id)),
    count:monthRows.filter(row=>row.projectId===calc.project.id).length
  })).filter(row=>row.actual>0).sort((a,b)=>b.actual-a.actual);
  const goals=calcs.map(calc=>({calc,milestone:nextMilestone(calc)})).sort((a,b)=>{
    if(a.milestone.reached!==b.milestone.reached)return a.milestone.reached?1:-1;
    return a.milestone.remaining/Math.max(1,a.calc.currentTarget)-b.milestone.remaining/Math.max(1,b.calc.currentTarget);
  });
  const ownedGoals=goals.filter(item=>item.calc.shares>0);
  const monthActual=sum(monthRows),yearActual=sum(yearRows);
  return {
    month:{actual:monthActual,count:monthRows.length,previous:previousMonth,change:previousMonth>0?(monthActual/previousMonth-1)*100:null,remaining:0,total:monthActual},
    year:{actual:yearActual,count:yearRows.length,previous:previousYear,change:previousYear>0?(yearActual/previousYear-1)*100:null,remaining:0,total:yearActual},
    pace:{monthly:recent3,annualized:recent3*12,change:previous3>0?(recent3/previous3-1)*100:null,available:actual.length>0},
    months,years,projectMonth,nextDividend:null,forecast:[],missingEstimateCount:0,nextGoal:(ownedGoals.length?ownedGoals:goals)[0]||null
  };
}
