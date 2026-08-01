export const APP_VERSION = '3.1.5';
export const DATA_SCHEMA_VERSION = 3.1;

const APP_FILES = [
  'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'app.js', 'firebase.js', 'auth.js', 'storage.js', 'cloud.js',
  'backup.js', 'sw.js'
];

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return encoder.encode(String(value));
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i=0;i<256;i++) {
    let c=i;
    for (let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
    table[i]=c>>>0;
  }
  return table;
})();

function crc32(bytes) {
  let crc=0xffffffff;
  for (const b of bytes) crc=crcTable[(crc^b)&0xff]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}

function dosDateTime(date=new Date()) {
  const year=Math.max(1980,date.getFullYear());
  const time=(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1);
  const day=(year-1980)<<9|(date.getMonth()+1)<<5|date.getDate();
  return {time,day};
}

function u16(view,offset,value){view.setUint16(offset,value,true);}
function u32(view,offset,value){view.setUint32(offset,value>>>0,true);}

export function createStoreZip(entries) {
  const now=dosDateTime();
  const records=[];
  let localOffset=0;
  for (const entry of entries) {
    const name=encoder.encode(entry.name.replace(/^\/+/,''));
    const data=asBytes(entry.data);
    const crc=crc32(data);
    const local=new Uint8Array(30+name.length+data.length);
    const lv=new DataView(local.buffer);
    u32(lv,0,0x04034b50); u16(lv,4,20); u16(lv,6,0x0800); u16(lv,8,0);
    u16(lv,10,now.time); u16(lv,12,now.day); u32(lv,14,crc);
    u32(lv,18,data.length); u32(lv,22,data.length); u16(lv,26,name.length); u16(lv,28,0);
    local.set(name,30); local.set(data,30+name.length);
    records.push({name,data,crc,local,offset:localOffset});
    localOffset+=local.length;
  }
  let centralSize=0;
  const centrals=records.map(r=>{
    const central=new Uint8Array(46+r.name.length);
    const cv=new DataView(central.buffer);
    u32(cv,0,0x02014b50); u16(cv,4,20); u16(cv,6,20); u16(cv,8,0x0800); u16(cv,10,0);
    u16(cv,12,now.time); u16(cv,14,now.day); u32(cv,16,r.crc);
    u32(cv,20,r.data.length); u32(cv,24,r.data.length); u16(cv,28,r.name.length);
    u16(cv,30,0); u16(cv,32,0); u16(cv,34,0); u16(cv,36,0); u32(cv,38,0); u32(cv,42,r.offset);
    central.set(r.name,46); centralSize+=central.length; return central;
  });
  const end=new Uint8Array(22); const ev=new DataView(end.buffer);
  u32(ev,0,0x06054b50); u16(ev,4,0); u16(ev,6,0); u16(ev,8,records.length); u16(ev,10,records.length);
  u32(ev,12,centralSize); u32(ev,16,localOffset); u16(ev,20,0);
  return new Blob([...records.map(r=>r.local),...centrals,end],{type:'application/zip'});
}

async function fetchAppFiles() {
  const entries=[];
  for (const file of APP_FILES) {
    const response=await fetch(`./${file}`,{cache:'no-store'});
    if(!response.ok) throw new Error(`앱 파일을 읽지 못했습니다: ${file}`);
    entries.push({name:`app/${file}`,data:new Uint8Array(await response.arrayBuffer())});
  }
  return entries;
}

export async function buildPortableBackup(state) {
  const exportedAt=new Date().toISOString();
  const info={
    product:'MSTY PROJECT 1000',
    appVersion:APP_VERSION,
    dataSchemaVersion:DATA_SCHEMA_VERSION,
    exportedAt,
    format:'portable-app-backup-v1',
    dataFile:'data/state.json',
    launchFile:'app/index.html'
  };
  return createStoreZip([
    {name:'backup-info.json',data:JSON.stringify(info,null,2)},
    {name:'data/state.json',data:JSON.stringify({...state,exportedAt,appVersion:APP_VERSION},null,2)},
    ...(await fetchAppFiles())
  ]);
}

export async function readStateFromBackupFile(file) {
  const lower=file.name.toLowerCase();
  if(!lower.endsWith('.zip')) throw new Error('이 앱에서 만든 ZIP 백업만 지원합니다.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  let offset=0;
  while(offset+30<=bytes.length) {
    const view=new DataView(bytes.buffer,bytes.byteOffset+offset);
    if(view.getUint32(0,true)!==0x04034b50) break;
    const flags=view.getUint16(6,true), method=view.getUint16(8,true);
    const size=view.getUint32(18,true), nameLen=view.getUint16(26,true), extraLen=view.getUint16(28,true);
    if(flags&0x0008) throw new Error('지원하지 않는 ZIP 형식입니다.');
    if(method!==0) throw new Error('압축된 ZIP은 지원하지 않습니다. 이 앱에서 만든 ZIP을 사용하세요.');
    const name=decoder.decode(bytes.slice(offset+30,offset+30+nameLen));
    const start=offset+30+nameLen+extraLen;
    if(name==='data/state.json') return JSON.parse(decoder.decode(bytes.slice(start,start+size)));
    offset=start+size;
  }
  throw new Error('ZIP 안에 data/state.json이 없습니다.');
}
