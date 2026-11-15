import { GoogleAuthProvider, getAuth, signInWithPopup } from 'firebase/auth';
import { initializeApp } from 'firebase/app';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const auth = getAuth(initializeApp(config));
const parentOrigin = location.ancestorOrigins[0];

window.addEventListener('message', async (event) => {
  if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.type !== 'APPLYAI_BEGIN_GOOGLE_SIGN_IN') return;
  try {
    const credential = await signInWithPopup(auth, new GoogleAuthProvider());
    const googleCredential = GoogleAuthProvider.credentialFromResult(credential);
    if (!googleCredential?.idToken || !googleCredential.accessToken) throw new Error('Google did not return an authentication token.');
    window.parent.postMessage({ type: 'APPLYAI_GOOGLE_SIGN_IN_RESULT', idToken: googleCredential.idToken, accessToken: googleCredential.accessToken }, parentOrigin);
  } catch (reason) {
    window.parent.postMessage({ type: 'APPLYAI_GOOGLE_SIGN_IN_RESULT', error: reason instanceof Error ? reason.message : 'Google sign-in failed.' }, parentOrigin);
  }
});
