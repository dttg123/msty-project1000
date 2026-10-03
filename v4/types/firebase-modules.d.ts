// Use the official SDK declarations for the pinned browser CDN version.
// These are type-only exports; runtime imports continue to use the CDN URLs.
declare module 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js' {
  export { initializeApp } from 'firebase/app';
}
declare module 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js' {
  export { browserLocalPersistence, getAuth, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, setPersistence, signInWithCredential, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
}
declare module 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js' {
  export { collection, doc, getDoc, getDocs, getFirestore, onSnapshot, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
}
