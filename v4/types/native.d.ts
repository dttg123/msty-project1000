// Contracts mirror the local Android plugin methods and their resolved payloads.
interface HotUpdateStatus {available:boolean;currentVersion:string;latestVersion:string;updateAvailable:boolean;nativeUpdateRequired:boolean;failedVersion?:string;}
interface DividendNativePlugins {
  NativeGoogleAuth?: {signIn():Promise<{idToken:string;email?:string;displayName?:string}>;signOut():Promise<void>};
  HotUpdate?: {status():Promise<HotUpdateStatus>;install():Promise<{started:boolean;version:string}>;confirmReady():Promise<void>};
  TossReadOnly?: {
    credentialStatus():Promise<{configured:boolean;lastPublicIp:string}>;
    saveCredentials(options:{clientId:string;clientSecret:string}):Promise<void>;
    clearCredentials():Promise<void>;
    publicIp():Promise<{ip:string}>;
    markPublicIp(options:{ip:string}):Promise<void>;
    openToss():Promise<void>;
    request(options:{path:string;accountSeq:string}):Promise<unknown>;
  };
  BackupFile?: {saveAtLocation?(options:{filename:string;base64:string}):Promise<{saved?:boolean;cancelled?:boolean}>;save(options:{filename:string;base64:string}):Promise<{saved?:boolean;cancelled?:boolean}>;download(options:{filename:string;base64:string}):Promise<{saved?:boolean;cancelled?:boolean}>};
}
interface Window {Capacitor?: {isNativePlatform?():boolean;Plugins?:DividendNativePlugins};}

interface Window {
  showSaveFilePicker?: (options:{suggestedName:string;types:Array<{description:string;accept:Record<string,string[]>}>})=>Promise<{createWritable():Promise<{write(data:Blob):Promise<void>;close():Promise<void>}>}>;
}
