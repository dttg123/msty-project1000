import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyRocToBasis,dividendCashBreakdown,economicTotalReturn,tradeCashBreakdown} from '../modules/finance.js';
import {migrate} from '../modules/state.js';
import {createPortfolioEngine} from '../modules/portfolio.js';
import {canonicalStringify,sha256Hex,stateCounts} from '../modules/cloud-contract.js';
import {createStoreZip,readStateFromBackupFile} from '../backup.js';
import {validateTossSnapshotPayload} from '../toss-client.js';
import {ledger} from './factories/ledger-factory.mjs';

const fixture=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));

const finance=await fixture('./fixtures/golden/finance-cases-v1.json');
assert.equal(finance.cases.length,22);
for(const item of finance.cases){
  let actual;
  if(item.operation==='trade')actual=tradeCashBreakdown(item.input);
  if(item.operation==='dividend')actual=dividendCashBreakdown(item.input);
  if(item.operation==='roc')actual=applyRocToBasis(item.input.costBasisUSD,item.input.rocUSD);
  if(item.operation==='return')actual=economicTotalReturn(item.input);
  assert.deepEqual(actual,item.expected,item.id);
}

const legacy=await fixture('./fixtures/legacy/state-v3.json'),migrated=migrate(legacy),remigrated=migrate(migrated);
assert.equal(migrated.version,4);
assert.equal(migrated.projects[0].id,'p-msty');
assert.equal(migrated.trades.length,1);assert.equal(migrated.dividends.length,1);assert.equal(migrated.splits.length,1);
assert.deepEqual(remigrated,migrated,'migration must be idempotent');
const legacyCalc=createPortfolioEngine(()=>migrated,()=>migrated.projects[0].id).computeProject(migrated.projects[0]);
assert.equal(legacyCalc.shares,200);assert.equal(legacyCalc.costBasis,1000);assert.equal(legacyCalc.dividendsTotal,25);

const corrupt=await fixture('./fixtures/backup/corrupt-cases-v1.json'),state=ledger();
for(const item of corrupt.cases){
  let entries=[];
  if(item.id==='missing-ledger')entries=[{name:'data/state.json',data:JSON.stringify(item.state)}];
  if(item.mutate==='missing-state')entries=[{name:'backup-info.json',data:'{}'}];
  if(item.mutate==='integrity')entries=[{name:'backup-info.json',data:JSON.stringify({integrity:{hash:'0'.repeat(64)}})},{name:'data/state.json',data:canonicalStringify(state)}];
  if(item.mutate==='counts')entries=[{name:'backup-info.json',data:JSON.stringify({counts:{...stateCounts(state),trades:999}})},{name:'data/state.json',data:canonicalStringify(state)}];
  const zip=createStoreZip(entries);
  await assert.rejects(readStateFromBackupFile({name:`${item.id}.zip`,arrayBuffer:()=>zip.arrayBuffer()}),new RegExp(item.error),item.id);
}
const validHash=await sha256Hex(canonicalStringify(state));assert.equal(validHash.length,64);

const toss=await fixture('./fixtures/api/toss-contract-v1.json');
assert.equal(validateTossSnapshotPayload(toss.success),toss.success);
assert.equal(validateTossSnapshotPayload(toss.partial),toss.partial);
assert.deepEqual(toss.httpErrors.map(row=>row.status),[401,429,500,504]);
for(const invalid of [{...toss.success,orders:null},{...toss.success,syncStatus:'unknown'},{...toss.success,accountScopeId:'unsafe'}])assert.throws(()=>validateTossSnapshotPayload(invalid));

console.log(`Fixture contracts PASS: ${finance.cases.length} golden calculations, legacy migration, 4 corrupted backups, and Toss v1 contracts`);
