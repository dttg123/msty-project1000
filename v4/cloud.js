import { collection, doc, getDoc, getDocs, onSnapshot, runTransaction, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firestore } from './firebase.js';
import { assembleCloudState, assertCloudRevision, CLOUD_STORAGE_FORMAT, CLOUD_DELTA_STORAGE_FORMAT, prepareDeltaRevision, assembleDeltaState, canonicalStringify, sha256Hex, utf8Bytes } from './modules/cloud-contract.js';
const CLOUD_DOC_ID = 'dividend-os-ledger-v2';
const FUNDING_CLOUD_DOC_ID = 'dividend-os-funding-v1';
const PREVIOUS_CLOUD_DOC_ID = 'dividend-os-v4';
const LEGACY_CLOUD_DOC_ID = 'msty-project1000';
const cloudRef = (uid, docId = CLOUD_DOC_ID) => doc(firestore, 'users', uid, 'apps', docId);
const revisionRef = (uid, revisionId) => doc(firestore, 'users', uid, 'apps', CLOUD_DOC_ID, 'revisions', revisionId);
const revisionsRef = (uid) => collection(firestore, 'users', uid, 'apps', CLOUD_DOC_ID, 'revisions');
async function readSplitDocument(uid, manifest, docId = CLOUD_DOC_ID) {
    if (typeof manifest.revisionId !== 'string')
        throw new Error('클라우드 revision 정보가 올바르지 않습니다.');
    const revisionSnapshot = await getDoc(doc(firestore, 'users', uid, 'apps', docId, 'revisions', manifest.revisionId));
    if (!revisionSnapshot.exists())
        throw new Error('클라우드 revision 정보가 없습니다.');
    const revision = revisionSnapshot.data();
    if (revision.stateHash !== manifest.stateHash || revision.batchId !== manifest.batchId)
        throw new Error('클라우드 revision 포인터 검증에 실패했습니다.');
    const snapshots = await getDocs(collection(firestore, 'users', uid, 'apps', docId, 'revisions', manifest.revisionId, 'segments'));
    return { state: await assembleCloudState(manifest, snapshots.docs.map((item) => item.data())), revision: Math.max(0, Number(manifest.revision) || 0), manifest, storageFormat: CLOUD_STORAGE_FORMAT };
}
async function assertLegacySource(uid, value) {
    if (!value || typeof value !== 'object')
        return;
    const source = value;
    if (![FUNDING_CLOUD_DOC_ID, PREVIOUS_CLOUD_DOC_ID].includes(String(source.appId)) || typeof source.hash !== 'string')
        throw new Error('이전 클라우드 원본 정보 오류');
    const snapshot = await getDoc(cloudRef(uid, String(source.appId)));
    if (!snapshot.exists() || await sha256Hex(canonicalStringify(snapshot.data())) !== source.hash)
        throw new Error('이전 버전에서 클라우드 기록이 변경되었습니다. 두 원본을 보존하고 자동 덮어쓰기를 중단했습니다.');
}
async function readDeltaDocument(uid, data) {
    await assertLegacySource(uid, data.legacySource);
    if (typeof data.revisionId !== 'string' || !Array.isArray(data.segments))
        throw new Error('클라우드 원장 목차 오류');
    const revision = await getDoc(revisionRef(uid, data.revisionId));
    if (!revision.exists() || revision.data().stateHash !== data.stateHash || revision.data().batchId !== data.batchId)
        throw new Error('클라우드 게시 포인터 검증 실패');
    const snapshots = await Promise.all(data.segments.map((item) => { if (typeof item.contentId !== 'string' || !/^[a-f0-9]{64}$/.test(item.contentId))
        throw new Error('클라우드 조각 주소 오류'); return getDoc(doc(firestore, 'users', uid, 'apps', CLOUD_DOC_ID, 'segments', item.contentId)); }));
    return { state: await assembleDeltaState(data, snapshots.filter(item => item.exists()).map(item => item.data())), revision: Number(data.revision) || 0, storageFormat: CLOUD_DELTA_STORAGE_FORMAT, manifest: data };
}
export async function getCloudDocument(uid) {
    const snapshot = await getDoc(cloudRef(uid));
    if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.storageFormat !== CLOUD_DELTA_STORAGE_FORMAT)
            throw new Error('지원하지 않는 새 저장소 형식입니다. 원본을 유지합니다.');
        return readDeltaDocument(uid, data);
    }
    for (const appId of [FUNDING_CLOUD_DOC_ID, PREVIOUS_CLOUD_DOC_ID]) {
        const previous = await getDoc(cloudRef(uid, appId));
        if (!previous.exists())
            continue;
        const data = previous.data(), imported = data.storageFormat === CLOUD_STORAGE_FORMAT ? await readSplitDocument(uid, data, appId) : data;
        return { ...imported, revision: 0, storageFormat: 'previous-funding-contract', legacySingleDocument: true };
    }
    return null;
}
export async function getLegacyCloudDocument(uid) { const snapshot = await getDoc(cloudRef(uid, LEGACY_CLOUD_DOC_ID)); return snapshot.exists() ? snapshot.data() : null; }
async function cleanupDelta(uid, manifest) {
    const current = await getDoc(cloudRef(uid));
    if (!current.exists() || current.data().revision !== manifest.revision)
        return;
    const snapshots = await getDocs(revisionsRef(uid)), rows = snapshots.docs.map(item => ({ id: item.id, ref: item.ref, data: item.data() })), previous = rows.find(item => item.id === manifest.previousRevisionId);
    const keep = new Set(manifest.segments.map(item => item.contentId));
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000, remove = [];
    for (const row of rows)
        if (row.id === previous?.id || Number(row.data.revision) >= manifest.revision || !(Date.parse(row.data.createdAt) < cutoff))
            for (const item of row.data.segments || [])
                keep.add(item.contentId);
    const segments = await getDocs(collection(firestore, 'users', uid, 'apps', CLOUD_DOC_ID, 'segments'));
    for (const item of segments.docs) {
        const data = item.data();
        if (!keep.has(item.id) && Date.parse(data.storedAt) < cutoff)
            remove.push(item.ref);
    }
    for (const item of rows)
        if (item.id !== manifest.revisionId && item.id !== previous?.id && Number(item.data.revision) < manifest.revision && Date.parse(item.data.createdAt) < cutoff)
            remove.push(item.ref);
    for (let offset = 0; offset < remove.length; offset += 450) {
        const batch = writeBatch(firestore);
        for (const ref of remove.slice(offset, offset + 450))
            batch.delete(ref);
        await batch.commit();
    }
}
export async function saveCloudDocument(uid, state, { expectedRevision = 0, appVersion = '' } = {}) {
    const before = await getDoc(cloudRef(uid)), current = before.exists() ? before.data() : null;
    assertCloudRevision(expectedRevision, current?.revision || 0);
    if (current && current.storageFormat !== CLOUD_DELTA_STORAGE_FORMAT)
        throw new Error('클라우드 저장 형식 불일치');
    let legacySource = current?.legacySource;
    await assertLegacySource(uid, legacySource);
    if (!current)
        for (const appId of [FUNDING_CLOUD_DOC_ID, PREVIOUS_CLOUD_DOC_ID]) {
            const old = await getDoc(cloudRef(uid, appId));
            if (old.exists()) {
                legacySource = { appId, hash: await sha256Hex(canonicalStringify(old.data())) };
                break;
            }
        }
    const prepared = await prepareDeltaRevision(state, { expectedRevision, previous: current });
    const manifest = { ...prepared.manifest, ...(legacySource ? { legacySource } : {}), appVersion }, writes = [...prepared.documents.map(document => ({ ref: doc(firestore, 'users', uid, 'apps', CLOUD_DOC_ID, 'segments', document.contentId), data: { ...document, storedAt: new Date().toISOString() } })), { ref: revisionRef(uid, manifest.revisionId), data: { ...manifest, status: 'ready' } }];
    let batch = writeBatch(firestore), batchBytes = 0, batchCount = 0;
    for (const item of writes) {
        const bytes = utf8Bytes(item.data) + 1024;
        if (batchCount && (batchCount >= 400 || batchBytes + bytes > 6 * 1024 * 1024)) {
            await batch.commit();
            batch = writeBatch(firestore);
            batchBytes = 0;
            batchCount = 0;
        }
        batch.set(item.ref, item.data);
        batchBytes += bytes;
        batchCount++;
    }
    if (batchCount)
        await batch.commit();
    await runTransaction(firestore, async (transaction) => { const snapshot = await transaction.get(cloudRef(uid)), actual = snapshot.exists() ? snapshot.data() : null; assertCloudRevision(expectedRevision, actual?.revision || 0); if (legacySource) {
        const old = await transaction.get(cloudRef(uid, String(legacySource.appId)));
        if (!old.exists() || await sha256Hex(canonicalStringify(old.data())) !== legacySource.hash)
            throw new Error('이전 버전에서 클라우드 기록이 변경되었습니다. 원본을 보존합니다.');
    } transaction.set(cloudRef(uid), { ...manifest, updatedAt: serverTimestamp() }); });
    cleanupDelta(uid, prepared.manifest).catch(error => console.warn('Cloud cleanup deferred', error));
    return { revision: manifest.revision, manifest };
}
export function subscribeCloudDocument(uid, onData, onError) { let sequence = 0; return onSnapshot(cloudRef(uid), snapshot => { const token = ++sequence; if (!snapshot.exists()) {
    onData(null);
    return;
} const data = snapshot.data(); if (data.storageFormat !== CLOUD_DELTA_STORAGE_FORMAT) {
    onError(new Error('지원하지 않는 클라우드 저장 형식'));
    return;
} readDeltaDocument(uid, data).then(value => { if (token === sequence)
    onData(value); }).catch(onError); }, onError); }
