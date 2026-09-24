import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {blankState,blankProject,migrate} from '../modules/state.js';
import {createPortfolioEngine} from '../modules/portfolio.js';
import {validateLedger} from '../modules/validation.js';
import {incomeEstimate} from '../modules/income.js';
import {createStoreZip,readStateFromBackupFile} from '../backup.js';
const root=resolve(import.meta.dirname,'..');
let checks=0;
const check=(v,msg)=>{assert.ok(v,msg);checks++};
for(const prefix of ['']){
 for(const file of ['app.js','backup.js','storage.js','auth.js','cloud.js',...readdirSync(root+'/'+prefix+'modules').filter(x=>x.endsWith('.js')).map(x=>'modules/'+x)]){
  const path=resolve(root,prefix,file),source=readFileSync(path,'utf8');
  for(const m of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g))check(existsSync(resolve(dirname(path),m[1].split('?')[0])),`missing dependency ${prefix+file}: ${m[1]}`);
  if(file.startsWith('modules/'))for(const manifest of ['backup.js','sw.js'])check(readFileSync(root+'/'+prefix+manifest,'utf8').includes(file),`${manifest} must bundle ${file}`);
 }
 check(readFileSync(root+'/'+prefix+'cloud.js','utf8').includes("CLOUD_DOC_ID = 'dividend-os-v4'"),'V3 cloud must never be a V4 write target');
}
const state=blankState();state.projects[0].id='p-msty';
let expectedShares=0,expectedCost=0,expectedDividends=0;
for(let year=1991;year<=2025;year++)for(let month=1;month<=12;month++){
 const ym=`${year}-${String(month).padStart(2,'0')}`,q=1+(year+month)%7,price=10+month;
 state.trades.push({id:`t-${ym}`,projectId:'p-msty',date:ym+'-01',type:'buy',buyType:'direct',shares:q,price});
 expectedShares+=q;expectedCost+=q*price;
 for(const day of ['07','14','21','28']){const amount=(month+year%10)/10;state.dividends.push({id:`d-${ym}-${day}`,projectId:'p-msty',date:ym+'-'+day,amountUSD:amount,sharesAtPayment:expectedShares});expectedDividends+=amount;}
}
state.projects[0].currentPrice=20;
let working=migrate(structuredClone(state));
const engine=createPortfolioEngine(()=>working,()=>working.projects[0].id);
check(validateLedger(working).length===0,'35-year fixture valid');
let c=engine.computeProject('p-msty');
check(c.shares===expectedShares,'35-year shares');check(c.costBasis===expectedCost,'35-year cost');check(Math.abs(c.dividendsTotal-expectedDividends)<1e-8,'35-year dividends');
// Exercise actual model editing/deletion, independent expected quantities.
for(let i=0;i<420;i++){
 const row=working.trades[i],old=row.shares;row.shares+=.125;
 check(Math.abs(engine.computeProject('p-msty').shares-(expectedShares+.125))<1e-8,'edit recomputation');row.shares=old;
}
for(let i=0;i<100;i++){
 const row=working.dividends.splice(i,1)[0];check(Math.abs(engine.computeProject('p-msty').dividendsTotal-(expectedDividends-row.amountUSD))<1e-8,'delete recomputation');working.dividends.splice(i,0,row);
}
const zip=createStoreZip([{name:'data/state.json',data:JSON.stringify(working)}]);
const restored=await readStateFromBackupFile({name:'35y.zip',arrayBuffer:()=>zip.arrayBuffer()});check(JSON.stringify(restored)===JSON.stringify(working),'35-year ZIP lossless');
for(const mutate of [s=>s.settings.exchangeRate=0,s=>s.projects[0].currentPrice=Infinity,s=>s.trades[0].shares=null,s=>s.trades[0].buyType='unknown',s=>s.projects[0].id='p-\" onclick=alert(1)',s=>s.projects[0]=null]){
 const invalid=structuredClone(working);mutate(invalid);check(validateLedger(invalid).length>0,'reject unsafe restore');
}
// Korean midnight: a payment on today's local date must not disappear until 09:00.
const localNow=new Date(2026,8,20,0,30),localDay='2026-09-20';
check(incomeEstimate({distributionFrequency:'monthly'},[{date:localDay,amountUSD:30,sharesAtPayment:100}],[],100,localNow).monthly===30,'local midnight payout');
const original=JSON.stringify(working);engine.totals();check(JSON.stringify(working)===original,'calculations do not mutate');
console.log(`Hardening PASS: ${checks} checks; 35 years, ${working.trades.length} trades, ${working.dividends.length} dividends, 420 edits, 100 deletes/restores`);
