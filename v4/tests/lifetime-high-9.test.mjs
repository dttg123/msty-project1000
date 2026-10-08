import assert from 'node:assert/strict';
import {blankState,blankProject} from '../modules/state.js';
import {createPortfolioEngine} from '../modules/portfolio.js';
import {hasNewDividendDeficit} from '../modules/dividend-plan.js';
import {createStoreZip,readStateFromBackupFile,buildCsvExports} from '../backup.js';
import {decodeAppState} from '../modules/state-decoder.js';
import {validateLedger} from '../modules/validation.js';
import {canonicalStringify,sha256Hex,stateCounts} from '../modules/cloud-contract.js';
for(const count of [8,9]){
 const state=blankState();state.projects=[];state.trades=[];state.dividends=[];state.cashAdjustments=[];const expected=new Map();let id=0;
 for(let i=0;i<count;i++){
  const p=blankProject('HIGH'+i,'HIGH'+i);p.id='high-'+i;p.distributionFrequency=i<4?'weekly':i<7?'monthly':'quarterly';p.currentPrice=25+i;p.category='highYield';state.projects.push(p);const e={shares:10000,direct:10000*(25+i)*100,reinvest:0,income:0,use:0,records:0};expected.set(p.id,e);state.trades.push({id:'t'+id++,projectId:p.id,date:'1996-01-01',type:'buy',buyType:'direct',shares:10000,price:25+i});
  for(let y=1996;y<=2025;y++)for(let m=1;m<=12;m++){
   const prefix=`${y}-${String(m).padStart(2,'0')}-`;const shares=10+i,price=25+i;
   state.trades.push({id:'t'+id++,projectId:p.id,date:prefix+'02',type:'buy',buyType:'direct',shares,price});e.shares+=shares;e.direct+=shares*price*100;
   const days=i<4?[5,12,19,26]:i<7?[26]:m%3===0?[26]:[];
   for(const day of days){const cents=100000+i*250000+(y-1996)*12000+m*101+day*17;state.dividends.push({id:'d'+id++,projectId:p.id,date:prefix+String(day).padStart(2,'0'),amountUSD:cents/100,status:'actual',currency:'USD',sharesAtPayment:e.shares});e.income+=cents;e.records++;}
   if(days.length){const reinvestShares=2+i;state.trades.push({id:'t'+id++,projectId:p.id,date:prefix+'27',type:'buy',buyType:'reinvest',shares:reinvestShares,price});e.shares+=reinvestShares;e.reinvest+=reinvestShares*price*100;const useCents=(100+i*100+m*3)*100;state.cashAdjustments.push({id:'c'+id++,projectId:p.id,date:prefix+'28',amountUSD:-useCents/100,purpose:'dividendUse',destination:['isa','otherDividend','living','other'][i%4]});e.use+=useCents;}
  }
 }
 assert.deepEqual(validateLedger(state),[]);const engine=createPortfolioEngine(()=>state,()=>state.projects[0].id);
 for(const p of state.projects){const c=engine.computeProject(p),e=expected.get(p.id);assert.equal(c.shares,e.shares);assert.ok(Math.abs(c.dividendsTotal-e.income/100)<.0001);assert.ok(Math.abs(c.dividendAvailable-(e.income-e.reinvest-e.use)/100)<.0001);assert.equal(c.directBuyCost,e.direct/100);assert.equal(c.reinvestAmount,e.reinvest/100);assert.equal(c.postedDividends.length,e.records);assert.ok(c.minDividendBalance>=0);}
 const snapshot=canonicalStringify(state),hash=await sha256Hex(snapshot),zip=createStoreZip([{name:'data/state.json',data:snapshot},{name:'backup-info.json',data:JSON.stringify({integrity:{hash},counts:stateCounts(state)})}]);const restored=decodeAppState(await readStateFromBackupFile(new File([zip],'high-30-year.zip')));assert.deepEqual(restored.trades,state.trades);assert.deepEqual(restored.dividends,state.dividends);assert.deepEqual(restored.cashAdjustments,state.cashAdjustments);
 const csv=buildCsvExports(state).find(x=>x.name==='dividends.csv');assert.equal(csv.data.split('\n').length,state.dividends.length+1);
 const p=state.projects[0],before=engine.computeProject(p),saved=state.dividends;state.dividends=state.dividends.filter(d=>d.projectId!==p.id);assert.ok(hasNewDividendDeficit(before,engine.computeProject(p)));state.dividends=saved;assert.equal(engine.computeProject(p).minDividendBalance,before.minDividendBalance);
 console.log(JSON.stringify({count,years:30,trades:state.trades.length,dividends:state.dividends.length,uses:state.cashAdjustments.length,zipBytes:zip.size,totalUSD:[...expected.values()].reduce((a,e)=>a+e.income,0)/100,perStock:state.projects.map(p=>({symbol:p.symbol,...expected.get(p.id)}))}));
}
console.log('30-year high-value 8/9-stock mixed-cadence ledger, spending, reinvestment, ZIP/CSV and mutation guard PASS');
