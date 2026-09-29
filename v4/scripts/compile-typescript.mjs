import {cp,mkdir,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..'),generated=resolve(root,'.generated'),tsc=resolve(root,'node_modules/typescript/bin/tsc');
await rm(generated,{recursive:true,force:true});
const result=spawnSync(process.execPath,[tsc,'-p',resolve(root,'tsconfig.emit.json')],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
const runtimeSources=[
  'app','auth','backup','cloud','firebase','runtime-config','storage','sw','toss-client','toss-native',
  'modules/activity','modules/backup-history','modules/cloud-api','modules/cloud-contract','modules/constants','modules/demo',
  'modules/dividend-analytics','modules/finance','modules/format','modules/home-metrics','modules/income','modules/migration',
  'modules/portfolio','modules/state','modules/toss','modules/utils','modules/validation','modules/views','modules/corporate-actions'
];
const outputs=runtimeSources.map(path=>[`${path}.js`,`${path}.js`]);
const checkOnly=process.argv.includes('--check');
for(const [source,target] of outputs){
  const generatedFile=resolve(generated,source),destination=resolve(root,target);
  if(checkOnly){
    const [expected,actual]=await Promise.all([readFile(generatedFile,'utf8'),readFile(destination,'utf8').catch(()=> '')]);
    if(expected!==actual){console.error(`Generated runtime is stale: ${target}`);process.exitCode=1;}
  }else{
    await mkdir(dirname(destination),{recursive:true});await cp(generatedFile,destination);
  }
}
await rm(generated,{recursive:true,force:true});
if(process.exitCode)process.exit(process.exitCode);
console.log(`TypeScript emit ${checkOnly?'CHECK':'PASS'}: ${outputs.length} runtime modules`);
