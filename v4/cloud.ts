import { collection, doc, getDoc, getDocs, onSnapshot, runTransaction, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firestore } from './firebase.js';
import { assembleCloudState, assertCloudRevision, CLOUD_STORAGE_FORMAT, prepareCloudRevision } from './modules/cloud-contract.js';

const CLOUD_DOC_ID: any = 'dividend-os-v4';
const LEGACY_CLOUD_DOC_ID: any = 'msty-project1000';
const cloudRef: any=(uid: any,docId=CLOUD_DOC_ID)=>doc(firestore,'users',uid,'apps',docId);
const revisionRef: any=(uid: any,revisionId: any)=>doc(firestore,'users',uid,'apps',CLOUD_DOC_ID,'revisions',revisionId);
const revisionsRef: any=(uid: any)=>collection(firestore,'users',uid,'apps',CLOUD_DOC_ID,'revisions');
const segmentsRef: any=(uid: any,revisionId: any)=>collection(firestore,'users',uid,'apps',CLOUD_DOC_ID,'revisions',revisionId,'segments');

async function cleanupOldRevisions(uid: any,currentManifest: any): Promise<any> {
  const snapshots: any=await getDocs(revisionsRef(uid));
  const rows: any=snapshots.docs.map((item: any)=>({id:item.id,ref:item.ref,...item.data()}));
  const previous: any=rows.filter((row: any)=>row.id!==currentManifest.revisionId&&Number(row.revision)<Number(currentManifest.revision)).sort((a: any,b: any)=>Number(b.revision)-Number(a.revision))[0];
  const keep: any=new Set([currentManifest.revisionId,previous?.id].filter(Boolean)),remove=rows.filter((row: any)=>!keep.has(row.id)&&Number(row.revision)<Number(currentManifest.revision));
  const writes: any=[];
  for(const row of remove){const segments: any=await getDocs(segmentsRef(uid,row.id));for(const segment of segments.docs)writes.push(segment.ref);writes.push(row.ref);}
  for(let offset: any=0;offset<writes.length;offset+=450){const batch: any=writeBatch(firestore);for(const ref of writes.slice(offset,offset+450))batch.delete(ref);await batch.commit();}
}

async function readSplitDocument(uid: any,manifest: any): Promise<any> {
  const revisionSnapshot: any=await getDoc(revisionRef(uid,manifest.revisionId));
  if(!revisionSnapshot.exists())throw new Error('클라우드 revision 정보가 없습니다.');
  const revision: any=revisionSnapshot.data();
  if(revision.stateHash!==manifest.stateHash||revision.batchId!==manifest.batchId)throw new Error('클라우드 revision 포인터 검증에 실패했습니다.');
  const snapshots: any=await getDocs(segmentsRef(uid,manifest.revisionId));
  return {state:await assembleCloudState(manifest,snapshots.docs.map((item: any)=>item.data())),revision:manifest.revision,manifest,storageFormat:CLOUD_STORAGE_FORMAT};
}

export async function getCloudDocument(uid: any): Promise<any> {
  const snapshot: any=await getDoc(cloudRef(uid));
  if(!snapshot.exists())return null;
  const data: any=snapshot.data();
  if(data.storageFormat===CLOUD_STORAGE_FORMAT)return readSplitDocument(uid,data);
  return {...data,revision:Math.max(0,Number(data.revision)||0),storageFormat:'legacy-single-document',legacySingleDocument:true};
}

export async function getLegacyCloudDocument(uid: any): Promise<any> {
  const snapshot: any=await getDoc(cloudRef(uid,LEGACY_CLOUD_DOC_ID));
  return snapshot.exists()?snapshot.data():null;
}

export async function saveCloudDocument(uid: any,state: any,{expectedRevision=0,appVersion=''}: any ={}): Promise<any> {
  const prepared: any=await prepareCloudRevision(state,{expectedRevision});
  const writes: any=[...prepared.documents.map((document: any)=>({ref:doc(segmentsRef(uid,prepared.manifest.revisionId),document.id),data:document})),{ref:revisionRef(uid,prepared.manifest.revisionId),data:{...prepared.manifest,status:'ready',appVersion}}];
  for(let offset: any=0;offset<writes.length;offset+=450){
    const batch: any=writeBatch(firestore);
    for(const write of writes.slice(offset,offset+450))batch.set(write.ref,write.data);
    await batch.commit();
  }
  await runTransaction(firestore,async (transaction: any)=>{
    const root: any=cloudRef(uid),snapshot=await transaction.get(root),current=snapshot.exists()?snapshot.data():null;
    const actualRevision: any=current?.storageFormat===CLOUD_STORAGE_FORMAT?current.revision:Math.max(0,Number(current?.revision)||0);
    assertCloudRevision(expectedRevision,actualRevision);
    transaction.set(root,{...prepared.manifest,appVersion,updatedAt:serverTimestamp()});
  });
  cleanupOldRevisions(uid,prepared.manifest).catch(error=>console.warn('Old cloud revision cleanup deferred.',error));
  return {revision:prepared.manifest.revision,manifest:prepared.manifest};
}

export function subscribeCloudDocument(uid: any,onData: any,onError: any): any {
  let sequence: any=0;
  return onSnapshot(cloudRef(uid),(snapshot: any)=>{
    const current: any=++sequence;
    if(!snapshot.exists()){onData(null);return;}
    const data: any=snapshot.data();
    if(data.storageFormat!==CLOUD_STORAGE_FORMAT){onData({...data,revision:Math.max(0,Number(data.revision)||0),storageFormat:'legacy-single-document'});return;}
    readSplitDocument(uid,data).then(value=>{if(current===sequence)onData(value);}).catch(onError);
  },onError);
}
