// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), custom: vi.fn(), recaptcha: vi.fn(), providerOptions: undefined as { getToken: () => Promise<unknown> } | undefined }));
vi.mock('firebase/app', () => ({ initializeApp: () => ({ name: 'test' }) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({}) }));
vi.mock('firebase/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase/storage', () => ({ getStorage: () => ({}) }));
vi.mock('firebase/app-check', async (original) => {
  const sdk = await original<typeof import('firebase/app-check')>();
  return {
    initializeAppCheck: mocks.initialize,
    // Use the installed SDK's real provider implementation to check its initialize
    // behavior; only the Firebase service itself is mocked (no token/network calls).
    CustomProvider: class extends sdk.CustomProvider {
      constructor(options: { getToken: () => Promise<import('firebase/app-check').AppCheckToken> }) {
        super(options); mocks.custom(); mocks.providerOptions = options;
      }
    },
    ReCaptchaV3Provider: class extends sdk.ReCaptchaV3Provider {
      constructor(key: string) { super(key); mocks.recaptcha(key); }
    },
  };
});

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.providerOptions = undefined;
  for (const name of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'APP_ID']) vi.stubEnv(`VITE_FIREBASE_${name}`, 'test-config');
  vi.stubEnv('VITE_FIREBASE_APPCHECK_SITE_KEY', 'test-site-key');
  delete (globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN;
  document.head.querySelectorAll('script').forEach((script) => script.remove());
});
afterEach(() => { vi.unstubAllEnvs(); delete (globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN; });

describe('App Check initialization', () => {
  it('uses a custom provider in debug mode without loading a remote script', async () => {
    vi.stubEnv('VITE_FIREBASE_APPCHECK_DEBUG', 'true');
    const firebase = await import('../firebase');
    await firebase.getFirebaseServices();
    expect((globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
    expect(mocks.custom).toHaveBeenCalledOnce();
    expect(mocks.recaptcha).not.toHaveBeenCalled();
    const provider = mocks.initialize.mock.calls[0][1].provider;
    provider.initialize({ name: 'test' });
    expect(document.querySelector('script[src*="recaptcha"]')).toBeNull();
    expect(mocks.initialize.mock.calls[0][1].isTokenAutoRefreshEnabled).toBe(true);
    // Never mint a fake token if the debug SDK exchange fails to activate.
    await expect(mocks.providerOptions!.getToken()).rejects.toThrow('debug mode was not activated');
  });

  it('keeps the configured reCAPTCHA provider for non-debug web builds', async () => {
    vi.stubEnv('VITE_FIREBASE_APPCHECK_DEBUG', 'false');
    const firebase = await import('../firebase');
    await firebase.getFirebaseServices();
    expect(mocks.recaptcha).toHaveBeenCalledWith('test-site-key');
    expect(mocks.custom).not.toHaveBeenCalled();
    expect((globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });
});
