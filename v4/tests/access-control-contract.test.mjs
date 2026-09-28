import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {splitStateDocuments} from '../modules/cloud-contract.js';
import {blankState} from '../modules/state.js';

const repo=resolve(import.meta.dirname,'../..');
const rules=await readFile(resolve(repo,'firestore.rules'),'utf8');
assert.match(rules,/request\.auth\s*!=\s*null/,'anonymous Firestore access must be denied');
assert.match(rules,/request\.auth\.uid\s*==\s*uid/,'cross-user Firestore access must be denied');
assert.match(rules,/match \/users\/\{uid\}\/apps\/\{appId\}/,'app data must remain under its owner path');
assert.match(rules,/match \/\{document=\*\*\}/,'revision and segment descendants must inherit owner checks');
assert.doesNotMatch(rules,/allow\s+(read|write)[^;]*:\s*if\s+true/,'rules must never grant public access');

const oversized=blankState();
oversized.projects=[{...oversized.projects[0],name:'x'.repeat(710_000)}];
assert.throws(()=>splitStateDocuments(oversized),/안전 크기를 초과/,'oversized cloud payloads must be rejected before upload');
console.log('Access-control contract PASS: anonymous/cross-user/public access and oversized cloud payload are blocked by contract');
