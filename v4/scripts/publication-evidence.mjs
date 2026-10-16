import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validatePublicationEvidence} from './release-artifacts.mjs';
const root=resolve(import.meta.dirname,'../..');
const pkg=JSON.parse(readFileSync(resolve(root,'v4/package.json'),'utf8'));
const evidence=JSON.parse(readFileSync(resolve(root,'docs/releases',`${pkg.version}.publication.json`),'utf8'));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
validatePublicationEvidence(evidence,{root,head});
// Inspect without extracting: the signed bundle must contain exactly the built
// runtime inventory and the exact source bytes that CI verified.
execFileSync('python3',['-c',String.raw`
from pathlib import Path
import sys,json,zipfile,hashlib
root=Path(sys.argv[1]);version=sys.argv[2]
manifest=json.loads((root/'v4/dist/build-manifest.json').read_text())
with zipfile.ZipFile(root/('updates/DividendOS-web-'+version+'.zip')) as z:
 names=z.namelist();expected=set(manifest['files'])|{'build-manifest.json'}
 assert len(names)==len(expected) and set(names)==expected,'ZIP runtime inventory mismatch'
 assert sum(i.file_size for i in z.infolist())<=32*1024*1024,'ZIP expansion exceeds native limit'
 assert z.testzip() is None,'ZIP CRC check failed'
 assert json.loads(z.read('build-manifest.json'))==manifest,'ZIP build manifest mismatch'
 for name,digest in manifest['files'].items():
  value=z.read(name)
  assert hashlib.sha256(value).hexdigest()==digest,'ZIP runtime digest mismatch: '+name
  assert value==(root/'v4'/name).read_bytes(),'ZIP differs from tested runtime: '+name
print('Signed ZIP runtime and build manifest match all tested source files')
`,root,pkg.version],{stdio:'inherit'});
console.log(`Publication artifact checks PASS: ${pkg.version} / ${head.slice(0,12)}. Physical Galaxy and actual Toss acceptance are ${evidence.postPublicationChecks.galaxyS25Ultra.status}/${evidence.postPublicationChecks.tossReadOnly.status} after update; not claimed by CI.`);
