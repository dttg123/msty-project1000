import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {scanContent} from '../scripts/security-policy.mjs';

const fakeGitHubToken=['ghp_','123456789012345678901234567890'].join('');
assert.deepEqual(scanContent(`const token='${fakeGitHubToken}';`),['github-token']);
assert.deepEqual(scanContent("const secret=process.env.TOSS_CLIENT_SECRET;"),[]);
const securityCheck=readFileSync(resolve('scripts/security-check.mjs'),'utf8');
assert.ok(securityCheck.includes("'qa-candidate/firebase.js'"),'the generated QA preview may contain only the same public Firebase identifier exception as the canonical runtime');
assert.ok(!securityCheck.includes("'qa-candidate'"),'the full QA preview directory must remain covered by secret scanning');

const directory=await mkdtemp(resolve(tmpdir(),'dividend-os-type-gate-'));
try{
  const fixture=resolve(directory,'intentional-error.ts');
  await writeFile(fixture,"const amount: number = 'blocked';\n");
  const tsc=resolve('node_modules/typescript/bin/tsc');
  const result=spawnSync(process.execPath,[tsc,'--strict','--noEmit','--skipLibCheck',fixture],{encoding:'utf8'});
  assert.notEqual(result.status,0,'TypeScript must block an intentional type error');
}finally{await rm(directory,{recursive:true,force:true});}

console.log('Tooling gates PASS: fake secret and intentional type error blocked');
