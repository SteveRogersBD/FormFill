import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '../profile';
import { emptyPreferences } from '../preferences';

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), generate: vi.fn(), getModel: vi.fn(), appCheck: true }));
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

beforeEach(() => { vi.clearAllMocks(); mocks.appCheck = true; mocks.getModel.mockReturnValue({ initializeDeviceModel: mocks.initialize, generateContent: mocks.generate }); });

describe('Firebase hybrid adapter', () => {
  it('configures constrained on-device output and accepts the SDK lowercase source', async () => {
    mocks.initialize.mockResolvedValue(undefined);
    mocks.generate.mockResolvedValue({ response: { text, inferenceSource: 'on_device' } });
    const result = await planApplication(input());
    expect(result.entries[0].source).toBe('ON_DEVICE');
    expect(mocks.getModel.mock.calls[0][1]).toMatchObject({ mode: 'device', onDeviceParams: { promptOptions: { responseConstraint: expect.any(Object) } } });
    expect(mocks.generate).toHaveBeenCalledOnce();
  });

  it('uses constrained cloud output after device failure and App Check approval', async () => {
    mocks.initialize.mockRejectedValue(new Error('unsupported'));
    mocks.generate.mockResolvedValue({ response: { text, inferenceSource: 'in_cloud' } });
    const result = await planApplication(input());
    expect(result.entries[0].source).toBe('IN_CLOUD');
    expect(mocks.getModel.mock.calls[1][1]).toMatchObject({ mode: 'cloud', inCloudParams: { generationConfig: { responseMimeType: 'application/json', responseSchema: expect.any(Object) } } });
  });

  it('prevents a cloud request without App Check even if called outside the UI', async () => {
    mocks.appCheck = false; mocks.initialize.mockRejectedValue(new Error('unsupported'));
    const result = await planApplication(input());
    expect(result.entries[0].value).toBe('');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.getModel).toHaveBeenCalledOnce();
  });
});
