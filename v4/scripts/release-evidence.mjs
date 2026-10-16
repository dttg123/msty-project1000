import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {EVIDENCE_FORMAT,collectReleaseArtifacts,validateChecklist,validateReleaseEvidence} from './release-artifacts.mjs';

const root=resolve(import.meta.dirname,'..');
const repo=resolve(root,'..');
const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const template={
  format:EVIDENCE_FORMAT,commit:head,appVersion:pkg.version,completedAt:new Date().toISOString(),artifacts:collectReleaseArtifacts(repo),installedApk:{sourceCommit:head,sha256:''},
  galaxyS25Ultra:{status:'pending',source:'pending',flows:[]},
  tossReadOnly:{status:'pending',source:'pending',accountDataCaptured:false},
  backupRestore:{status:'pending',hashMatched:false},
  rollback:{status:'pending',localDataPreserved:false},
  pwaUpgrade:{status:'pending',localDataPreserved:false},
  qaCleanup:{status:'pending',projects:0,trades:0,dividends:0,tossConnections:0,cloudDocuments:0}
};

if(process.argv.includes('--template')){
  console.log(JSON.stringify(template,null,2));process.exit(0);
}
let evidence;
if(process.argv.includes('--check-release')){
  const file=resolve(repo,'docs/releases',`${pkg.version}.json`);
  if(!existsSync(file))throw new Error(`Current release evidence is missing: docs/releases/${pkg.version}.json`);
  evidence=JSON.parse(readFileSync(file,'utf8'));
}else if(process.argv.includes('--check-env')){
  if(!process.env.QA_RELEASE_EVIDENCE_JSON)throw new Error('QA_RELEASE_EVIDENCE_JSON is required for a Q3 release. Generate a starting record with npm run qa:release:evidence-template.');
  evidence=JSON.parse(process.env.QA_RELEASE_EVIDENCE_JSON);
}else{
  const index=process.argv.indexOf('--check');
  if(index<0||!process.argv[index+1])throw new Error('Use --template, --check <file>, or --check-env.');
  evidence=JSON.parse(readFileSync(resolve(process.cwd(),process.argv[index+1]),'utf8'));
}
if(evidence.format===EVIDENCE_FORMAT)validateReleaseEvidence(evidence,{root:repo,head});
else{
  if(process.argv.includes('--check-release'))throw new Error('Release evidence rejected: artifact-bound evidence is required for publication');
  if(evidence.commit!==head)throw new Error('Release evidence rejected: commit does not match the exact release candidate');
  validateChecklist(evidence,{appVersion:pkg.version});
}
console.log(`Q3 release evidence PASS: ${head.slice(0,12)} / ${pkg.version} / tested ${evidence.commit.slice(0,12)}`);
