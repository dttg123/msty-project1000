import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Run one bounded QA stage. Persist status before launching and on every output.
const root=fileURLToPath(new URL('../',import.meta.url));
const stage=process.argv[2];
const stages={
  release:['npm',['run','qa:release'],{}],
  browser:['npx',['playwright','test','--reporter=list,json'],{}],
  hard:['npx',['playwright','test','hard-multi-project.spec.mjs','--project=mobile-chromium','--workers=1','--reporter=list,json'],{QA_HARD_UI:'1'}],
  lifetime:['npx',['playwright','test','lifetime-ui.spec.mjs','--project=mobile-chromium','--workers=1','--reporter=list,json'],{QA_LIFETIME_UI:'1'}],
  high:['npx',['playwright','test','lifetime-high-ui.spec.mjs','--project=mobile-chromium','--workers=1','--reporter=list,json'],{QA_HIGH_LIFETIME_UI:'1'}],
  switching:['npx',['playwright','test','lifetime-switching-ui.spec.mjs','--project=mobile-chromium','--workers=1','--reporter=list,json'],{QA_SWITCHING_LIFETIME_UI:'1'}]
};
if(!stages[stage]){console.error('Usage: node scripts/qa-resume.mjs release|browser|hard|lifetime|high|switching');process.exit(2);}
const [command,args,extra]=stages[stage];
const dir=path.join(root,'test-results','resume');mkdirSync(dir,{recursive:true});
const id=new Date().toISOString().replace(/[:.]/g,'-');
const log=path.join(dir,`${stage}-${id}.log`);
const report=path.join(dir,`${stage}-${id}.json`);
const checkpoint=path.join(dir,`${stage}-checkpoint.json`);
const bundle=path.join(root,'../updates/DividendOS-web-1.4.0.zip');
const state={stage,status:'running',startedAt:new Date().toISOString(),command:[command,...args],log,report,bundleSha256:createHash('sha256').update(readFileSync(bundle)).digest('hex'),lastOutputAt:null,tail:''};
const save=()=>{state.updatedAt=new Date().toISOString();writeFileSync(checkpoint+'.tmp',JSON.stringify(state,null,2)+'\n');renameSync(checkpoint+'.tmp',checkpoint);};
save();
const child=spawn(command,args,{cwd:root,env:{...process.env,CI:'1',...extra,PLAYWRIGHT_JSON_OUTPUT_NAME:report},stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{appendFileSync(log,chunk);state.lastOutputAt=new Date().toISOString();state.tail=(state.tail+chunk.toString()).slice(-3000);save();process.stdout.write(chunk);});
const heartbeat=setInterval(()=>{save();console.log(`[QA ${stage}] running; last output ${state.lastOutputAt??'pending'}; checkpoint ${checkpoint}`);},30_000);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{state.status='interrupted';save();child.kill(signal);});
child.on('error',error=>{clearInterval(heartbeat);state.status='failed';state.error=error.message;save();process.exitCode=1;});
child.on('close',(code,signal)=>{clearInterval(heartbeat);if(state.status!=='interrupted')state.status=code===0?'passed':'failed';state.exitCode=code;state.signal=signal;state.completedAt=new Date().toISOString();save();console.log(`[QA ${stage}] ${state.status}: ${checkpoint}`);process.exitCode=code??1;});
