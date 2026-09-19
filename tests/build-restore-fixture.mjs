import { readFile, writeFile } from 'node:fs/promises';
import { createStoreZip } from '../backup.js';
const data=await readFile(new URL('./fixtures/restore-qa.json',import.meta.url),'utf8');
const zip=createStoreZip([{name:'data/state.json',data}]);
await writeFile(new URL('./fixtures/restore-qa.zip',import.meta.url),Buffer.from(await zip.arrayBuffer()));
