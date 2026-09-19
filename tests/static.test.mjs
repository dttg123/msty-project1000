import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runtimeFiles=['index.html','styles.css','app.js','auth.js','backup.js','cloud.js','firebase.js','storage.js','sw.js','manifest.webmanifest','runtime-config.js','toss-client.js'];
for (const file of runtimeFiles) assert.ok(existsSync(resolve(root,file)),`missing ${file}`);

const modules=['constants.js','utils.js','state.js','portfolio.js','format.js','views.js','home-metrics.js','migration.js','toss.js'];
for (const file of modules) assert.ok(existsSync(resolve(root,'modules',file)),`missing modules/${file}`);

const index=readFileSync(resolve(root,'index.html'),'utf8');
assert.ok(index.includes('<link rel="stylesheet" href="./styles.css?v=0.10.0-r34" />'));
assert.ok(index.includes('<script type="module" src="./app.js?v=0.10.0-r34"></script>'));
assert.ok(index.includes('data-local-mode'));
assert.ok(!index.includes('<style>'));
for (const id of ['page-home','page-projects','page-goal','page-settings','modalBackdrop','restoreInput']) assert.ok(index.includes(`id="${id}"`),`missing DOM id ${id}`);
assert.equal((index.match(/class="nav-btn/g)||[]).length,3,'bottom navigation must have exactly three tabs');
assert.ok(index.includes('<span>홈</span>')&&index.includes('<span>포트폴리오</span>')&&index.includes('<span>목표</span>'));
assert.ok(!index.includes('<span>배당</span>'),'dividend detail must live in home and portfolio');
assert.ok(!index.includes('<span>설정</span>'),'settings must not be a bottom tab');
assert.ok(index.includes('data-page="settings" aria-label="설정 열기"'));

const app=readFileSync(resolve(root,'app.js'),'utf8');
const imports=[...app.matchAll(/from ['"](.+?)['"]/g)].map(match=>match[1]).filter(path=>path.startsWith('.'));
for (const path of imports) assert.ok(existsSync(resolve(root,path.split('?')[0])),`broken import ${path}`);

const sw=readFileSync(resolve(root,'sw.js'),'utf8');
const backup=readFileSync(resolve(root,'backup.js'),'utf8');
const auth=readFileSync(resolve(root,'auth.js'),'utf8');
for (const file of ['styles.css',...modules.map(name=>`modules/${name}`)]) {
  assert.ok(sw.includes(`./${file}`),`service worker missing ${file}`);
  assert.ok(backup.includes(`'${file}'`),`portable backup missing ${file}`);
}
assert.ok(sw.includes("dividend-os-v0.10.0-r34"));
assert.ok(sw.includes("cache: \'no-store\'"));
assert.ok(backup.includes("APP_VERSION = '0.10.0'"));
assert.ok(app.includes('name="amountUSD" type="number" min="0.01" step="0.01" required'));
assert.ok(app.includes("form.dataset.submitting==='true'"));
assert.ok(index.includes('app.js?v=0.10.0-r34'));
assert.ok(readFileSync(resolve(root,'modules/views.js'),'utf8').includes('tabindex="0" role="button"'));
assert.ok(readFileSync(resolve(root,'modules/views.js'),'utf8').includes('name="thresholdKRW" type="number" min="0" step="10000"'));
assert.ok(app.includes("prepareLegacyMigration"));
assert.ok(app.includes("V3.2.1 데이터를 V4에 복사했습니다."));
assert.ok(app.includes("storage.js?v=0.10.0-r34"));
assert.ok(readFileSync(resolve(root,'storage.js'),'utf8').includes('indexedDB.open(LEGACY_DB_NAME)'));
assert.ok(readFileSync(resolve(root,'storage.js'),'utf8').includes("storageMode='localstorage'"));
assert.ok(app.includes("toss-client.js?v=0.10.0-r34"));
assert.ok(app.includes("syncTossReadOnly"));
assert.ok(!readFileSync(resolve(root,'runtime-config.js'),'utf8').includes('client_secret'));
assert.ok(readFileSync(resolve(root,'toss-bridge/server.mjs'),'utf8').includes("app.get('/v1/toss/snapshot'"));
assert.ok(!readFileSync(resolve(root,'toss-bridge/server.mjs'),'utf8').includes("app.post('/api/v1/orders'"));
assert.ok(readFileSync(resolve(root,'toss-bridge/server.mjs'),'utf8').includes("'ALLOWED_FIREBASE_UID'"));
assert.ok(readFileSync(resolve(root,'toss-bridge/server.mjs'),'utf8').includes("/api/v1/prices?"));
assert.ok(app.includes('선택한 거래 조합은 과매도를 만들 수 있어 저장하지 않았습니다.'));
assert.ok(app.includes('fetchCurrentPublicIp'));
assert.ok(app.includes('testTossDirectConnection'));
assert.ok(auth.includes('signInWithRedirect'));
assert.ok(auth.includes('getRedirectResult'));
assert.ok(index.includes('로그인 없이 사용'));
assert.ok(app.includes("'[data-open-project],[data-goal-detail]'"));
assert.ok(readFileSync(resolve(root,'toss-client.js'),'utf8').includes("dividend-os-toss-direct-v1"));
assert.ok(!readFileSync(resolve(root,'modules/state.js'),'utf8').includes('clientSecret'));
console.log('DividendOS v0.10.0 static QA: PASS');
