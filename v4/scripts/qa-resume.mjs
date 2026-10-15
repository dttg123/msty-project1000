import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,renameSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Run one bounded QA stage. Persist status before launching and on every output.
const root=fileURLToPath(new URL('../',import.meta.url));
const stage=process.argv[2];
const dir=path.join(root,'test-results','resume');mkdirSync(dir,{recursive:true});
function sourceFingerprint(){
  const hash=createHash('sha256');
  function visit(relative=''){
    for(const entry of readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(['node_modules','dist','test-results','playwright-report','android','.generated','.review-build'].includes(entry.name)||entry.name.startsWith('.'))continue;
      const name=path.join(relative,entry.name);
      if(entry.isDirectory())visit(name);
      else if(/\.(?:ts|js|mjs|json|html|css)$/.test(name)){hash.update(name);hash.update(readFileSync(path.join(root,name)));}
    }
  }
  visit();return hash.digest('hex');
}
if(stage==='status'){
  const current=sourceFingerprint();
  for(const file of readdirSync(dir).filter(name=>name.endsWith('-checkpoint.json'))){
    const value=JSON.parse(readFileSync(path.join(dir,file),'utf8'));
    // PIDs are namespaced by the executor and cannot prove liveness in another
    // command. A missing heartbeat is stale evidence, never a successful run.
    const stale=Date.now()-Date.parse(value.updatedAt||value.startedAt)>90000;
    const status=value.status==='running'?(stale?'stale':'running-unconfirmed'):value.status;
    console.log(JSON.stringify({stage:value.stage,status,sourceMatches:value.sourceFingerprint===current,updatedAt:value.updatedAt,log:value.log,exitCode:value.exitCode??null}));
  }
  process.exit(0);
}
const stages={
  release:['npm',['run','qa:release'],{}],
  browser:['npx',['playwright','test','--reporter=list,json'],{}],
  hard:['npx',['playwright','test','hard-multi-project.spec.mjs','--project=mobile-chromium','--workers=1','--reporter=list,json'],{QA_HARD_UI:'1'}],
  lifetime:['npx',['playwright','test','lifetime-ui.spec.mjs','--project=mobile-chromium','--workers=1','--reporter=list,json'],{QA_LIFETIME_UI:'1'}],
  high:['npx',['playwright','test','lifetime-high-ui.spec.mjs','--project=mobile-chromium','--workers=1','--reporter=list,json'],{QA_HIGH_LIFETIME_UI:'1'}],
  switching:['npx',['playwright','test','lifetime-switching-ui.spec.mjs','--project=mobile-chromium','--workers=1','--reporter=list,json'],{QA_SWITCHING_LIFETIME_UI:'1'}]
};
if(stage==='extended'){
  const cases={
    'hard-8':['hard-multi-project.spec.mjs','8종목'],
    'hard-9':['hard-multi-project.spec.mjs','9종목'],
    lifetime:['lifetime-ui.spec.mjs','30년 월별'],
    'high-8':['lifetime-high-ui.spec.mjs','8종목'],
    'high-9':['lifetime-high-ui.spec.mjs','9종목'],
    switching:['lifetime-switching-ui.spec.mjs','9개 플러스']
  };
  const scenario=process.argv[3],browser=process.argv[4];
  if(!Object.hasOwn(cases,scenario)||!['mobile-chromium','desktop-chromium'].includes(browser))throw new Error('Choose an explicit extended scenario and browser.');
  const [file,grep]=cases[scenario];
  stages.extended=['npx',['playwright','test',file,'--grep',grep,'--project='+browser,'--workers=1','--reporter=line,json'],{QA_HARD_UI:'1',QA_LIFETIME_UI:'1',QA_HIGH_LIFETIME_UI:'1',QA_SWITCHING_LIFETIME_UI:'1',QA_EXTENDED_UI:'1'}];
}
if(!stages[stage]){console.error('Usage: node scripts/qa-resume.mjs release|browser|hard|lifetime|high|switching');process.exit(2);}
const [command,args,extra]=stages[stage];
const label=stage==='extended'?`${stage}-${process.argv[3]}-${process.argv[4]}`:stage;
const id=new Date().toISOString().replace(/[:.]/g,'-');
const log=path.join(dir,`${label}-${id}.log`);
const report=path.join(dir,`${label}-${id}.json`);
const checkpoint=path.join(dir,`${label}-checkpoint.json`);
const bundle=path.join(root,`../updates/DividendOS-web-${JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version}.zip`);
const state={stage:label,status:'running',pid:process.pid,sourceFingerprint:sourceFingerprint(),startedAt:new Date().toISOString(),command:[command,...args],log,report,bundleSha256:existsSync(bundle)?createHash('sha256').update(readFileSync(bundle)).digest('hex'):null,lastOutputAt:null,tail:''};
const save=()=>{state.updatedAt=new Date().toISOString();writeFileSync(checkpoint+'.tmp',JSON.stringify(state,null,2)+'\n');renameSync(checkpoint+'.tmp',checkpoint);};
save();
const child=spawn(command,args,{cwd:root,env:{...process.env,CI:'1',...extra,PLAYWRIGHT_JSON_OUTPUT_NAME:report},stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{appendFileSync(log,chunk);state.lastOutputAt=new Date().toISOString();state.tail=(state.tail+chunk.toString()).slice(-3000);save();process.stdout.write(chunk);});
const heartbeat=setInterval(()=>{save();console.log(`[QA ${stage}] running; last output ${state.lastOutputAt??'pending'}; checkpoint ${checkpoint}`);},30_000);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{state.status='interrupted';save();child.kill(signal);});
child.on('error',error=>{clearInterval(heartbeat);state.status='failed';state.error=error.message;save();process.exitCode=1;});
child.on('close',(code,signal)=>{clearInterval(heartbeat);if(state.status!=='interrupted')state.status=code===0?'passed':'failed';state.exitCode=code;state.signal=signal;state.completedAt=new Date().toISOString();save();console.log(`[QA ${stage}] ${state.status}: ${checkpoint}`);process.exitCode=code??1;});
