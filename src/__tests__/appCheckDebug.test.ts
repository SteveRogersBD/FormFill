import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppCheckDebugDetails, readStoredDebugToken } from '../appCheckDebug';

vi.mock('../firebase', () => ({ getFirebaseServices: async () => ({}) }));
const close = vi.fn();
const get = vi.fn();
const transaction = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_FIREBASE_APPCHECK_DEBUG', 'true');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'fixture-project');
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'fixture-web-app');
  delete (globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN;
  get.mockImplementation(() => {
    const request: any = { result: { compositeKey: 'debug-token', value: 'fixture-debug-secret' } };
    queueMicrotask(() => request.onsuccess());
    return request;
  });
  transaction.mockReturnValue({ objectStore: () => ({ get }) });
  vi.stubGlobal('indexedDB', { open: vi.fn(() => {
    const request: any = { result: { objectStoreNames: { contains: () => true }, transaction, close } };
    queueMicrotask(() => request.onsuccess());
    return request;
  }) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete (globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN; });

describe('extension debug-token copying', () => {
  it('reads the SDK token without replacing it and identifies the correct app', async () => {
    expect(await getAppCheckDebugDetails()).toEqual({ token: 'fixture-debug-secret', projectId: 'fixture-project', appId: 'fixture-web-app', consoleUrl: 'https://console.firebase.google.com/project/fixture-project/appcheck/apps?selectedAppId=fixture-web-app' });
    expect(indexedDB.open).toHaveBeenCalledWith('firebase-app-check-database');
    expect(transaction).toHaveBeenCalledWith('firebase-app-check-store', 'readonly');
    expect(get).toHaveBeenCalledWith('debug-token'); expect(close).toHaveBeenCalledOnce();
  });

  it('uses an explicit SDK debug token when one is configured', async () => {
    (globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN = 'explicit-fixture-secret';
    expect((await getAppCheckDebugDetails()).token).toBe('explicit-fixture-secret');
    expect(indexedDB.open).not.toHaveBeenCalled();
  });

  it('does not expose a debug token from a non-debug build', async () => {
    vi.stubEnv('VITE_FIREBASE_APPCHECK_DEBUG', 'false');
    await expect(getAppCheckDebugDetails()).rejects.toThrow('only available in the unpacked debug build');
    expect(indexedDB.open).not.toHaveBeenCalled();
  });

  it('explains missing local token storage without creating a replacement', async () => {
    get.mockImplementation(() => { const request: any = { result: undefined }; queueMicrotask(() => request.onsuccess()); return request; });
    await expect(readStoredDebugToken()).rejects.toThrow('Run Check AI connection once');
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps the read-only storage adapter aligned with the installed Firebase SDK', async () => {
    const sdk = await readFile(new URL('../../node_modules/@firebase/app-check/dist/esm/index.esm.js', import.meta.url), 'utf8');
    expect(sdk).toContain("const DB_NAME = 'firebase-app-check-database'");
    expect(sdk).toContain("const STORE_NAME = 'firebase-app-check-store'");
    expect(sdk).toContain("const DEBUG_TOKEN_KEY = 'debug-token'");
    expect(sdk).toContain('compositeKey: key,');
  });
});
