import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const profile=String(process.argv[2]||'core').toLowerCase();
const profiles=['fast','core','full','release'];
if(!profiles.includes(profile)){
  console.error(`Unknown QA profile: ${profile}. Use ${profiles.join(', ')}.`);
  process.exit(2);
}

const suites={
  fast:[
    'domain.test.mjs','finance.test.mjs','toss-client-security.test.mjs','toss-native.test.mjs',
    'hot-update.test.mjs','static.test.mjs','tooling-gates.test.mjs'
  ],
  core:[
    'fixture-contracts.test.mjs','activity.test.mjs','toss.test.mjs','cloud-contract.test.mjs',
    'home-metrics.test.mjs','demo.test.mjs','views.test.mjs',
    'interaction-contract.test.mjs','replacement.test.mjs','golden-contract.test.mjs'
  ],
  full:['corporate-actions.test.mjs','generator-contract.test.mjs','access-control-contract.test.mjs','pwa-contract.test.mjs','stress-10y.test.mjs'],
  release:['lifetime-30y.test.mjs','hardening.test.mjs']
};

const selected=profiles.slice(0,profiles.indexOf(profile)+1).flatMap(name=>suites[name]);
const npm=process.platform==='win32'?'npm.cmd':'npm';

function run(command,args,{env=process.env}={}){
  const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status??1);
}

console.log(`DividendOS QA ${profile.toUpperCase()}: ${selected.length} test suites`);
run(process.execPath,['scripts/verify-node-version.mjs']);
run(npm,['run','typecheck']);
for(const test of selected){
  const env=test==='hardening.test.mjs'?{...process.env,TZ:'Asia/Seoul'}:process.env;
  run(process.execPath,[`tests/${test}`],{env});
}
run(npm,['run','security']);
run(npm,['run','build']);
console.log(`DividendOS QA ${profile.toUpperCase()} PASS: ${selected.length} test suites`);
