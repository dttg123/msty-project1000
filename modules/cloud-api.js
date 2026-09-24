// The local ledger must boot even when Google's SDK is unavailable/offline.
let authModule, cloudModule;
const auth = () => authModule ||= import('../auth.js');
const cloud = () => cloudModule ||= import('../cloud.js');
export const initGoogleAuth = async options => (await auth()).initGoogleAuth(options);
export const logoutGoogle = async () => (await auth()).logoutGoogle();
export const getGoogleIdToken = async force => (await auth()).getGoogleIdToken(force);
export const getCloudDocument = async uid => (await cloud()).getCloudDocument(uid);
export const getLegacyCloudDocument = async uid => (await cloud()).getLegacyCloudDocument(uid);
export const saveCloudDocument = async (uid,payload) => (await cloud()).saveCloudDocument(uid,payload);
export const subscribeCloudDocument = async (...args) => (await cloud()).subscribeCloudDocument(...args);

