// The local ledger must boot even when Google's SDK is unavailable/offline.
let authModule, cloudModule;
const auth: any = () => authModule ||= import('../auth.js');
const cloud: any = () => cloudModule ||= import('../cloud.js');
export const initGoogleAuth: any = async (options: any) => (await auth()).initGoogleAuth(options);
export const logoutGoogle: any = async () => (await auth()).logoutGoogle();
export const getGoogleIdToken: any = async (force: any) => (await auth()).getGoogleIdToken(force);
export const getCloudDocument: any = async (uid: any) => (await cloud()).getCloudDocument(uid);
export const getLegacyCloudDocument: any = async (uid: any) => (await cloud()).getLegacyCloudDocument(uid);
export const saveCloudDocument: any = async (uid: any,state: any,options: any) => (await cloud()).saveCloudDocument(uid,state,options);
export const subscribeCloudDocument: any = async (...args: any[]) => (await cloud()).subscribeCloudDocument(...args);
