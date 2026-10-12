// A downloadable review copy: the same application UI and calculation engine,
// with synthetic data, a separate store, and no production account connections.
import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const output=resolve(process.argv[2]||resolve(root,'../../DividendOS-review.html'));
const esbuild=process.argv[3];if(!esbuild)throw new Error('Pass the installed esbuild executable as the third argument.');
const work=resolve(root,'.review-build');await rm(work,{recursive:true,force:true});await mkdir(work,{recursive:true});
const manifest=JSON.parse(await readFile(resolve(root,'dist/build-manifest.json'),'utf8'));
for(const file of Object.keys(manifest.files))await cp(resolve(root,'dist',file),resolve(work,file),{recursive:true,force:true}).catch(async error=>{if(error.code!=='ENOENT')throw error;const {dirname}=await import('node:path');await mkdir(dirname(resolve(work,file)),{recursive:true});await cp(resolve(root,'dist',file),resolve(work,file));});
let app=await readFile(resolve(work,'app.js'),'utf8');
app=app.replace("const demoMode = new URLSearchParams(location.search).get('demo') === '1';",'const demoMode = true;');
app=app.replace('state = demoState();','state = existing ? decodeAppState(existing) : demoState();');
app=app.replace('dividend-os-view-v2:', 'dividend-os-review-15-view:');
app=app.replace('테스트 데이터 · 실계좌/클라우드와 분리','배포 전 확인본 · 예시 데이터 · 실제 계좌 연결 없음');
await writeFile(resolve(work,'app.js'),app);
let storage=await readFile(resolve(work,'storage.js'),'utf8');
storage=storage.replace(/const demoMode = .*?;/,'const demoMode = true;').replaceAll('DividendOSDB_QA','DividendOSDB_REVIEW_15').replaceAll('dividend-os-qa:','dividend-os-review-15:');await writeFile(resolve(work,'storage.js'),storage);
let demo=await readFile(resolve(work,'modules/demo.js'),'utf8');
demo=demo.replace("'weekly', 238, 14.57", "'weekly', 250, 14.57").replace("targetUnits: 500,", "targetUnits: symbol === 'MSTY' ? 1000 : 500,").replace("state.settings.appearance = 'dark'", "state.settings.appearance = 'light'");await writeFile(resolve(work,'modules/demo.js'),demo);
await writeFile(resolve(work,'modules/cloud-api.js'),`export async function initGoogleAuth(){};export async function getGoogleIdToken(){return null;}export async function logoutGoogle(){};export async function getCloudDocument(){return null;}export async function getLegacyCloudDocument(){return null;}export async function saveCloudDocument(){throw new Error('확인본에서는 클라우드에 저장하지 않습니다.');}export async function subscribeCloudDocument(){return ()=>{};}`);
// Data ZIP export/restore is available. The review copy does not fetch an app
// directory: the normal multi-file candidate retains the full portable backup.
let backup=await readFile(resolve(work,'backup.js'),'utf8');
backup=backup.replace(/async function fetchAppFiles\(\) \{[\s\S]*?\n\}/,'async function fetchAppFiles() { return []; }');await writeFile(resolve(work,'backup.js'),backup);
const result=spawnSync(esbuild,[resolve(work,'app.js'),'--bundle','--format=iife','--platform=browser','--minify','--charset=utf8',`--outfile=${resolve(work,'review-bundle.js')}`],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
let html=await readFile(resolve(work,'index.html'),'utf8');
html=html.replace(/<link[^>]+(?:manifest|icon|preload|stylesheet)[^>]*>\s*/g,'').replace('<title>DividendOS · v1.4</title>','<title>DividendOS · 배포 전 확인본</title>');
const font=(await readFile(resolve(work,'fonts/PretendardVariable.woff2'))).toString('base64');
let css=(await readFile(resolve(work,'styles.css'),'utf8'))+'\n'+(await readFile(resolve(work,'styles-refined.css'),'utf8'));
css=css.replace("url('./fonts/PretendardVariable.woff2')",`url('data:font/woff2;base64,${font}')`);
html=html.replace('</head>',`<style>${css}</style></head>`);
const bundle=(await readFile(resolve(work,'review-bundle.js'),'utf8')).replaceAll('</script','<\\/script');
html=html.replace(/<script type="module" src="\.\/app\.js[^>]+><\/script>/,`<script>${bundle}</script>`);
if(/<script[^>]+src=|<link[^>]+href=|from ['"]https?:/.test(html))throw new Error('Review copy still has a remote runtime dependency.');
await writeFile(output,html);await rm(work,{recursive:true,force:true});console.log(`Review HTML ready: ${output}`);
