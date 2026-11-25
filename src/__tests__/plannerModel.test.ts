import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '../profile';
import { emptyPreferences } from '../preferences';

const mocks = vi.hoisted(() => ({ prompt: vi.fn(), measure: vi.fn(), destroy: vi.fn(), generate: vi.fn(), getModel: vi.fn(), appCheck: true }));
vi.mock('firebase/app', () => ({ getApp: () => ({}) }));
vi.mock('../firebase', () => ({ get firebaseAppCheckReady() { return mocks.appCheck; } }));
vi.mock('firebase/ai', () => ({
  getAI: () => ({}), GoogleAIBackend: class {}, getGenerativeModel: mocks.getModel,
  InferenceMode: { ONLY_ON_DEVICE: 'device', ONLY_IN_CLOUD: 'cloud' }, InferenceSource: { ON_DEVICE: 'on_device', IN_CLOUD: 'in_cloud' },
  Schema: { object: (value: unknown) => value, array: (value: unknown) => value, string: () => ({}), enumString: (value: unknown) => value },
}));
import { planApplication } from '../plannerModel';

const input = () => ({ fields: [{ id: '1', label: 'Networking profile', type: 'text', required: false, options: [], selector: '' }], profile: { ...emptyProfile(), linkedin: 'linkedin.com/in/jordan' }, preferences: emptyPreferences(), job: { company: 'Example', role: 'Engineer' }, allowCloud: true });
const text = () => JSON.stringify({ answers: [{ fieldId: '1', kind: 'profile', keys: ['linkedin'], draft: '', reason: 'Saved LinkedIn link.' }] });

beforeEach(() => {
  vi.clearAllMocks(); mocks.appCheck = true;
  mocks.getModel.mockReturnValue({ generateContent: mocks.generate });
  mocks.prompt.mockResolvedValue(text()); mocks.measure.mockResolvedValue(1000);
  mocks.generate.mockResolvedValue({ response: { text } });
  vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => ({ contextWindow: 8192, measureContextUsage: mocks.measure, prompt: mocks.prompt, destroy: mocks.destroy }) });
});
afterEach(() => vi.unstubAllGlobals());

describe('single-call hybrid adapter', () => {
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
