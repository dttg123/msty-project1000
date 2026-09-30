declare const document: any;
declare const window: any;
declare const navigator: any;
declare const location: any;
declare const localStorage: any;
declare const sessionStorage: any;
import {
  browserLocalPersistence,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { auth, googleProvider, GoogleAuthProvider } from './firebase.js';

let loginRunning: any = false;
let authStarted: any = false;

function useRedirectAuth(): any {
  // Capacitor serves the app from https://localhost inside its WebView.
  // Redirect auth opens that URL in Chrome, where no local server exists.
  if (window?.Capacitor?.isNativePlatform?.()) return false;
  return matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function nativeGoogleAuth(): any {
  if (!window?.Capacitor?.isNativePlatform?.()) return null;
  return window?.Capacitor?.Plugins?.NativeGoogleAuth || null;
}

function friendlyAuthError(error: any): any {
  switch (error?.code) {
    case 'auth/unauthorized-domain': return 'Firebase 승인 도메인을 확인해 주세요.';
    case 'auth/network-request-failed': return '인터넷 연결을 확인한 뒤 다시 눌러 주세요.';
    case 'auth/popup-blocked': return '로그인 화면을 열지 못했습니다. 다시 눌러 주세요.';
    case 'auth/popup-closed-by-user': return '로그인 창이 닫혔습니다. 다시 눌러 주세요.';
    case 'auth/cancelled-popup-request': return '이미 로그인 창이 열려 있습니다.';
    case 'native-auth-cancelled': return 'Google 로그인이 취소되었습니다.';
    case 'native-auth-unavailable': return '기기의 Google 로그인을 사용할 수 없습니다.';
    case 'native-auth-config': return 'Google 로그인 설정을 확인해 주세요.';
    default: return '로그인에 실패했습니다. 다시 눌러 주세요.';
  }
}

export async function initGoogleAuth({ loginButtonId, statusElementId, onSignedIn, onSignedOut, onError }: any): Promise<any> {
  if (authStarted) return;
  authStarted = true;

  const button: any = document.getElementById(loginButtonId);
  const status: any = document.getElementById(statusElementId);

  try {
    await setPersistence(auth, browserLocalPersistence);
    if (!nativeGoogleAuth()) await getRedirectResult(auth);
  } catch (error: any) {
    console.error('Auth startup error', error);
    const message: any=friendlyAuthError(error);
    if (status) status.textContent = message;
    onError?.(message,error);
  }

  button?.addEventListener('click', async () => {
    if (loginRunning) return;
    loginRunning = true;
    button.disabled = true;
    if (status) status.textContent = 'Google 로그인 창을 여는 중…';
    try {
      const native: any=nativeGoogleAuth();
      if(native){
        const result: any=await native.signIn();
        if(!result?.idToken)throw {code:'native-auth-unavailable'};
        await signInWithCredential(auth,GoogleAuthProvider.credential(result.idToken));
      }else if(useRedirectAuth())await signInWithRedirect(auth,googleProvider);
      else await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error('Google login error', error);
      const message: any = friendlyAuthError(error);
      if (status) status.textContent = message;
      onError?.(message, error);
    } finally {
      loginRunning = false;
      button.disabled = false;
    }
  });

  onAuthStateChanged(auth, (user: any) => {
    if (user) {
      if(status)status.textContent='클라우드 계정을 연결했습니다.';
      onSignedIn?.(user);
    } else {
      if(status)status.textContent='로그인하지 않아도 모든 기능을 사용할 수 있습니다.';
      onSignedOut?.();
    }
  }, (error: any) => {
    console.error('Auth state error', error);
    const message: any = friendlyAuthError(error);
    if (status) status.textContent = message;
    onError?.(message, error);
  });
}

export async function logoutGoogle(): Promise<any> {
  await signOut(auth);
  const native: any=nativeGoogleAuth();
  if(native?.signOut)await native.signOut().catch(()=>{});
}

export function getGoogleIdToken(forceRefresh: any =false): any {
  return auth.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null;
}
