import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonicalStringify,sha256Hex} from '../modules/cloud-contract.js';
import {createPortfolioEngine} from '../modules/portfolio.js';
import {validateLedger} from '../modules/validation.js';
import {generateLifetimeLedger,lifetimeSummary} from './generators/lifetime-ledger.mjs';

const contract=JSON.parse(await readFile(new URL('./fixtures/generators/lifetime-profiles-v1.json',import.meta.url),'utf8'));
for(const [name,profile] of Object.entries(contract.profiles)){
  const state=generateLifetimeLedger(profile),again=generateLifetimeLedger(profile);
  const context=`${name} seed=${profile.seed}`;
  assert.deepEqual(again,state,`${context}: generation must be deterministic`);
  assert.deepEqual(lifetimeSummary(state),profile.summary,`${context}: summary drift`);
  assert.equal(await sha256Hex(canonicalStringify(state)),profile.hash,`${context}: event hash drift`);
  assert.deepEqual(validateLedger(state),[],`${context}: generated ledger must validate`);
  const engine=createPortfolioEngine(()=>state,()=>state.projects[0].id),calculations=state.projects.map(project=>engine.computeProject(project));
  for(const calc of calculations){
    assert.ok(Number.isFinite(calc.shares)&&calc.shares>=0,`${context} ${calc.project.symbol}: shares`);
    assert.ok(Number.isFinite(calc.costBasis)&&calc.costBasis>=0,`${context} ${calc.project.symbol}: basis`);
    assert.ok(Number.isFinite(calc.dividendsTotal)&&calc.dividendsTotal>=0,`${context} ${calc.project.symbol}: dividends`);
    assert.equal(calc.oversells.length,0,`${context} ${calc.project.symbol}: oversell`);
  }
  const reversed=structuredClone(state);reversed.trades.reverse();reversed.dividends.reverse();reversed.splits.reverse();
  const reversedEngine=createPortfolioEngine(()=>reversed,()=>reversed.projects[0].id);
  calculations.forEach((calc,index)=>{
    const other=reversedEngine.computeProject(reversed.projects[index]);
    for(const key of ['shares','costBasis','realized','dividendsTotal','totalBuyCashOut','totalSellCashIn'])assert.equal(other[key],calc[key],`${context} ${calc.project.symbol}: order-independent ${key}`);
  });
}
const changed=generateLifetimeLedger({years:5,seed:5006});
assert.notEqual(await sha256Hex(canonicalStringify(changed)),contract.profiles['5y'].hash,'different seed must change the event hash');
console.log(`Generator contract PASS: ${Object.keys(contract.profiles).join(', ')} deterministic profiles with stable hashes and invariants`);
