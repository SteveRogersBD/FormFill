import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftCoverLetterInCloud, draftCoverLetterOnDevice, extractResumeWithAI } from '../ai';
import { emptyProfile, resumeProfileSchema } from '../profile';

const aiMocks = vi.hoisted(() => ({
  getAI: vi.fn(() => ({})),
  getGenerativeModel: vi.fn(),
  getApp: vi.fn(() => ({})),
  model: {
    initializeDeviceModel: vi.fn(),
    generateContent: vi.fn(),
  },
}));

vi.mock('firebase/ai', () => ({
  getAI: aiMocks.getAI,
  getGenerativeModel: aiMocks.getGenerativeModel,
  GoogleAIBackend: class {},
  InferenceMode: { ONLY_ON_DEVICE: 'ONLY_ON_DEVICE', ONLY_IN_CLOUD: 'ONLY_IN_CLOUD' },
}));
vi.mock('firebase/app', () => ({ getApp: aiMocks.getApp }));
vi.mock('../firebase', () => ({ firebaseAppCheckReady: true, getFirebaseServices: async () => ({}), verifyAppCheck: async () => {} }));

afterEach(() => vi.unstubAllGlobals());

const profile = resumeProfileSchema.parse({
  ...emptyProfile(),
  fullName: 'Jordan Lee',
  email: 'jordan@example.com',
  phone: '+1 555 010 0100',
  targetRole: 'Product Designer',
  skills: ['Research', 'Prototyping'],
  workExperience: ['Led user research for onboarding.'],
});

describe('cover letter drafting', () => {
  it('extracts three separate jobs and projects in approved cloud AI using the complete resume', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    aiMocks.getGenerativeModel.mockReturnValue(aiMocks.model);
    const extracted = { fullName: 'Riley Example', workExperience: ['First Studio', 'Second Lab', 'Third Company'].map((company, index) => ({ id: `model-${index}`, company, jobTitle: 'Engineer', description: [`Built tools for ${company}.`] })), projects: ['Alpha\nBuilt a planner.', 'Beta\nBuilt a tutor.', 'Gamma\nBuilt a recipe tool.'] };
    aiMocks.model.generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify(extracted) } });
    const text = 'COMPLETE RESUME '.repeat(1500) + 'FINAL SOURCE FACT';
    const result = await extractResumeWithAI(text, true);
    expect(result.source).toBe('IN_CLOUD');
    expect(result.profile.workExperience.map((entry) => entry.company)).toEqual(['First Studio', 'Second Lab', 'Third Company']);
    expect(result.profile.workExperience.map((entry) => entry.id)).toEqual(['work-1', 'work-2', 'work-3']);
    expect(result.profile.projects).toEqual(extracted.projects);
    expect(aiMocks.model.generateContent.mock.calls[0][0]).toContain(text);
    expect(aiMocks.getGenerativeModel.mock.calls[0][1]).toMatchObject({ mode: 'ONLY_IN_CLOUD', inCloudParams: { generationConfig: { responseMimeType: 'application/json', responseJsonSchema: expect.any(Object) } } });
    expect(aiMocks.model.initializeDeviceModel).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    aiMocks.getGenerativeModel.mockReturnValue(aiMocks.model);
    aiMocks.model.generateContent.mockResolvedValue({
      response: { text: () => '  A reviewed draft.  ', inferenceSource: 'ON_DEVICE' },
    });
  });

  it('uses only career facts for an on-device draft and trims the result', async () => {
    const result = await draftCoverLetterOnDevice(profile, 'Design useful collaboration tools.');
    const prompt = aiMocks.model.generateContent.mock.calls[0][0] as string;

    expect(result).toEqual({ letter: 'A reviewed draft.', source: 'ON_DEVICE' });
    expect(aiMocks.model.initializeDeviceModel).toHaveBeenCalledOnce();
    expect(prompt).toContain('Design useful collaboration tools.');
    expect(prompt).toContain('Led user research for onboarding.');
    expect(prompt).not.toContain('jordan@example.com');
    expect(prompt).not.toContain('+1 555 010 0100');
  });

  it('keeps cloud drafting separate and rejects an empty job description', async () => {
    await draftCoverLetterInCloud(profile, 'Design useful collaboration tools.');
    expect(aiMocks.model.initializeDeviceModel).not.toHaveBeenCalled();
    expect(aiMocks.getGenerativeModel.mock.calls[0][1]).toEqual({ mode: 'ONLY_IN_CLOUD' });
    await expect(draftCoverLetterOnDevice(profile, '  ')).rejects.toThrow();
    expect(aiMocks.model.generateContent).toHaveBeenCalledOnce();
  });
});
