import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAWYLc5shkFX3L8RCb0br3e1XXXsmZLcNk',
  authDomain: 'msty-project1000.firebaseapp.com',
  projectId: 'msty-project1000',
  storageBucket: 'msty-project1000.firebasestorage.app',
  messagingSenderId: '836173148792',
  appId: '1:836173148792:web:73dd7aa8573aa68361738d'
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export { auth, firestore, googleProvider };
