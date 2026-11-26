import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '../profile';
import { emptyPreferences } from '../preferences';

const mocks = vi.hoisted(() => ({ prompt: vi.fn(), measure: vi.fn(), destroy: vi.fn(), generate: vi.fn(), getModel: vi.fn(), token: vi.fn(), appCheck: true }));
vi.mock('firebase/app', () => ({ getApp: () => ({}) }));
vi.mock('../firebase', () => ({ get firebaseAppCheckReady() { return mocks.appCheck; }, getFirebaseServices: async () => ({}), verifyAppCheck: mocks.token }));
vi.mock('firebase/ai', () => ({
  getAI: () => ({}), GoogleAIBackend: class {}, getGenerativeModel: mocks.getModel,
  InferenceMode: { ONLY_ON_DEVICE: 'device', ONLY_IN_CLOUD: 'cloud' }, InferenceSource: { ON_DEVICE: 'on_device', IN_CLOUD: 'in_cloud' },
  Schema: { object: (value: unknown) => value, array: (value: unknown) => value, string: () => ({}), enumString: (value: unknown) => value },
}));
import { aiSetupError, checkAIConnection, planApplication } from '../plannerModel';

const input = () => ({ fields: [{ id: '1', label: 'Networking profile', type: 'text', required: false, options: [], selector: '' }], profile: { ...emptyProfile(), linkedin: 'linkedin.com/in/jordan' }, preferences: emptyPreferences(), job: { company: 'Example', role: 'Engineer' }, allowCloud: true });
const text = () => JSON.stringify({ answers: [{ fieldId: '1', kind: 'profile', keys: ['linkedin'], draft: '', reason: 'Saved LinkedIn link.' }] });

beforeEach(() => {
  vi.clearAllMocks(); mocks.appCheck = true;
  mocks.getModel.mockReturnValue({ generateContent: mocks.generate });
  mocks.prompt.mockResolvedValue(text()); mocks.measure.mockResolvedValue(1000);
  mocks.generate.mockResolvedValue({ response: { text } });
  mocks.token.mockResolvedValue({ token: 'test-token' });
  vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => ({ contextWindow: 8192, measureContextUsage: mocks.measure, prompt: mocks.prompt, destroy: mocks.destroy }) });
});
afterEach(() => vi.unstubAllGlobals());

describe('single-call hybrid adapter', () => {
  it('checks App Check and cloud generation using only a synthetic prompt', async () => {
    mocks.generate.mockResolvedValue({ response: { text: () => '{"status":"ready"}' } });
    expect(await checkAIConnection()).toContain('No Python server');
    expect(mocks.token).toHaveBeenCalledOnce(); expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.generate.mock.calls[0][0]).toBe('Connection test. Return only {"status":"ready"}.');
    expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it('explains missing debug registration before making any generation request', async () => {
    mocks.token.mockRejectedValue(new Error('HTTP 403'));
    await expect(checkAIConnection()).rejects.toThrow('Manage debug tokens');
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('turns provider setup failures into actionable messages without echoing key material', () => {
    const error = aiSetupError(new Error('API_KEY_INVALID secret-key-placeholder'));
    expect(error.message).toContain('VITE_FIREBASE_API_KEY');
    expect(error.message).not.toContain('secret-key-placeholder');
    expect(aiSetupError(new Error('API has not been used or is disabled')).message).toContain('AI Logic');
    expect(aiSetupError(new Error('App Check attestation failed')).message).toContain('Manage debug tokens');
  });
  it('measures complete context and uses constrained on-device output once', async () => {
    const result = await planApplication(input());
    expect(result.entries[0].source).toBe('ON_DEVICE');
    expect(mocks.measure).toHaveBeenCalledWith(expect.stringContaining('Networking profile'), { responseConstraint: expect.any(Object) });
    expect(mocks.prompt).toHaveBeenCalledOnce();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('chooses constrained cloud before generation when full context exceeds device capacity', async () => {
    mocks.measure.mockResolvedValue(9000);
    const result = await planApplication(input());
    expect(result.entries[0].source).toBe('IN_CLOUD');
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.getModel.mock.calls[0][1]).toMatchObject({ mode: 'cloud', inCloudParams: { generationConfig: { responseMimeType: 'application/json', responseSchema: expect.any(Object) } } });
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('does not download an unready model', async () => {
    const create = vi.fn();
    vi.stubGlobal('LanguageModel', { availability: async () => 'downloadable', create });
    await planApplication(input());
    expect(create).not.toHaveBeenCalled();
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it('does not silently fall back after a generation failure', async () => {
    mocks.prompt.mockRejectedValue(new Error('generation failed'));
    const result = await planApplication(input());
    expect(result.attempts).toEqual(['ON_DEVICE']);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(result.warnings[0]).toContain('No second generation');
  });

  it('prevents cloud generation without App Check or consent', async () => {
    mocks.appCheck = false;
    vi.stubGlobal('LanguageModel', undefined);
    const result = await planApplication(input());
    expect(result.entries[0].value).toBe('');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.getModel).not.toHaveBeenCalled();
    mocks.appCheck = true;
    await planApplication({ ...input(), allowCloud: false });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
