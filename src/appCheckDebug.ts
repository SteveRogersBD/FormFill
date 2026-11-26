import { getFirebaseServices } from './firebase';

export interface AppCheckDebugDetails {
  token: string;
  projectId: string;
  appId: string;
  consoleUrl: string;
}

// Read-only compatibility with the pinned Firebase App Check SDK's own storage.
// Never generate a second token: it would not be the token this SDK is using.
const databaseName = 'firebase-app-check-database';
const storeName = 'firebase-app-check-store';

export function readStoredDebugToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    let database: IDBDatabase | undefined;
    let settled = false;
    const finish = (token?: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer); database?.close();
      if (token) resolve(token);
      else reject(new Error('The extension debug token is not available in local storage yet. Run Check AI connection once, then retry. If storage is blocked, use the Firebase App Check debug token printed in this extension’s Console.'));
    };
    const timer = setTimeout(() => finish(), 5000);
    try {
      const request = indexedDB.open(databaseName);
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onerror = () => finish();
      request.onsuccess = () => {
        database = request.result;
        if (settled) { database.close(); return; }
        if (!database.objectStoreNames.contains(storeName)) { finish(); return; }
        try {
          const transaction = database.transaction(storeName, 'readonly');
          const reading = transaction.objectStore(storeName).get('debug-token');
          reading.onerror = () => finish(); transaction.onabort = () => finish();
          reading.onsuccess = () => finish(typeof reading.result?.value === 'string' ? reading.result.value : undefined);
        } catch { finish(); }
      };
    } catch { finish(); }
  });
}

export async function getAppCheckDebugDetails(): Promise<AppCheckDebugDetails> {
  if (import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG !== 'true') throw new Error('Debug-token copying is only available in the unpacked debug build.');
  await getFirebaseServices();
  const configured = (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN;
  const token = typeof configured === 'string' && configured ? configured : await readStoredDebugToken();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '';
  const appId = import.meta.env.VITE_FIREBASE_APP_ID ?? '';
  return { token, projectId, appId, consoleUrl: `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/appcheck/apps?selectedAppId=${encodeURIComponent(appId)}` };
}
