import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { auth, googleProvider } from './firebase.js';

let loginRunning = false;
let authStarted = false;

function friendlyAuthError(error) {
  switch (error?.code) {
    case 'auth/unauthorized-domain': return 'Firebase 승인 도메인을 확인해 주세요.';
    case 'auth/network-request-failed': return '인터넷 연결을 확인한 뒤 다시 눌러 주세요.';
    case 'auth/popup-blocked': return '팝업이 차단되었습니다. Chrome 팝업을 허용해 주세요.';
    case 'auth/popup-closed-by-user': return '로그인 창이 닫혔습니다. 다시 눌러 주세요.';
    case 'auth/cancelled-popup-request': return '이미 로그인 창이 열려 있습니다.';
    default: return '로그인에 실패했습니다. 다시 눌러 주세요.';
  }
}

export async function initGoogleAuth({ loginButtonId, statusElementId, onSignedIn, onSignedOut, onError }) {
  if (authStarted) return;
  authStarted = true;

  const button = document.getElementById(loginButtonId);
  const status = document.getElementById(statusElementId);

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.error('Auth persistence error', error);
    if (status) status.textContent = '자동 로그인 설정에 실패했습니다.';
  }

  button?.addEventListener('click', async () => {
    if (loginRunning) return;
    loginRunning = true;
    button.disabled = true;
    if (status) status.textContent = 'Google 로그인 창을 여는 중…';
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Google login error', error);
      const message = friendlyAuthError(error);
      if (status) status.textContent = message;
      onError?.(message, error);
    } finally {
      loginRunning = false;
      button.disabled = false;
    }
  });

  onAuthStateChanged(auth, user => {
    if (user) onSignedIn?.(user);
    else onSignedOut?.();
  }, error => {
    console.error('Auth state error', error);
    const message = friendlyAuthError(error);
    if (status) status.textContent = message;
    onError?.(message, error);
  });
}

export function logoutGoogle() {
  return signOut(auth);
}
