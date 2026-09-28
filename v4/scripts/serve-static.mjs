import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, normalize, resolve, sep} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const port=Number(process.env.PORT||4173);
const host=process.env.HOST||'127.0.0.1';
const types=new Map([
  ['.css','text/css; charset=utf-8'],['.html','text/html; charset=utf-8'],
  ['.js','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],
  ['.mjs','text/javascript; charset=utf-8'],['.png','image/png'],
  ['.svg','image/svg+xml'],['.webmanifest','application/manifest+json; charset=utf-8'],
  ['.zip','application/zip']
]);

function localPath(url){
  const pathname=decodeURIComponent(new URL(url,'http://local.test').pathname);
  const relative=normalize(pathname==='/'?'index.html':pathname.replace(/^\/+/,''));
  const file=resolve(root,relative);
  return file===root||file.startsWith(root+sep)?file:null;
}

const server=createServer(async(req,res)=>{
  try{
    const file=localPath(req.url||'/');
    if(!file)throw Object.assign(new Error('Forbidden'),{code:'EACCES'});
    const info=await stat(file);
    if(!info.isFile())throw Object.assign(new Error('Not found'),{code:'ENOENT'});
    res.writeHead(200,{
      'Content-Type':types.get(extname(file))||'application/octet-stream',
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff'
    });
    if(req.method==='HEAD')return res.end();
    createReadStream(file).pipe(res);
  }catch(error){
    res.writeHead(error?.code==='EACCES'?403:404,{'Content-Type':'text/plain; charset=utf-8'});
    res.end(error?.code==='EACCES'?'Forbidden':'Not found');
  }
});

server.listen(port,host,()=>console.log(`DividendOS QA server: http://${host}:${port}`));

for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
