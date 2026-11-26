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
