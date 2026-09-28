import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const output=resolve(root,'dist');
const files=[
  'index.html','styles.css','styles-refined.css','manifest.webmanifest','icon-192.png','icon-512.png',
  'app.js','firebase.js','auth.js','storage.js','cloud.js','runtime-config.js','toss-client.js','backup.js','sw.js',
  'modules/activity.js','modules/constants.js','modules/utils.js','modules/state.js','modules/income.js',
  'modules/dividend-analytics.js','modules/finance.js','modules/corporate-actions.js','modules/cloud-api.js','modules/cloud-contract.js','modules/backup-history.js','modules/validation.js','modules/demo.js',
  'modules/portfolio.js','modules/format.js','modules/views.js','modules/home-metrics.js','modules/migration.js','modules/toss.js'
];

await rm(output,{recursive:true,force:true});
for(const file of files){
  const source=resolve(root,file),destination=resolve(output,file);
  await mkdir(dirname(destination),{recursive:true});
  await cp(source,destination);
}
const manifest={schemaVersion:1,files:{}};
for(const file of [...files].sort()){
  const bytes=await readFile(resolve(output,file));
  manifest.files[file]=createHash('sha256').update(bytes).digest('hex');
}
await writeFile(resolve(output,'build-manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
console.log(`Reproducible static build PASS: ${files.length} runtime files`);
