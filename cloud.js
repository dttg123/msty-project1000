import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firestore } from './firebase.js';

const CLOUD_DOC_ID = 'msty-project1000';
const cloudRef = uid => doc(firestore, 'users', uid, 'apps', CLOUD_DOC_ID);

export async function getCloudDocument(uid) {
  const snapshot = await getDoc(cloudRef(uid));
  return snapshot.exists() ? snapshot.data() : null;
}

export function saveCloudDocument(uid, payload) {
  return setDoc(cloudRef(uid), {
    ...payload,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export function subscribeCloudDocument(uid, onData, onError) {
  return onSnapshot(cloudRef(uid), snapshot => {
    onData(snapshot.exists() ? snapshot.data() : null);
  }, onError);
}
