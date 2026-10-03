// The local ledger must boot even when Google's SDK is unavailable/offline.
let authModule: Promise<typeof import('../auth.js')>|undefined, cloudModule: Promise<typeof import('../cloud.js')>|undefined;
const auth = () => authModule ||= import('../auth.js');
const cloud = () => cloudModule ||= import('../cloud.js');
export const initGoogleAuth = async (options: Parameters<typeof import('../auth.js').initGoogleAuth>[0]) => (await auth()).initGoogleAuth(options);
export const logoutGoogle = async () => (await auth()).logoutGoogle();
export const getGoogleIdToken = async (force: boolean = false) => (await auth()).getGoogleIdToken(force);
export const getCloudDocument = async (uid: string) => (await cloud()).getCloudDocument(uid);
export const getLegacyCloudDocument = async (uid: string) => (await cloud()).getLegacyCloudDocument(uid);
export const saveCloudDocument = async (...args: Parameters<typeof import('../cloud.js').saveCloudDocument>) => (await cloud()).saveCloudDocument(...args);
export const subscribeCloudDocument = async (...args: Parameters<typeof import('../cloud.js').subscribeCloudDocument>) => (await cloud()).subscribeCloudDocument(...args);
