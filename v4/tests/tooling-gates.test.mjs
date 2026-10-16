import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {scanContent} from '../scripts/security-policy.mjs';
import {createHash} from 'node:crypto';
import {EVIDENCE_FORMAT,PUBLICATION_FORMAT,collectReleaseArtifacts,validateReleaseEvidence,validatePublicationEvidence} from '../scripts/release-artifacts.mjs';

const fakeGitHubToken=['ghp_','123456789012345678901234567890'].join('');
assert.deepEqual(scanContent(`const token='${fakeGitHubToken}';`),['github-token']);
assert.deepEqual(scanContent("const secret=process.env.TOSS_CLIENT_SECRET;"),[]);
const securityCheck=readFileSync(resolve('scripts/security-check.mjs'),'utf8');
assert.ok(!securityCheck.includes("qa-candidate"),'retired preview copies must not retain security exceptions');


const directory=await mkdtemp(resolve(tmpdir(),'dividend-os-type-gate-'));
try{
  const fixture=resolve(directory,'intentional-error.ts');
  await writeFile(fixture,"const amount: number = 'blocked';\n");
  const tsc=resolve('node_modules/typescript/bin/tsc');
  const result=spawnSync(process.execPath,[tsc,'--strict','--noEmit','--skipLibCheck',fixture],{encoding:'utf8'});
  assert.notEqual(result.status,0,'TypeScript must block an intentional type error');
}finally{await rm(directory,{recursive:true,force:true});}

const releaseRepo=await mkdtemp(resolve(tmpdir(),'dividend-os-release-gate-'));
try{
  const put=async(name,data)=>{const file=resolve(releaseRepo,name);await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,data);};
  const git=(...args)=>execFileSync('git',['-c','user.name=Synthetic QA','-c','user.email=qa@example.test',...args],{cwd:releaseRepo,encoding:'utf8'}).trim();
  git('init','-q','--initial-branch=main');
  const files=Object.fromEntries(['index.html','app.js','backup.js','storage.js','cloud.js','sw.js'].map(name=>[name,'synthetic '+name]));
  for(const [name,body] of Object.entries(files))await put('v4/'+name,body);
  await put('v4/dist/build-manifest.json',JSON.stringify({files:Object.fromEntries(Object.keys(files).map(name=>[name,'unused-input-digest']))}));
  await put('index.html','synthetic entry');await put('sw.js','synthetic root worker');
  await put('v4/package.json',JSON.stringify({version:'1.7.0',dependencies:{native:'1.0.0'},scripts:{test:'synthetic'}}));
  await put('v4/package-lock.json','synthetic dependency lock');await put('v4/capacitor.config.ts','synthetic config');
  await put('v4/android/app/build.gradle','synthetic version 34');
  const zip=Buffer.from('PK\x03\x04synthetic hash-only ZIP fixture');
  await put('updates/DividendOS-web-1.7.0.zip',zip);
  await put('updates/latest.json',JSON.stringify({version:'1.7.0',sha256:createHash('sha256').update(zip).digest('hex')}));
  git('add','.');git('commit','-qm','Synthetic tested release');const commit=git('rev-parse','HEAD');
  const evidence={format:EVIDENCE_FORMAT,commit,appVersion:'1.7.0',completedAt:new Date().toISOString(),artifacts:collectReleaseArtifacts(releaseRepo),installedApk:{sourceCommit:commit,sha256:'a'.repeat(64)},galaxyS25Ultra:{status:'passed',source:'user-confirmation',flows:['synthetic home','synthetic portfolio','synthetic goals']},tossReadOnly:{status:'passed',source:'user-confirmation',accountDataCaptured:false},backupRestore:{status:'passed',hashMatched:true},rollback:{status:'passed',localDataPreserved:true},pwaUpgrade:{status:'passed',localDataPreserved:true},qaCleanup:{status:'passed',projects:0,trades:0,dividends:0,tossConnections:0,cloudDocuments:0}};
  const check=e=>validateReleaseEvidence(e,{root:releaseRepo,head:git('rev-parse','HEAD')});check(evidence);
  const publication={format:PUBLICATION_FORMAT,policy:'automated-before-publication/manual-after-update',commit,appVersion:'1.7.0',preparedAt:new Date().toISOString(),authorization:{source:'user-request',inAppUpdate:true},artifacts:evidence.artifacts,postPublicationChecks:{phase:'after-update',galaxyS25Ultra:{status:'pending',source:'pending'},tossReadOnly:{status:'pending',source:'pending'}}};
  const publish=e=>validatePublicationEvidence(e,{root:releaseRepo,head:git('rev-parse','HEAD')});
  publish(publication);assert.equal(publication.postPublicationChecks.galaxyS25Ultra.status,'pending');
  for(const mutate of [e=>delete e.artifacts,e=>e.commit='f'.repeat(40),e=>e.appVersion='1.8.0',e=>e.authorization.inAppUpdate=false,e=>e.policy='skip-ci',e=>e.postPublicationChecks.phase='before-publication',e=>delete e.postPublicationChecks.tossReadOnly,e=>e.postPublicationChecks.galaxyS25Ultra={status:'passed',source:'automated'},e=>e.preparedAt=new Date(Date.now()-8*86400000).toISOString(),e=>e.preparedAt=new Date(Date.now()+3600000).toISOString()]){
    const changed=structuredClone(publication);mutate(changed);assert.throws(()=>publish(changed),/Release evidence rejected/);
  }
  await put('docs/release-note.md','Synthetic metadata-only update');git('add','.');git('commit','-qm','Synthetic release documentation');
  assert.notEqual(git('rev-parse','HEAD'),commit);check(evidence);publish(publication);
  for(const [name,value] of [['v4/app.js','changed runtime'],['v4/storage.js','changed storage'],['v4/android/app/build.gradle','changed native'],['v4/package-lock.json','changed dependencies'],['v4/capacitor.config.ts','changed native config'],['index.html','changed entry'],['sw.js','changed root worker'],['updates/DividendOS-web-1.7.0.zip','changed ZIP'],['updates/latest.json','{}']]){
    const before=readFileSync(resolve(releaseRepo,name));await put(name,value);assert.throws(()=>check(evidence),/Release evidence rejected/);assert.throws(()=>publish(publication),/Release evidence rejected/);await put(name,before);
  }
  for(const mutate of [e=>e.appVersion='1.8.0',e=>e.commit='f'.repeat(40),e=>e.artifacts.webBundleSha256='0'.repeat(64),e=>delete e.artifacts,e=>delete e.installedApk,e=>e.galaxyS25Ultra.source='automated',e=>e.galaxyS25Ultra.flows=[],e=>e.tossReadOnly.status='pending',e=>e.qaCleanup.trades=1,e=>e.completedAt=new Date(Date.now()-8*24*60*60*1000).toISOString(),e=>e.completedAt=new Date(Date.now()+60*60*1000).toISOString()]){
    const changed=structuredClone(evidence);mutate(changed);assert.throws(()=>check(changed),/Release evidence rejected/);
  }
  check(evidence);publish(publication);
}finally{await rm(releaseRepo,{recursive:true,force:true});}
console.log('Tooling gates PASS: fake secret, type errors, stale/foreign evidence and changed runtime/native/update files blocked; metadata-only descendants preserve verified artifact evidence');
