declare const window: any;

function plugin(): any{return window?.Capacitor?.Plugins?.HotUpdate||null;}
export function isHotUpdateAvailable(): any{return !!plugin();}
export async function hotUpdateStatus(): Promise<any>{const target: any=plugin();if(!target)return {available:false,currentVersion:'',latestVersion:'',updateAvailable:false,nativeUpdateRequired:false};return target.status();}
export async function installHotUpdate(): Promise<any>{const target: any=plugin();if(!target)throw new Error('Android 앱에서만 업데이트할 수 있습니다.');return target.install();}
export async function confirmHotUpdateReady(): Promise<any>{const target: any=plugin();if(target)await target.confirmReady();}
