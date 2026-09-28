import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {migrate,normalizeV4} from '../modules/state.js';
import {validateLedger} from '../modules/validation.js';
import {createPortfolioEngine} from '../modules/portfolio.js';
import {buildCsvExports,buildPortableBackup,createStoreZip,readStateFromBackupFile} from '../backup.js';
import {canonicalStringify,sha256Hex,stateCounts} from '../modules/cloud-contract.js';

const fixtureUrl=new URL('./fixtures/golden-state-v4.json',import.meta.url);
const raw=JSON.parse(await readFile(fixtureUrl,'utf8'));
const state=normalizeV4(raw);
const engine=createPortfolioEngine(()=>state,()=>state.projects[0].id);
const calc=engine.computeProject(state.projects[0]);

assert.equal(calc.shares,110);
assert.ok(Math.abs(calc.costBasis-2291.6666666666665)<1e-8);
assert.ok(Math.abs(calc.realized-91.66666666666666)<1e-8);
assert.equal(calc.dividendsTotal,150);
assert.equal(calc.marketValue,3300);
assert.equal(calc.oversells.length,0);

const serialized=JSON.stringify(state);
const zip=createStoreZip([{name:'data/state.json',data:serialized}]);
const restored=await readStateFromBackupFile({name:'golden.zip',arrayBuffer:()=>zip.arrayBuffer()});
assert.deepEqual(restored,state);
const legacyV4=structuredClone(state);delete legacyV4.schemaVersion;
for(const project of legacyV4.projects){delete project.securityId;delete project.status;delete project.corporateActions;}
assert.deepEqual(validateLedger(migrate(legacyV4)),[],'pre-schema V4 backups must gain stable identity and corporate-action defaults before validation');
const csv=buildCsvExports(state);assert.deepEqual(csv.map(item=>item.name),['securities.csv','trades.csv','dividends.csv','goals.csv']);assert.match(csv[1].data,/feeUSD,taxUSD,currency,provider,sourceId/);assert.match(csv[2].data,/grossUSD,taxUSD,feeUSD,netUSD,status,currency,provider,sourceId/);
assert.equal(csv[0].data.split('\n').length,state.projects.length+1);assert.equal(csv[1].data.split('\n').length,state.trades.length+1);assert.equal(csv[2].data.split('\n').length,state.dividends.length+1);assert.equal(csv[3].data.split('\n').length,state.projects.length+1);
const info={counts:stateCounts(state),integrity:{algorithm:'SHA-256',hash:await sha256Hex(canonicalStringify(state))}};
const verified=createStoreZip([{name:'backup-info.json',data:JSON.stringify(info)},{name:'data/state.json',data:canonicalStringify(state)}]);
assert.deepEqual(await readStateFromBackupFile({name:'verified.zip',arrayBuffer:()=>verified.arrayBuffer()}),state);
const altered=structuredClone(state);altered.trades[0].price+=1;
const forged=createStoreZip([{name:'backup-info.json',data:JSON.stringify(info)},{name:'data/state.json',data:canonicalStringify(altered)}]);
await assert.rejects(readStateFromBackupFile({name:'forged.zip',arrayBuffer:()=>forged.arrayBuffer()}),/전체 무결성/);
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response('portable-runtime-file',{status:200});
try{const portable=await buildPortableBackup(state);assert.deepEqual(await readStateFromBackupFile({name:'portable.zip',arrayBuffer:()=>portable.arrayBuffer()}),state);}finally{globalThis.fetch=originalFetch;}
console.log('Golden contract PASS: ledger totals and backup round trip unchanged');
