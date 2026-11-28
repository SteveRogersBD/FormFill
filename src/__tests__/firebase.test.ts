// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), token: vi.fn(), custom: vi.fn(), recaptcha: vi.fn(), ai: vi.fn(), providerOptions: undefined as { getToken: () => Promise<unknown> } | undefined }));
vi.mock('firebase/app', () => ({ initializeApp: () => ({ name: 'test' }), getApp: () => ({ name: 'test' }) }));
vi.mock('firebase/ai', () => ({ getAI: mocks.ai, GoogleAIBackend: class { kind = 'google'; }, AgentPlatformBackend: class { kind = 'agent-platform'; constructor(public location: string) {} } }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({}) }));
vi.mock('firebase/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('firebase/storage', () => ({ getStorage: () => ({ maxUploadRetryTime: 600_000 }) }));
vi.mock('firebase/app-check', async (original) => {
  const sdk = await original<typeof import('firebase/app-check')>();
  return {
    initializeAppCheck: mocks.initialize,
    getToken: mocks.token,
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
  vi.stubEnv('VITE_FIREBASE_AI_BACKEND', 'google');
  vi.stubEnv('VITE_FIREBASE_AI_LOCATION', 'global');
  delete (globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN;
  document.head.querySelectorAll('script').forEach((script) => script.remove());
});
afterEach(() => { vi.unstubAllEnvs(); delete (globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN; });

describe('App Check initialization', () => {
  it('selects the configured AI provider and location and rejects an invalid provider', async () => {
    vi.stubEnv('VITE_FIREBASE_APPCHECK_DEBUG', 'true');
    const firebase = await import('../firebase');
    await firebase.getFirebaseAI();
    expect(mocks.ai).toHaveBeenLastCalledWith({ name: 'test' }, { backend: expect.objectContaining({ kind: 'google' }) });
    vi.stubEnv('VITE_FIREBASE_AI_BACKEND', 'agent-platform');
    vi.stubEnv('VITE_FIREBASE_AI_LOCATION', 'us-central1');
    await firebase.getFirebaseAI();
    expect(mocks.ai).toHaveBeenLastCalledWith({ name: 'test' }, { backend: expect.objectContaining({ kind: 'agent-platform', location: 'us-central1' }) });
    vi.stubEnv('VITE_FIREBASE_AI_BACKEND', 'invalid');
    await expect(firebase.getFirebaseAI()).rejects.toThrow('VITE_FIREBASE_AI_BACKEND');
    expect(mocks.ai).toHaveBeenCalledTimes(2);
  });

  it('checks a token using the initialized provider instance', async () => {
    vi.stubEnv('VITE_FIREBASE_APPCHECK_DEBUG', 'true');
    const instance = { app: { name: 'test' } };
    mocks.initialize.mockReturnValue(instance); mocks.token.mockResolvedValue({ token: 'fixture-token' });
    const firebase = await import('../firebase');
    expect((await firebase.getFirebaseServices()).storage.maxUploadRetryTime).toBe(30_000);
    await firebase.verifyAppCheck();
    expect(mocks.token).toHaveBeenCalledWith(instance, false);
    await firebase.verifyAppCheck(true);
    expect(mocks.token).toHaveBeenLastCalledWith(instance, true);
    expect(mocks.initialize).toHaveBeenCalledOnce();
  });
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
