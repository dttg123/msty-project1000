import { blankState, blankProject } from './state.js';
// Synthetic UI test data, never brokerage data. Kept in a separate QA database.
export function demoState(now=new Date()) {
  const state=blankState(),msty=state.projects[0],today=now.toISOString().slice(0,10);
  Object.assign(msty,{id:'demo-msty',currentPrice:14.57,targetUnits:1000,monthlyPlanShares:12});
  const schd=blankProject('SCHD','분기배당 테스트');Object.assign(schd,{id:'demo-schd',distributionFrequency:'quarterly',currentPrice:28,monthlyPlanShares:5});
  state.projects.push(schd);state.settings.appearance='dark';state.settings.displayCurrency='KRW';
  state.trades=[{id:'demo-opening',projectId:msty.id,date:'2016-01-01',type:'buy',buyType:'direct',shares:238,price:18.08}, {id:'demo-schd-opening',projectId:schd.id,date:'2016-01-01',type:'buy',buyType:'direct',shares:100,price:25}];
  for(let i=0;i<520;i++){const date=new Date(now);date.setDate(date.getDate()-7*i);state.dividends.push({id:`demo-d-${i}`,projectId:msty.id,date:date.toISOString().slice(0,10),amountUSD:i===3?80:40+(i%4),sharesAtPayment:238});}
  state.dividends.push({id:'demo-schd-div',projectId:schd.id,date:today,amountUSD:30,sharesAtPayment:100});
  state.meta.demo=true;return state;
}
