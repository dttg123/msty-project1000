export const APP_VERSION: any = '0.12.21';
export const DATA_SCHEMA_VERSION: any = 4;

import { canonicalStringify, sha256Hex, stateCounts } from './modules/cloud-contract.js';

const APP_FILES: any = [
  'index.html', 'styles.css', 'styles-refined.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'app.js', 'firebase.js', 'auth.js', 'storage.js', 'cloud.js', 'runtime-config.js', 'toss-client.js', 'toss-native.js',
  'backup.js', 'sw.js',
  'modules/activity.js', 'modules/constants.js', 'modules/utils.js', 'modules/state.js',
  'modules/income.js', 'modules/dividend-analytics.js', 'modules/finance.js', 'modules/corporate-actions.js', 'modules/cloud-api.js', 'modules/cloud-contract.js', 'modules/backup-history.js', 'modules/validation.js', 'modules/demo.js', 'modules/portfolio.js', 'modules/format.js', 'modules/views.js', 'modules/home-metrics.js', 'modules/migration.js', 'modules/toss.js'
];

const encoder: any = new TextEncoder();
const decoder: any = new TextDecoder('utf-8');

function asBytes(value: any): any {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return encoder.encode(String(value));
}

const crcTable: any = (() => {
  const table: any = new Uint32Array(256);
  for (let i: any=0;i<256;i++) {
    let c: any=i;
    for (let k: any=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
    table[i]=c>>>0;
  }
  return table;
})();

function crc32(bytes: any): any {
  let crc: any=0xffffffff;
  for (const b of bytes) crc=crcTable[(crc^b)&0xff]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}

function dosDateTime(date=new Date()) {
  const year: any=Math.max(1980,date.getFullYear());
  const time: any=(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1);
  const day: any=(year-1980)<<9|(date.getMonth()+1)<<5|date.getDate();
  return {time,day};
}

function u16(view: any,offset: any,value: any): any{view.setUint16(offset,value,true);}
function u32(view: any,offset: any,value: any): any{view.setUint32(offset,value>>>0,true);}

export function createStoreZip(entries: any): any {
  const now: any=dosDateTime();
  const records: any=[];
  let localOffset: any=0;
  for (const entry of entries) {
    const name: any=encoder.encode(entry.name.replace(/^\/+/,''));
    const data: any=asBytes(entry.data);
    const crc: any=crc32(data);
    const local: any=new Uint8Array(30+name.length+data.length);
    const lv: any=new DataView(local.buffer);
    u32(lv,0,0x04034b50); u16(lv,4,20); u16(lv,6,0x0800); u16(lv,8,0);
    u16(lv,10,now.time); u16(lv,12,now.day); u32(lv,14,crc);
    u32(lv,18,data.length); u32(lv,22,data.length); u16(lv,26,name.length); u16(lv,28,0);
    local.set(name,30); local.set(data,30+name.length);
    records.push({name,data,crc,local,offset:localOffset});
    localOffset+=local.length;
  }
  let centralSize: any=0;
  const centrals: any=records.map((r: any)=>{
    const central: any=new Uint8Array(46+r.name.length);
    const cv: any=new DataView(central.buffer);
    u32(cv,0,0x02014b50); u16(cv,4,20); u16(cv,6,20); u16(cv,8,0x0800); u16(cv,10,0);
    u16(cv,12,now.time); u16(cv,14,now.day); u32(cv,16,r.crc);
    u32(cv,20,r.data.length); u32(cv,24,r.data.length); u16(cv,28,r.name.length);
    u16(cv,30,0); u16(cv,32,0); u16(cv,34,0); u16(cv,36,0); u32(cv,38,0); u32(cv,42,r.offset);
    central.set(r.name,46); centralSize+=central.length; return central;
  });
  const end: any=new Uint8Array(22); const ev: any=new DataView(end.buffer);
  u32(ev,0,0x06054b50); u16(ev,4,0); u16(ev,6,0); u16(ev,8,records.length); u16(ev,10,records.length);
  u32(ev,12,centralSize); u32(ev,16,localOffset); u16(ev,20,0);
  return new Blob([...records.map((r: any)=>r.local),...centrals,end],{type:'application/zip'});
}

async function fetchAppFiles(): Promise<any> {
  const entries: any=[];
  for (const file of APP_FILES) {
    const response: any=await fetch(`./${file}`,{cache:'no-store'});
    if(!response.ok) throw new Error(`앱 파일을 읽지 못했습니다: ${file}`);
    entries.push({name:`app/${file}`,data:new Uint8Array(await response.arrayBuffer())});
  }
  return entries;
}

export async function buildPortableBackup(state: any): Promise<any> {
  const exportedAt: any=new Date().toISOString();
  const serialized: any=canonicalStringify(state),counts=stateCounts(state),integrityHash=await sha256Hex(serialized);
  const info: any={
    product:'DividendOS',
    appVersion:APP_VERSION,
    dataSchemaVersion:DATA_SCHEMA_VERSION,
    exportedAt,
    format:'portable-app-backup-v2',
    dataFile:'data/state.json',
    launchFile:'app/index.html',
    counts,
    integrity:{algorithm:'SHA-256',hash:integrityHash}
  };
  return createStoreZip([
    {name:'backup-info.json',data:JSON.stringify(info,null,2)},
    {name:'data/state.json',data:serialized},
    ...buildCsvExports(state).map((entry: any)=>({name:`data/csv/${entry.name}`,data:entry.data})),
    ...(await fetchAppFiles())
  ]);
}

function csvCell(value: any): any{const text: any=String(value??'');return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;}
function csv(name: any,headers: any,rows: any): any{return {name,data:'\ufeff'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\n')};}

export function buildCsvExports(state: any ={}): any {
  const projects: any=Array.isArray(state.projects)?state.projects:[],byId=new Map(projects.map((project: any)=>[project.id,project]));
  const source: any=(row: any)=>[row.importSource||row.source?.provider||'manual',row.sourceId||row.source?.sourceId||'',row.currency||'USD'];
  return [
    csv('securities.csv',['securityId','ticker','name','category','currency','archived'],projects.map((project: any)=>[project.id,project.symbol,project.name,project.category,project.currency||'USD',!!project.archived])),
    csv('trades.csv',['id','securityId','ticker','date','type','buyType','shares','priceUSD','feeUSD','taxUSD','currency','provider','sourceId','note'],(state.trades||[]).map((row: any)=>{const project: any=byId.get(row.projectId);const [provider,sourceId,currency]=source(row);return [row.id,row.projectId,project?.symbol||row.symbol||'',row.date,row.type,row.buyType||'',row.shares,row.price,row.feeUSD||0,row.taxUSD||0,currency,provider,sourceId,row.note||''];})),
    csv('dividends.csv',['id','securityId','ticker','date','grossUSD','taxUSD','feeUSD','netUSD','status','currency','provider','sourceId','note','amountKRW'],(state.dividends||[]).map((row: any)=>{const project: any=byId.get(row.projectId);const [provider,sourceId,currency]=source(row);const gross: any=Number(row.grossAmountUSD??row.amountUSD??0),tax=Number(row.taxUSD||0),fee=Number(row.feeUSD||0);return [row.id,row.projectId,project?.symbol||row.symbol||'',row.date,gross,tax,fee,Number(row.amountUSD??gross-tax-fee),row.status||'actual',row.currency||currency,provider,sourceId,row.note||'',row.amountKRW??''];})),
    csv('goals.csv',['securityId','ticker','targetUnits','monthlyPlanShares','projectStart','afterGoalMode','recoveryLocked','recoveryBasis','recoveryStartDate'],projects.map((project: any)=>[project.id,project.symbol,project.targetUnits,project.monthlyPlanShares,project.projectStart,project.afterGoalMode,!!project.recovery?.locked,project.recovery?.basis||0,project.recovery?.startDate||'']))
  ];
}

export function buildCsvExportZip(state: any): any { return createStoreZip(buildCsvExports(state)); }

function readStoreZip(bytes: any): any {
  const entries: any=new Map();let offset: any=0;
  while(offset+30<=bytes.length){
    const view: any=new DataView(bytes.buffer,bytes.byteOffset+offset);if(view.getUint32(0,true)!==0x04034b50)break;
    const flags: any=view.getUint16(6,true),method=view.getUint16(8,true),size=view.getUint32(18,true),nameLen=view.getUint16(26,true),extraLen=view.getUint16(28,true);
    if(flags&0x0008)throw new Error('지원하지 않는 ZIP 형식입니다.');if(method!==0)throw new Error('압축된 ZIP은 지원하지 않습니다. 이 앱에서 만든 ZIP을 사용하세요.');
    const name: any=decoder.decode(bytes.slice(offset+30,offset+30+nameLen)),start=offset+30+nameLen+extraLen;if(start+size>bytes.length)throw new Error('백업 파일 일부가 손상되었습니다.');
    const data: any=bytes.slice(start,start+size);if(crc32(data)!==view.getUint32(14,true))throw new Error('백업 데이터 검증에 실패했습니다.');entries.set(name,data);offset=start+size;
  }
  return entries;
}

export async function readStateFromBackupFile(file: any): Promise<any> {
  const lower: any=file.name.toLowerCase();
  if(!lower.endsWith('.zip')) throw new Error('이 앱에서 만든 ZIP 백업만 지원합니다.');
  const bytes: any=new Uint8Array(await file.arrayBuffer());
  const entries: any=readStoreZip(bytes),data=entries.get('data/state.json');
  if(!data)throw new Error('ZIP 안에 data/state.json이 없습니다.');
  const text: any=decoder.decode(data),parsed=JSON.parse(text);
  if(!parsed||!Array.isArray(parsed.trades)||!Array.isArray(parsed.dividends))throw new Error('원장 데이터가 없습니다.');
  const infoBytes: any=entries.get('backup-info.json');
  if(infoBytes){
    const info: any=JSON.parse(decoder.decode(infoBytes)),expected=info?.integrity?.hash;
    if(expected&&await sha256Hex(canonicalStringify(parsed))!==expected)throw new Error('백업 전체 무결성 검증에 실패했습니다.');
    if(info?.counts&&canonicalStringify(info.counts)!==canonicalStringify(stateCounts(parsed)))throw new Error('백업 데이터 건수 검증에 실패했습니다.');
  }
  return parsed;
}
