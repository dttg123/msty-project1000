declare module 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js' {
  export const initializeApp: any;
}

declare module 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js' {
  export const browserLocalPersistence: any;
  export const getAuth: any;
  export const getRedirectResult: any;
  export const GoogleAuthProvider: any;
  export const onAuthStateChanged: any;
  export const setPersistence: any;
  export const signInWithPopup: any;
  export const signInWithRedirect: any;
  export const signOut: any;
}

declare module 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js' {
  export const collection: any;
  export const doc: any;
  export const getDoc: any;
  export const getDocs: any;
  export const getFirestore: any;
  export const onSnapshot: any;
  export const runTransaction: any;
  export const serverTimestamp: any;
  export const writeBatch: any;
}
