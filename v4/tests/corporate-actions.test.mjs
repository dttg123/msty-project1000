import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {liquidationCashBreakdown,recordLiquidation,securityStateAt,tickerChange} from '../modules/corporate-actions.js';
import {normalizeV4} from '../modules/state.js';
import {validateLedger} from '../modules/validation.js';
import {ledger,project,buy,dividend} from './factories/ledger-factory.mjs';

const fixture=JSON.parse(await readFile(new URL('./fixtures/corporate/lifecycle-v1.json',import.meta.url),'utf8'));
const security=project({securityId:fixture.securityId,symbol:'OLD',corporateActions:structuredClone(fixture.actions),status:'liquidated'});
assert.deepEqual(securityStateAt(security,'2026-12-31'),{symbol:'OLD',status:'active',liquidationNetUSD:0});
assert.deepEqual(securityStateAt(security,'2027-01-15'),{symbol:'NEW',status:'active',liquidationNetUSD:0});
assert.deepEqual(securityStateAt(security,'2028-06-01'),{symbol:'NEXT',status:'active',liquidationNetUSD:0});
assert.deepEqual(securityStateAt(security,'2030-12-31'),{symbol:'NEXT',status:'liquidated',liquidationNetUSD:980});

const editable=project({symbol:'OLD'}),trade=buy({symbol:'OLD'}),payment=dividend({symbol:'OLD'});
const stableId=editable.securityId;
assert.ok(tickerChange(editable,'NEW','2027-01-15','ca-change','2027-01-10T00:00:00.000Z'));
assert.equal(editable.symbol,'NEW');assert.equal(editable.securityId,stableId);
assert.equal(trade.symbol,'OLD');assert.equal(payment.symbol,'OLD','ticker changes must not rewrite historical source events');
assert.equal(tickerChange(editable,'NEW','2027-01-16','ca-noop'),null);
const liquidation=recordLiquidation(editable,{id:'ca-close',effectiveDate:'2030-01-01',grossProceedsUSD:100,feeUSD:2,taxUSD:3,createdAt:'2030-01-01T00:00:00.000Z'});
assert.deepEqual(liquidationCashBreakdown(liquidation),{grossUSD:100,feeUSD:2,taxUSD:3,netUSD:95});
assert.equal(editable.status,'liquidated');

const old=ledger({schemaVersion:undefined,projects:[{...project(),securityId:undefined,status:undefined,corporateActions:undefined}]});
const first=normalizeV4(old),second=normalizeV4(first);
assert.equal(first.schemaVersion,4);assert.equal(first.projects[0].securityId,'local:p-fixture');
assert.deepEqual(second,first,'schema normalization must be idempotent');
assert.deepEqual(validateLedger(first),[]);
const duplicate=structuredClone(first);duplicate.projects.push({...duplicate.projects[0],id:'p-second'});
assert.ok(validateLedger(duplicate).includes('종목 장기 식별자가 없거나 중복됩니다.'));

const malformed=structuredClone(first);malformed.projects[0].corporateActions=[null,42,'bad'];
assert.doesNotThrow(()=>validateLedger(malformed),'malformed corporate actions must be reported without crashing validation');
assert.ok(validateLedger(malformed).includes('기업행위 기록을 확인해 주세요.'));

console.log('Corporate actions PASS: stable securityId, ticker history, liquidation cash, validation, and idempotent schema migration');
