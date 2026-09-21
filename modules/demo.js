import { blankState, blankProject } from './state.js';

// Synthetic UI test data only. Values are deliberately fictional and never imply a forecast.
export function demoState(now=new Date()) {
  const state=blankState(),today=now.toISOString().slice(0,10),year=now.getUTCFullYear(),month=now.getUTCMonth()+1,day=now.getUTCDate();
  const specs=[
    ['MSTY','YieldMax MSTR Option Income','highYield','weekly',238,14.57,0],
    ['CONY','YieldMax COIN Option Income','highYield','weekly',160,10.22,1],
    ['NVDY','YieldMax NVDA Option Income','highYield','weekly',120,16.48,2],
    ['YMAX','YieldMax Universe Fund','highYield','weekly',190,12.31,3],
    ['SCHD','Schwab US Dividend Equity','dividend','quarterly',150,28.40,4],
    ['KO','Coca-Cola','dividend','quarterly',60,67.20,5]
  ];
  state.projects=specs.map(([symbol,name,category,frequency,,price,colorIndex],index)=>{
    const project=index===0?state.projects[0]:blankProject(symbol,name);
    return Object.assign(project,{id:`demo-${symbol.toLowerCase()}`,symbol,name,category,distributionFrequency:frequency,currentPrice:price,targetUnits:category==='highYield'?1000:500,monthlyPlanShares:category==='highYield'?10:3,colorIndex});
  });
  state.trades=state.projects.map((project,index)=>({id:`demo-open-${project.symbol.toLowerCase()}`,projectId:project.id,symbol:project.symbol,date:'2019-01-02',type:'buy',buyType:'direct',shares:specs[index][4],price:specs[index][5]*1.08}));
  const iso=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  let id=0;
  for(let y=Math.max(2019,year-7);y<=year;y++){
    for(let m=1;m<=12;m++){
      if(y===year&&m>month)break;
      specs.forEach(([symbol,,,frequency,shares],index)=>{
        const project=state.projects[index],quarterly=frequency==='quarterly';
        if(quarterly&&![3,6,9,12].includes(m))return;
        const dates=quarterly?[Math.min(12,day)]:[4,11,18,25].filter(d=>y<year||m<month||d<=day);
        dates.forEach((d,paymentIndex)=>{
          const seasonal=1+((m+index+paymentIndex)%5)*.035,base=quarterly?(index===4?42:31):(64-index*7);
          state.dividends.push({id:`demo-div-${id++}`,projectId:project.id,symbol,date:iso(y,m,d),amountUSD:Number((base*seasonal*(.9+(y-Math.max(2019,year-7))*.025)).toFixed(2)),sharesAtPayment:shares,note:'더미 실제 입금'});
        });
      });
    }
  }
  // Keep all six symbols visible in the current-period composition, including non-quarter months.
  specs.slice(4).forEach(([symbol,,,frequency,shares],index)=>{
    const project=state.projects[index+4],exists=state.dividends.some(row=>row.projectId===project.id&&row.date.startsWith(`${year}-${String(month).padStart(2,'0')}`));
    if(!exists)state.dividends.push({id:`demo-div-${id++}`,projectId:project.id,symbol,date:iso(year,month,Math.min(day,8+index*3)),amountUSD:index?29.4:38.6,sharesAtPayment:shares,note:'더미 실제 입금'});
  });
  state.settings.appearance='dark';state.settings.displayCurrency='KRW';state.meta.demo=true;state.meta.demoAsOf=today;
  return state;
}
