import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {decodeAppState} from '../modules/state-decoder.js';
import {blankState} from '../modules/state.js';
import {createPortfolioEngine} from '../modules/portfolio.js';
import {buildMigrationAudit} from '../modules/migration.js';

const raw=blankState(),project=raw.projects[0];
raw.trades=[{id:'buy',projectId:project.id,date:'2026-01-01',type:'buy',buyType:'direct',shares:'10.5',price:'2',feeUSD:'0',source:{provider:'toss',externalId:'external-1',adoptedManual:true,extension:'keep'}},{id:'sell',projectId:project.id,date:'2026-01-02',type:'sell',buyType:'',shares:'1',price:'3',reinvestAmountUSD:'0'}];
raw.dividends=[{id:'dividend',projectId:project.id,date:'2026-01-03',amountUSD:'2.5',rocPercent:null,referencePrice:'0'}];
raw.splits=[{id:'split',projectId:project.id,date:'2026-01-04',type:'split',from:'1',to:'2'}];
raw.integrations.toss.status='partial';raw.integrations.toss.dividendCandidates=[{externalId:'candidate',manualMatchIds:['dividend'],extension:{value:1}}];
raw.meta.extension='keep';const untouched=structuredClone(raw),decoded=decodeAppState(raw);
assert.deepEqual(raw,untouched,'decoding must never mutate the source');
assert.equal(decoded.trades[0].shares,10.5);assert.equal(decoded.trades[0].feeUSD,0);assert.equal(decoded.trades[1].buyType,'');assert.equal(decoded.dividends[0].referencePrice,0);assert.equal(decoded.dividends[0].rocPercent,null);
assert.equal(decoded.trades[0].source.extension,'keep');assert.equal(decoded.meta.extension,'keep');assert.deepEqual(decoded.integrations.toss.dividendCandidates,raw.integrations.toss.dividendCandidates);
assert.equal(createPortfolioEngine(()=>decoded,()=>project.id).computeProject(project.id).shares,19);
for(const invalid of [true,false,null,[],[1],{},'', '   ','Infinity',Infinity,NaN]){
  const bad=structuredClone(raw);bad.trades[0].shares=invalid;assert.throws(()=>decodeAppState(bad),undefined,`reject quantity ${String(invalid)}`);
}
for(const mutate of [s=>s.dividends[0].currency='EUR',s=>s.dividends[0].rocStatus='bad',s=>s.trades[0].source.adoptedManual='yes',s=>s.meta.demo='true',s=>s.meta.migrationAudit={},s=>s.projects[0].recovery.locked='false',s=>s.integrations.toss.capabilities.orders='false',s=>s.integrations.toss.dismissedExceptionKeys=[1],s=>s.trades={},s=>s.integrations.toss.candidates=[null]]){
  const bad=structuredClone(raw);mutate(bad);assert.throws(()=>decodeAppState(bad));
}
for(const invalid of [null,undefined,[],{},'state'])assert.throws(()=>decodeAppState(invalid));
const legacy={version:3,settings:{targetUnits:500,currentPrice:2},trades:[{id:'old-buy',date:'2026-01-01',type:'buy',buyType:'direct',shares:'3',price:'2'}],dividends:[],splits:[],meta:{}};
const migrated=decodeAppState(legacy),calc=createPortfolioEngine(()=>migrated,()=>migrated.projects[0].id).computeProject(migrated.projects[0].id);
assert.equal(migrated.trades[0].shares,3);migrated.meta.migrationAudit=buildMigrationAudit(legacy,migrated,calc);assert.equal(decodeAppState(migrated).meta.migrationAudit.passed,true);
// Prevent explicit any from returning to the runtime sources, including the entry point.
const root=resolve(import.meta.dirname,'..');
for(const dir of [root,resolve(root,'modules'),resolve(root,'types')])for(const name of readdirSync(dir).filter(name=>name.endsWith('.ts'))){
  const file=resolve(dir,name);assert.doesNotMatch(readFileSync(file,'utf8'),/\bany\b/,`${name} contains an any token`);
}
console.log('Checked state decoding PASS: legacy numeric strings, zero/null, source identity, corrupted payload rejection, explicit-any gate');
