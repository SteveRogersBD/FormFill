import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftCoverLetterInCloud, draftCoverLetterOnDevice, extractResumeWithAI } from '../ai';
import { emptyProfile, resumeProfileSchema } from '../profile';

const aiMocks = vi.hoisted(() => ({
  getAI: vi.fn(() => ({})),
  getGenerativeModel: vi.fn(),
  model: {
    initializeDeviceModel: vi.fn(),
    generateContent: vi.fn(),
  },
}));

vi.mock('firebase/ai', () => ({
  getGenerativeModel: aiMocks.getGenerativeModel,
  InferenceMode: { ONLY_ON_DEVICE: 'ONLY_ON_DEVICE', ONLY_IN_CLOUD: 'ONLY_IN_CLOUD' },
}));
vi.mock('../firebase', () => ({ firebaseAppCheckReady: true, getFirebaseAI: async () => aiMocks.getAI(), getFirebaseServices: async () => ({}), verifyAppCheck: async () => {} }));

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
  it('uses approved cloud after invalid local extraction and rejects storage-path injection', async () => {
    vi.stubGlobal('LanguageModel', { availability: async () => 'available' });
    aiMocks.model.generateContent.mockResolvedValueOnce({ response: { text: () => 'not JSON' } }).mockResolvedValueOnce({ response: { text: () => JSON.stringify({ fullName: 'Riley', workExperience: [], projects: ['Alpha\nBuilt a planner.'] }) } });
    expect((await extractResumeWithAI('Riley\nProjects\nAlpha\nBuilt a planner.', true)).source).toBe('IN_CLOUD');
    expect(aiMocks.getGenerativeModel.mock.calls.map((call) => call[1].mode)).toEqual(['ONLY_ON_DEVICE', 'ONLY_IN_CLOUD']);
    vi.stubGlobal('LanguageModel', undefined);
    aiMocks.model.generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify({ fullName: 'Riley', workExperience: [], resumePath: 'another-user/private.pdf' }) } });
    await expect(extractResumeWithAI('Riley', true)).rejects.toThrow();
  });

  it('never sends resume text to cloud without consent, including after a local failure', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    await expect(extractResumeWithAI('Riley Example', false)).rejects.toThrow('Enable cloud resume extraction');
    expect(aiMocks.getGenerativeModel).not.toHaveBeenCalled();
    vi.stubGlobal('LanguageModel', { availability: async () => 'available' });
    aiMocks.model.generateContent.mockRejectedValueOnce(new Error('Local context is too small.'));
    await expect(extractResumeWithAI('Riley Example', false)).rejects.toThrow('Local context is too small');
    expect(aiMocks.getGenerativeModel).toHaveBeenCalledOnce();
    expect(aiMocks.getGenerativeModel.mock.calls[0][1].mode).toBe('ONLY_ON_DEVICE');
    expect(aiMocks.model.initializeDeviceModel).toHaveBeenCalledOnce();
  });

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
