const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseReady = Object.values(firebaseConfig).every(Boolean);
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
const appCheckDebug = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG === 'true';
export const firebaseAppCheckReady = Boolean(appCheckSiteKey || appCheckDebug);

let services: { auth: import('firebase/auth').Auth; db: import('firebase/firestore').Firestore; storage: import('firebase/storage').FirebaseStorage } | undefined;

export async function getFirebaseServices() {
  if (!firebaseReady) throw new Error('Add your Firebase web app settings to .env.local to enable sign-in and cloud storage.');
  if (!services) {
    const [{ initializeApp }, { getAuth }, { getFirestore }, { getStorage }] = await Promise.all([
      import('firebase/app'), import('firebase/auth'), import('firebase/firestore'), import('firebase/storage'),
    ]);
    const app = initializeApp(firebaseConfig);
    if (appCheckSiteKey || appCheckDebug) {
      if (appCheckDebug) (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');
      initializeAppCheck(app, { provider: new ReCaptchaV3Provider(appCheckSiteKey ?? 'debug-only'), isTokenAutoRefreshEnabled: true });
    }
    services = { auth: getAuth(app), db: getFirestore(app), storage: getStorage(app) };
  }
  return services;
}
