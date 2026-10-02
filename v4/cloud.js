import { collection, doc, getDoc, getDocs, onSnapshot, runTransaction, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firestore } from './firebase.js';
import { assembleCloudState, assertCloudRevision, CLOUD_STORAGE_FORMAT, prepareCloudRevision } from './modules/cloud-contract.js';
const CLOUD_DOC_ID = 'dividend-os-v4';
const LEGACY_CLOUD_DOC_ID = 'msty-project1000';
const cloudRef = (uid, docId = CLOUD_DOC_ID) => doc(firestore, 'users', uid, 'apps', docId);
const revisionRef = (uid, revisionId) => doc(firestore, 'users', uid, 'apps', CLOUD_DOC_ID, 'revisions', revisionId);
const revisionsRef = (uid) => collection(firestore, 'users', uid, 'apps', CLOUD_DOC_ID, 'revisions');
const segmentsRef = (uid, revisionId) => collection(firestore, 'users', uid, 'apps', CLOUD_DOC_ID, 'revisions', revisionId, 'segments');
async function cleanupOldRevisions(uid, currentManifest) {
    const snapshots = await getDocs(revisionsRef(uid));
    const rows = snapshots.docs.map((item) => ({ id: item.id, ref: item.ref, ...item.data() }));
    const previous = rows.filter((row) => row.id !== currentManifest.revisionId && Number(row.revision) < Number(currentManifest.revision)).sort((a, b) => Number(b.revision) - Number(a.revision))[0];
    const keep = new Set([currentManifest.revisionId, previous?.id].filter(Boolean)), remove = rows.filter((row) => !keep.has(row.id) && Number(row.revision) < Number(currentManifest.revision));
    const writes = [];
    for (const row of remove) {
        const segments = await getDocs(segmentsRef(uid, row.id));
        for (const segment of segments.docs)
            writes.push(segment.ref);
        writes.push(row.ref);
    }
    for (let offset = 0; offset < writes.length; offset += 450) {
        const batch = writeBatch(firestore);
        for (const ref of writes.slice(offset, offset + 450))
            batch.delete(ref);
        await batch.commit();
    }
}
async function readSplitDocument(uid, manifest) {
    const revisionSnapshot = await getDoc(revisionRef(uid, manifest.revisionId));
    if (!revisionSnapshot.exists())
        throw new Error('클라우드 revision 정보가 없습니다.');
    const revision = revisionSnapshot.data();
    if (revision.stateHash !== manifest.stateHash || revision.batchId !== manifest.batchId)
        throw new Error('클라우드 revision 포인터 검증에 실패했습니다.');
    const snapshots = await getDocs(segmentsRef(uid, manifest.revisionId));
    return { state: await assembleCloudState(manifest, snapshots.docs.map((item) => item.data())), revision: manifest.revision, manifest, storageFormat: CLOUD_STORAGE_FORMAT };
}
export async function getCloudDocument(uid) {
    const snapshot = await getDoc(cloudRef(uid));
    if (!snapshot.exists())
        return null;
    const data = snapshot.data();
    if (data.storageFormat === CLOUD_STORAGE_FORMAT)
        return readSplitDocument(uid, data);
    return { ...data, revision: Math.max(0, Number(data.revision) || 0), storageFormat: 'legacy-single-document', legacySingleDocument: true };
}
export async function getLegacyCloudDocument(uid) {
    const snapshot = await getDoc(cloudRef(uid, LEGACY_CLOUD_DOC_ID));
    return snapshot.exists() ? snapshot.data() : null;
}
export async function saveCloudDocument(uid, state, { expectedRevision = 0, appVersion = '' } = {}) {
    const prepared = await prepareCloudRevision(state, { expectedRevision });
    const writes = [...prepared.documents.map((document) => ({ ref: doc(segmentsRef(uid, prepared.manifest.revisionId), document.id), data: document })), { ref: revisionRef(uid, prepared.manifest.revisionId), data: { ...prepared.manifest, status: 'ready', appVersion } }];
    for (let offset = 0; offset < writes.length; offset += 450) {
        const batch = writeBatch(firestore);
        for (const write of writes.slice(offset, offset + 450))
            batch.set(write.ref, write.data);
        await batch.commit();
    }
    await runTransaction(firestore, async (transaction) => {
        const root = cloudRef(uid), snapshot = await transaction.get(root), current = snapshot.exists() ? snapshot.data() : null;
        const actualRevision = current?.storageFormat === CLOUD_STORAGE_FORMAT ? current.revision : Math.max(0, Number(current?.revision) || 0);
        assertCloudRevision(expectedRevision, actualRevision);
        transaction.set(root, { ...prepared.manifest, appVersion, updatedAt: serverTimestamp() });
    });
    cleanupOldRevisions(uid, prepared.manifest).catch(error => console.warn('Old cloud revision cleanup deferred.', error));
    return { revision: prepared.manifest.revision, manifest: prepared.manifest };
}
export function subscribeCloudDocument(uid, onData, onError) {
    let sequence = 0;
    return onSnapshot(cloudRef(uid), (snapshot) => {
        const current = ++sequence;
        if (!snapshot.exists()) {
            onData(null);
            return;
        }
        const data = snapshot.data();
        if (data.storageFormat !== CLOUD_STORAGE_FORMAT) {
            onData({ ...data, revision: Math.max(0, Number(data.revision) || 0), storageFormat: 'legacy-single-document' });
            return;
        }
        readSplitDocument(uid, data).then(value => { if (current === sequence)
            onData(value); }).catch(onError);
    }, onError);
}
