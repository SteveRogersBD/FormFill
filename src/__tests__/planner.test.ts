import { describe, expect, it, vi } from 'vitest';
import { runPlanner } from '../plannerGraph';
import { makePlannerPrompt, savedPlan, validateProposal, type PlannerInput, type Proposal } from '../planner';
import { emptyProfile, resumeProfileSchema } from '../profile';
import { emptyPreferences } from '../preferences';
import type { DetectedField } from '../fields';

const field = (id: string, label: string, type = 'text', options: string[] = []): DetectedField => ({ id, label, type, options, required: true, selector: '' });
function input(fields: DetectedField[], allowCloud = false): PlannerInput {
  return { fields, profile: resumeProfileSchema.parse({ ...emptyProfile(), fullName: 'Jordan Lee', email: 'jordan@example.com', city: 'Chicago', state: 'IL', postalCode: '60601', linkedin: 'linkedin.com/in/jordan', skills: ['TypeScript'], workExperience: ['Built internal dashboards.'] }), preferences: { ...emptyPreferences(), requiresSponsorship: 'no' }, job: { company: 'Illumio', role: 'Engineering Intern' }, allowCloud };
}
const proposal = (fieldId: string, kind: Proposal['kind'], keys: string[], draft = ''): Proposal => ({ fieldId, kind, keys, draft, reason: 'Based on saved facts.' });
const response = (...answers: Proposal[]) => JSON.stringify({ answers });

describe('application planning graph', () => {
  it('resolves both Illumio answers from dashboard preferences without model inference', () => {
    const request = input([
      field('1', 'Are you authorized to work lawfully in the country for the position in which you are applying?', 'choice', ['Yes', 'No']),
      field('2', 'Will you now or in the future require Illumio to commence (‘sponsor’) an immigration case in order to employ you?', 'choice', ['Yes', 'No']),
    ]);
    request.preferences.workAuthorized = 'yes';
    request.preferences.sponsorshipNowOrFuture = 'yes';
    const entries = savedPlan(request);
    expect(entries.map((entry) => [entry.value, entry.requiresConfirmation, entry.evidence])).toEqual([
      ['Yes', true, ['preferences.workAuthorized']],
      ['Yes', true, ['preferences.sponsorshipNowOrFuture']],
    ]);
  });
  it('runs real LangGraph nodes and maps unfamiliar labels to existing facts on device', async () => {
    const request = input([field('1', 'Where should we consider you based?'), field('2', 'Professional networking page'), field('3', 'Mail routing code')]);
    const device = vi.fn().mockResolvedValue(response(proposal('1', 'profile', ['city', 'state']), proposal('2', 'profile', ['linkedin']), proposal('3', 'profile', ['postalCode'])));
    const cloud = vi.fn(); const progress = vi.fn();
    const result = await runPlanner(request, { prepareDevice: async () => true, device, cloud }, progress);
    expect(result.entries.map((entry) => entry.value)).toEqual(['Chicago, IL', 'https://linkedin.com/in/jordan', '60601']);
    expect(result.entries[0].evidence).toEqual(['profile.city', 'profile.state']);
    expect(result.attempts).toEqual(['ON_DEVICE']);
    expect(progress).toHaveBeenCalledWith('Checking evidence and preparing answers for review…');
    expect(cloud).not.toHaveBeenCalled();
  });

  it('chooses approved cloud before generation and preserves fixed saved answers', async () => {
    const device = vi.fn();
    const cloud = vi.fn().mockResolvedValue(response(proposal('1', 'profile', ['state']), proposal('2', 'profile', ['postalCode'])));
    const result = await runPlanner(input([field('1', 'Email'), field('2', 'Mail routing code')], true), { prepareDevice: async () => false, device, cloud });
    expect(result.attempts).toEqual(['IN_CLOUD']);
    expect(device).not.toHaveBeenCalled();
    expect(cloud).toHaveBeenCalledOnce();
    expect(result.entries.map((entry) => [entry.value, entry.source])).toEqual([['jordan@example.com', 'saved'], ['60601', 'IN_CLOUD']]);
    const data = JSON.parse(cloud.mock.calls[0][0].split('DATA:\n')[1]);
    expect(data.targetIds).toEqual(['2']);
    expect(data.fixedAnswers).toContainEqual(expect.objectContaining({ fieldId: '1', value: 'jordan@example.com', fixed: true }));
    expect(data.fields).toHaveLength(2);
  });

  it('never calls the cloud without approval, even after local failure', async () => {
    const cloud = vi.fn();
    const result = await runPlanner(input([field('1', 'Email'), field('2', 'Unfamiliar question')]), { prepareDevice: async () => true, device: vi.fn().mockRejectedValue(new Error('unavailable')), cloud });
    expect(result.entries[0].value).toBe('jordan@example.com');
    expect(result.entries[1].status).toBe('needs_user');
    expect(result.warnings).toHaveLength(1);
    expect(cloud).not.toHaveBeenCalled();
  });

  it('never makes a second generation after invalid local JSON', async () => {
    const cloud = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await runPlanner(input([field('1', 'Email'), field('2', 'Unknown')], true), { prepareDevice: async () => true, device: vi.fn().mockResolvedValue('not JSON'), cloud });
    expect(cloud).not.toHaveBeenCalled();
    expect(result.entries[0].value).toBe('jordan@example.com');
    expect(result.attempts).toEqual(['ON_DEVICE']);
    expect(result.warnings).toHaveLength(1);
  });

  it('does not call cloud when the local plan resolves all answerable fields', async () => {
    const cloud = vi.fn();
    await runPlanner(input([field('1', 'Networking profile')], true), { prepareDevice: async () => true, device: vi.fn().mockResolvedValue(response(proposal('1', 'profile', ['linkedin']))), cloud });
    expect(cloud).not.toHaveBeenCalled();
  });

  it('rejects invented keys and values, unknown IDs, and unmatched choices', async () => {
    const result = await runPlanner(input([field('1', 'Mail routing code'), field('2', 'Where do you live?', 'choice', ['London', 'Berlin'])]), {
      prepareDevice: async () => true, device: vi.fn().mockResolvedValue(response(proposal('forged-id', 'profile', ['email']), proposal('1', 'profile', ['zipGuessedByModel'], '99999'), proposal('2', 'profile', ['city']))), cloud: vi.fn(),
    });
    expect(result.entries.every((entry) => !entry.value && entry.status === 'needs_user')).toBe(true);
    expect(result.entries).toHaveLength(2);
  });

  it('includes permitted standing facts but excludes opted-out demographics and storage paths', async () => {
    const request = input([field('1', 'Will we need an immigration petition?', 'choice', ['Yes', 'No'])]);
    request.preferences.visaStatus = 'SAVED_VISA_VALUE';
    request.preferences.gender = 'PRIVATE_GENDER_VALUE';
    request.profile.resumePath = 'PRIVATE_STORAGE_PATH';
    const prompt = makePlannerPrompt(request, ['1']);
    expect(prompt).toContain('requiresSponsorship');
    expect(prompt).toContain('SAVED_VISA_VALUE');
    expect(prompt).not.toContain('PRIVATE_GENDER_VALUE');
    expect(prompt).not.toContain('PRIVATE_STORAGE_PATH');
    const result = await runPlanner(request, { prepareDevice: async () => true, device: vi.fn().mockResolvedValue(response(proposal('1', 'preference', ['requiresSponsorship']))), cloud: vi.fn() });
    expect(result.entries[0]).toMatchObject({ value: 'No', requiresConfirmation: true, evidence: ['preferences.requiresSponsorship'] });
  });

  it('blocks model guesses for sensitive facts and withholds demographics without opt-in', () => {
    const request = input([]);
    request.preferences.gender = 'Woman';
    expect(validateProposal(proposal('1', 'profile', ['country']), field('1', 'Are you a citizen?'), request, 'ON_DEVICE')).toBeNull();
    expect(validateProposal(proposal('1', 'preference', ['gender']), field('1', 'Gender'), request, 'IN_CLOUD')).toBeNull();
    expect(validateProposal(proposal('1', 'preference', ['backgroundCheckConsent']), field('1', 'Do you require sponsorship?'), request, 'ON_DEVICE')).toBeNull();
  });

  it('holds career drafts for explicit review and excludes cover letters and files', async () => {
    const result = await runPlanner(input([field('1', 'Describe your leadership experience', 'textarea'), field('2', 'Cover letter', 'textarea'), field('3', 'Resume', 'file')]), {
      prepareDevice: async () => true, device: vi.fn().mockResolvedValue(response(proposal('1', 'draft', ['workExperience'], 'I built internal dashboards.'), proposal('2', 'draft', ['skills'], 'Cover letter prose.'))), cloud: vi.fn(),
    });
    expect(result.entries[0]).toMatchObject({ value: 'I built internal dashboards.', status: 'needs_review', requiresConfirmation: true });
    expect(result.entries.slice(1).every((entry) => entry.status === 'manual' && !entry.value)).toBe(true);
  });

  it('explains missing facts and does not invent a location when only a state is known', async () => {
    const request = input([field('1', 'Your home city')]); request.profile.city = '';
    const result = await runPlanner(request, { prepareDevice: async () => true, device: vi.fn().mockResolvedValue(response({ ...proposal('1', 'unknown', []), reason: 'Please add your city to your profile.' })), cloud: vi.fn() });
    expect(result.entries[0]).toMatchObject({ value: '', reason: 'Please add your city to your profile.', status: 'needs_user' });
    expect(validateProposal(proposal('1', 'profile', ['city', 'state']), request.fields[0], request, 'ON_DEVICE')).toBeNull();
  });
});
