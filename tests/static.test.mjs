import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runtimeFiles=['index.html','styles.css','app.js','auth.js','backup.js','cloud.js','firebase.js','storage.js','sw.js','manifest.webmanifest'];
for (const file of runtimeFiles) assert.ok(existsSync(resolve(root,file)),`missing ${file}`);

const modules=['constants.js','utils.js','state.js','portfolio.js','format.js','views.js'];
for (const file of modules) assert.ok(existsSync(resolve(root,'modules',file)),`missing modules/${file}`);

const index=readFileSync(resolve(root,'index.html'),'utf8');
assert.ok(index.includes('<link rel="stylesheet" href="./styles.css?v=0.9-r2" />'));
assert.ok(index.includes('<script type="module" src="./app.js?v=0.9-r2"></script>'));
assert.ok(!index.includes('<style>'));
for (const id of ['page-home','page-projects','page-goal','page-settings','modalBackdrop','restoreInput']) assert.ok(index.includes(`id="${id}"`),`missing DOM id ${id}`);

const app=readFileSync(resolve(root,'app.js'),'utf8');
const imports=[...app.matchAll(/from ['"](.+?)['"]/g)].map(match=>match[1]).filter(path=>path.startsWith('.'));
for (const path of imports) assert.ok(existsSync(resolve(root,path)),`broken import ${path}`);

const sw=readFileSync(resolve(root,'sw.js'),'utf8');
const backup=readFileSync(resolve(root,'backup.js'),'utf8');
for (const file of ['styles.css',...modules.map(name=>`modules/${name}`)]) {
  assert.ok(sw.includes(`./${file}`),`service worker missing ${file}`);
  assert.ok(backup.includes(`'${file}'`),`portable backup missing ${file}`);
}
assert.ok(sw.includes("dividend-os-v0.9-r2"));
assert.ok(sw.includes("cache: \'no-store\'"));
assert.ok(backup.includes("APP_VERSION = '0.9'"));
assert.ok(app.includes('name="amountUSD" type="number" min="0.01" step="0.01" required'));
console.log('DividendOS v0.9 static QA: PASS');
