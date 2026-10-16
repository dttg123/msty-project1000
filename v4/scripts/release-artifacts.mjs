import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

export const EVIDENCE_FORMAT='dividend-os-release-evidence-v2';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=entries=>Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)));
const digestMap=entries=>hash(JSON.stringify(canonical(entries)));
const reject=(condition,message)=>{if(!condition)throw new Error(`Release evidence rejected: ${message}`);};
const git=(root,args)=>execFileSync('git',args,{cwd:root,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
const safePath=name=>typeof name==='string'&&/^[A-Za-z0-9_.\/-]+$/.test(name)&&!name.startsWith('/')&&!name.split('/').includes('..');

export function collectReleaseArtifacts(root,{reference=null,runtimePaths=null}={}){
  if(reference)reject(/^[a-f0-9]{40}$/.test(reference),'invalid tested commit');
  const read=name=>reference?git(root,['show',`${reference}:${name}`]):readFileSync(resolve(root,name));
  const pkg=JSON.parse(read('v4/package.json')),manifest=JSON.parse(read('updates/latest.json'));
  const names=runtimePaths||Object.keys(JSON.parse(readFileSync(resolve(root,'v4/dist/build-manifest.json'))).files);
  reject(names.length>0&&names.length<=300&&names.every(safePath),'invalid runtime inventory');
  for(const required of ['index.html','app.js','backup.js','storage.js','cloud.js','sw.js'])reject(names.includes(required),`runtime inventory missing ${required}`);
  const runtimeFiles=canonical(Object.fromEntries(names.map(name=>[name,hash(read('v4/'+name))])));
  const nativeNames=git(root,reference?['ls-tree','-r','--name-only',reference,'--','v4/android']:['ls-files','v4/android']).toString().trim().split('\n').filter(name=>name&&!name.includes('/src/androidTest/'));
  const nativeFiles=Object.fromEntries(nativeNames.map(name=>[name,hash(read(name))]));
  for(const name of ['v4/package-lock.json','v4/capacitor.config.ts'])nativeFiles[name]=hash(read(name));
  nativeFiles['dependency-declarations']=hash(JSON.stringify({dependencies:canonical(pkg.dependencies||{}),devDependencies:canonical(pkg.devDependencies||{}),overrides:canonical(pkg.overrides||{})}));
  const zip=read(`updates/DividendOS-web-${pkg.version}.zip`);
  reject(manifest.version===pkg.version&&hash(zip)===manifest.sha256,'signed update does not match the app version or ZIP');
  return {appVersion:pkg.version,webBundleSha256:hash(zip),updateManifestSha256:hash(read('updates/latest.json')),runtimeSha256:digestMap(runtimeFiles),runtimeFiles,nativeSourceSha256:digestMap(nativeFiles),websiteEntrySha256:digestMap(Object.fromEntries(['index.html','sw.js'].map(name=>[name,hash(read(name))])))};
}

export function validateChecklist(evidence,{appVersion,now=Date.now()}){
  reject(evidence.appVersion===appVersion,'appVersion does not match package.json');
  const time=Date.parse(evidence.completedAt);reject(Number.isFinite(time),'completedAt is invalid');
  reject(time<=now+5*60*1000,'evidence date is in the future');
  reject(now-time<=7*24*60*60*1000,'evidence is older than 7 days');
  reject(evidence.galaxyS25Ultra?.status==='passed'&&evidence.galaxyS25Ultra.flows?.length>=3,'Galaxy S25 Ultra needs at least three passed core flows');
  reject(evidence.tossReadOnly?.status==='passed'&&evidence.tossReadOnly.accountDataCaptured===false,'Toss read-only check is missing or captured account data');
  reject(evidence.backupRestore?.status==='passed'&&evidence.backupRestore.hashMatched===true,'restored backup hash did not match');
  for(const key of ['rollback','pwaUpgrade'])reject(evidence[key]?.status==='passed'&&evidence[key].localDataPreserved===true,`${key} did not confirm local data preservation`);
  const cleanup=evidence.qaCleanup||{};reject(cleanup.status==='passed','QA cleanup is not confirmed');
  for(const key of ['projects','trades','dividends','tossConnections','cloudDocuments'])reject(cleanup[key]===0,`QA cleanup ${key} is not zero`);
  const serialized=JSON.stringify(evidence).toLowerCase();
  for(const forbidden of ['clientsecret','accesstoken','refreshtoken','accountnumber'])reject(!serialized.includes(forbidden),`sensitive field ${forbidden} must not be recorded`);
}

export function validateReleaseEvidence(evidence,{root,head,now=Date.now()}){
  reject(evidence.format===EVIDENCE_FORMAT,'versioned artifact-bound evidence is required');
  reject(/^[a-f0-9]{40}$/.test(evidence.commit||''),'invalid tested commit');
  try{git(root,['merge-base','--is-ancestor',evidence.commit,head]);}catch{throw new Error('Release evidence rejected: tested commit is not an ancestor of this release');}
  const artifacts=evidence.artifacts;reject(artifacts&&artifacts.runtimeFiles,'artifact fingerprint is missing');
  const current=collectReleaseArtifacts(root),tested=collectReleaseArtifacts(root,{reference:evidence.commit,runtimePaths:Object.keys(artifacts.runtimeFiles)});
  for(const key of ['appVersion','webBundleSha256','updateManifestSha256','runtimeSha256','nativeSourceSha256','websiteEntrySha256']){
    reject(artifacts[key]===tested[key],`recorded ${key} does not match the tested commit`);
    reject(artifacts[key]===current[key],`${key} changed after device verification`);
  }
  reject(JSON.stringify(canonical(artifacts.runtimeFiles))===JSON.stringify(current.runtimeFiles),'runtime file inventory changed after device verification');
  reject(/^[a-f0-9]{64}$/.test(evidence.installedApk?.sha256||''),'installed APK digest is missing');
  reject(evidence.installedApk?.sourceCommit===evidence.commit,'installed APK source commit does not match');
  reject(evidence.galaxyS25Ultra?.source==='user-confirmation'&&evidence.tossReadOnly?.source==='user-confirmation','physical device and actual Toss evidence must identify their source');
  validateChecklist(evidence,{appVersion:current.appVersion,now});return current;
}

// Publication relies on automated CI; manual acceptance is recorded after users
// can install the signed update. It is never inferred from emulator results.
export const PUBLICATION_FORMAT='dividend-os-publication-v1';
export function validatePublicationEvidence(evidence,{root,head,now=Date.now()}){
  reject(evidence.format===PUBLICATION_FORMAT,'versioned publication record is required');
  reject(evidence.policy==='automated-before-publication/manual-after-update','publication policy is missing');
  reject(evidence.authorization?.source==='user-request'&&evidence.authorization?.inAppUpdate===true,'in-app publication authorization is missing');
  const at=Date.parse(evidence.preparedAt);reject(Number.isFinite(at)&&at<=now+5*60*1000&&now-at<=7*24*60*60*1000,'publication record date is invalid or stale');
  reject(/^[a-f0-9]{40}$/.test(evidence.commit||''),'invalid tested commit');
  try{git(root,['merge-base','--is-ancestor',evidence.commit,head]);}catch{throw new Error('Release evidence rejected: tested commit is not an ancestor of this publication');}
  const artifacts=evidence.artifacts;reject(artifacts&&artifacts.runtimeFiles,'publication artifact fingerprint is missing');
  const current=collectReleaseArtifacts(root),tested=collectReleaseArtifacts(root,{reference:evidence.commit,runtimePaths:Object.keys(artifacts.runtimeFiles)});
  reject(evidence.appVersion===current.appVersion,'publication app version changed');
  for(const key of ['appVersion','webBundleSha256','updateManifestSha256','runtimeSha256','nativeSourceSha256','websiteEntrySha256']){
    reject(artifacts[key]===tested[key],`recorded publication ${key} does not match tested source`);
    reject(artifacts[key]===current[key],`publication ${key} changed after automated verification`);
  }
  reject(JSON.stringify(canonical(artifacts.runtimeFiles))===JSON.stringify(current.runtimeFiles),'publication runtime file inventory changed');
  reject(evidence.postPublicationChecks?.phase==='after-update','manual acceptance must follow in-app update');
  for(const key of ['galaxyS25Ultra','tossReadOnly']){
    const check=evidence.postPublicationChecks[key];
    reject(check&&['pending','passed'].includes(check.status),`manual ${key} status must be explicit`);
    if(check.status==='passed')reject(check.source==='user-confirmation',`manual ${key} cannot be claimed by automation`);
  }
  return current;
}
