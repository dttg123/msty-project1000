import assert from 'node:assert/strict';
import { demoState } from '../modules/demo.js';

const state=demoState(new Date('2026-09-21T12:00:00Z'));
assert.equal(state.projects.length,6);
assert.equal(state.projects.filter(project=>project.category==='highYield').length,4);
assert.equal(state.projects.filter(project=>project.category==='growth').length,1);
assert.equal(state.projects.filter(project=>project.category==='dividend').length,1);
assert.deepEqual(state.projects.map(project=>project.symbol),['MSTY','CONY','NVDY','YMAX','SCHD','KO']);
assert.ok(state.projects.every(project=>state.dividends.some(row=>row.projectId===project.id&&row.date.startsWith('2026-09'))),'all six symbols must exercise current-month composition');
assert.ok(state.dividends.every(row=>row.date<='2026-09-21'),'demo must not manufacture future deposits');
console.log('DividendOS v0.11.3 six-symbol demo QA: PASS');
