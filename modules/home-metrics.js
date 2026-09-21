import { isDate, n } from './utils.js';
import { frequencyOf, paymentDate } from './income.js?v=0.11.1-r50';

const iso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const monthKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
const addDays = (date, days) => { const next=new Date(date); next.setDate(next.getDate()+days); return next; };
const addMonths = (date, months) => { const next=new Date(date); next.setMonth(next.getMonth()+months); return next; };

function average(rows, count) {
  const values=rows.slice(-count).map(row=>n(row.amountUSD)).filter(value=>value>0);
  return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;
}

function projectForecast(calc, today) {
  if(calc.shares<=0||!calc.estimateReliable)return [];
  const rows=calc.postedDividends.filter(row=>isDate(row.date)&&n(row.amountUSD)>0).sort((a,b)=>a.date.localeCompare(b.date));
  if(!rows.length)return [];
  const spec=frequencyOf(calc.project),weekly=!spec.months;
  const amount=calc.income?.payout??average(rows,spec.stable);
  if(!amount)return [];
  const last=new Date(`${rows.at(-1).date}T12:00:00`), end=new Date(today.getFullYear()+1,11,31,12);
  const ageDays=Math.floor((today-last)/86400000);
  if(ageDays>spec.maxAge)return [];
  const gap=7; // Weekly schedule stays weekly despite holidays or delayed deposits.
  let index=1,next=paymentDate(rows.at(-1).date,index,spec,gap);
  const result=[];
  while(next<=today)next=paymentDate(rows.at(-1).date,++index,spec,gap);
  while(next<=end&&result.length<110){result.push({projectId:calc.project.id,symbol:calc.project.symbol,date:iso(next),amountUSD:amount,estimated:true});next=paymentDate(rows.at(-1).date,++index,spec,gap);}
  return result;
}

export function nextMilestone(calc) {
  const target=Math.max(1,n(calc.currentTarget));
  const thresholds=[.25,.5,.75,1].map(ratio=>({ratio,shares:target*ratio}));
  const next=thresholds.find(item=>calc.shares<item.shares-.000001);
  return next?{...next,remaining:Math.max(0,next.shares-calc.shares),reached:false}:{ratio:1,shares:target,remaining:0,reached:true};
}

export function buildHomeMetrics(calcs, dividendRows, now=new Date()) {
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12),todayString=iso(today),currentMonth=monthKey(today),currentYear=String(today.getFullYear());
  const activeIds=new Set(calcs.map(calc=>calc.project.id));
  // Archiving a project hides its future forecast, never money already received.
  const actual=(dividendRows||[]).filter(row=>isDate(row.date)&&row.date<=todayString&&n(row.amountUSD)>0);
  const forecast=calcs.flatMap(calc=>projectForecast(calc,today));
  const sum=rows=>rows.reduce((total,row)=>total+n(row.amountUSD),0);
  const monthActual=sum(actual.filter(row=>row.date.startsWith(currentMonth)));
  const monthForecast=sum(forecast.filter(row=>row.date.startsWith(currentMonth)));
  const yearActual=sum(actual.filter(row=>row.date.startsWith(currentYear)));
  const yearForecast=sum(forecast.filter(row=>row.date.startsWith(currentYear)));
  const forecastIds=new Set(forecast.map(row=>row.projectId));
  const stable=calcs.reduce((total,calc)=>total+(forecastIds.has(calc.project.id)?n(calc.monthlyEstimate):0),0);
  const recent=calcs.reduce((total,calc)=>total+(forecastIds.has(calc.project.id)?n(calc.shortMonthlyEstimate):0),0);
  const comparable=calcs.filter(calc=>forecastIds.has(calc.project.id));
  const paceChange=stable>0&&comparable.length>0&&comparable.every(calc=>calc.income?.trend!==null&&calc.income?.trend!==undefined)?(recent/stable-1)*100:null;
  const months=[];
  for(let offset=-11;offset<=0;offset++){
    const date=new Date(today.getFullYear(),today.getMonth()+offset,1,12),key=monthKey(date);
    months.push({key,label:`${date.getMonth()+1}월`,actual:sum(actual.filter(row=>row.date.startsWith(key))),estimated:key===currentMonth?monthForecast:0});
  }
  const nextDividend=forecast.sort((a,b)=>a.date.localeCompare(b.date))[0]||null;
  const projectMonth=calcs.map(calc=>({
    projectId:calc.project.id,
    symbol:calc.project.symbol,
    actual:sum(actual.filter(row=>row.projectId===calc.project.id&&row.date.startsWith(currentMonth))),
    remaining:sum(forecast.filter(row=>row.projectId===calc.project.id&&row.date.startsWith(currentMonth)))
  })).filter(row=>row.actual>0||row.remaining>0).sort((a,b)=>(b.actual+b.remaining)-(a.actual+a.remaining));
  const goals=calcs.map(calc=>({calc,milestone:nextMilestone(calc)})).sort((a,b)=>{
    if(a.milestone.reached!==b.milestone.reached)return a.milestone.reached?1:-1;
    return a.milestone.remaining/Math.max(1,a.calc.currentTarget)-b.milestone.remaining/Math.max(1,b.calc.currentTarget);
  });
  const ownedGoals=goals.filter(item=>item.calc.shares>0);
  return {
    month:{actual:monthActual,remaining:monthForecast,total:monthActual+monthForecast},
    year:{actual:yearActual,remaining:yearForecast,total:yearActual+yearForecast},
    pace:{monthly:stable,annualized:stable*12,change:paceChange,available:forecastIds.size>0},
    months,projectMonth,nextDividend,forecast,missingEstimateCount:calcs.filter(c=>c.shares>0&&!c.estimateReliable).length,nextGoal:(ownedGoals.length?ownedGoals:goals)[0]||null
  };
}
