import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeV4} from '../modules/state.js';
import {createPortfolioEngine} from '../modules/portfolio.js';
import {createStoreZip,readStateFromBackupFile} from '../backup.js';

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
console.log('Golden contract PASS: ledger totals and backup round trip unchanged');
