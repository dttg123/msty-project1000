import {readdir,readFile} from 'node:fs/promises';
import {resolve,relative,extname,basename} from 'node:path';
import {scanContent} from './security-policy.mjs';

const root=resolve(process.argv[2]||'.');
const ignored=new Set(['.git','node_modules','dist']);
const textExtensions=new Set(['.js','.mjs','.ts','.json','.html','.css','.md','.txt','.yml','.yaml','.webmanifest']);
const failures=[];

async function walk(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(ignored.has(entry.name))continue;
    const path=resolve(directory,entry.name);
    const relativePath=relative(root,path).replaceAll('\\','/');
    if(entry.isDirectory()){
      if(path===resolve(import.meta.dirname,'../test-results'))continue; // Git-ignored browser traces contain copies of the runtime.
      if(relativePath==='v4/android/app/src/main/assets/public')continue;
      await walk(path);continue;
    }
    if(!textExtensions.has(extname(entry.name))&&!['.nvmrc','.node-version','.gitignore'].includes(basename(entry.name)))continue;
    const content=await readFile(path,'utf8');
    for(const rule of scanContent(content)){
      // Firebase browser API keys identify the public project; access control
      // belongs to Firebase Auth and Firestore rules. Keep this exception exact.
      if(rule==='google-api-key'&&['v4/firebase.ts','v4/firebase.js'].includes(relativePath))continue;
      failures.push(`${relativePath}: ${rule}`);
    }
  }
}

await walk(root);
if(failures.length){
  console.error(`Secret scan failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('Secret scan PASS: no committed credential literals detected');
