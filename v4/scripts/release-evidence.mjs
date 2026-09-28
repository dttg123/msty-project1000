import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const template={
  commit:head,appVersion:pkg.version,completedAt:new Date().toISOString(),
  galaxyS25Ultra:{status:'pending',flows:[]},
  tossReadOnly:{status:'pending',accountDataCaptured:false},
  backupRestore:{status:'pending',hashMatched:false},
  rollback:{status:'pending',localDataPreserved:false},
  pwaUpgrade:{status:'pending',localDataPreserved:false},
  qaCleanup:{status:'pending',projects:0,trades:0,dividends:0,tossConnections:0,cloudDocuments:0}
};

if(process.argv.includes('--template')){
  console.log(JSON.stringify(template,null,2));process.exit(0);
}
let evidence;
if(process.argv.includes('--check-env')){
  if(!process.env.QA_RELEASE_EVIDENCE_JSON)throw new Error('QA_RELEASE_EVIDENCE_JSON is required for a Q3 release. Generate a starting record with npm run qa:release:evidence-template.');
  evidence=JSON.parse(process.env.QA_RELEASE_EVIDENCE_JSON);
}else{
  const index=process.argv.indexOf('--check');
  if(index<0||!process.argv[index+1])throw new Error('Use --template, --check <file>, or --check-env.');
  evidence=JSON.parse(await readFile(resolve(process.cwd(),process.argv[index+1]),'utf8'));
}
const fail=(condition,message)=>{if(!condition)throw new Error(`Release evidence rejected: ${message}`);};
fail(evidence.commit===head,'commit does not match the exact release candidate');
fail(evidence.appVersion===pkg.version,'appVersion does not match package.json');
fail(Number.isFinite(Date.parse(evidence.completedAt)),'completedAt is invalid');
fail(Date.now()-Date.parse(evidence.completedAt)<=7*24*60*60*1000,'evidence is older than 7 days');
fail(evidence.galaxyS25Ultra?.status==='passed'&&evidence.galaxyS25Ultra.flows?.length>=3,'Galaxy S25 Ultra needs at least three passed core flows');
fail(evidence.tossReadOnly?.status==='passed'&&evidence.tossReadOnly.accountDataCaptured===false,'Toss read-only check is missing or captured account data');
fail(evidence.backupRestore?.status==='passed'&&evidence.backupRestore.hashMatched===true,'restored backup hash did not match');
for(const key of ['rollback','pwaUpgrade'])fail(evidence[key]?.status==='passed'&&evidence[key].localDataPreserved===true,`${key} did not confirm local data preservation`);
const cleanup=evidence.qaCleanup||{};
fail(cleanup.status==='passed','QA cleanup is not confirmed');
for(const key of ['projects','trades','dividends','tossConnections','cloudDocuments'])fail(cleanup[key]===0,`QA cleanup ${key} is not zero`);
const serialized=JSON.stringify(evidence).toLowerCase();
for(const forbidden of ['clientsecret','accesstoken','refreshtoken','accountnumber'])fail(!serialized.includes(forbidden),`sensitive field ${forbidden} must not be recorded`);
console.log(`Q3 release evidence PASS: ${head.slice(0,12)} / ${pkg.version}`);
