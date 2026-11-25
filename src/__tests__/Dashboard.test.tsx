// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { Dashboard } from '../Dashboard';
import { emptyPreferences, preferencesSchema } from '../preferences';
import { emptyProfile, resumeProfileSchema, workExperienceSchema } from '../profile';

const mocks = vi.hoisted(() => ({ save: vi.fn(), loadProfile: vi.fn(), loadPreferences: vi.fn(), saveProfile: vi.fn() }));
vi.mock('../data', () => ({
  loadProfile: mocks.loadProfile, listApplications: async () => [],
  loadPreferences: mocks.loadPreferences,
  savePreferences: mocks.save, saveProfile: mocks.saveProfile, saveResume: vi.fn(),
  deleteApplication: vi.fn(), getResumeUrl: vi.fn(), updateApplication: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadProfile.mockResolvedValue(emptyProfile());
  mocks.loadPreferences.mockResolvedValue(preferencesSchema.parse({ requiresSponsorship: 'no', sponsorshipFuture: 'yes' }));
  mocks.saveProfile.mockImplementation(async (profile) => ({ ...profile, updatedAt: 1 }));
});

async function renderDashboard() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<Dashboard user={{ uid: 'test-user' } as User} onLogout={async () => {}} />); });
  return { host, root };
}

describe('dashboard work eligibility answers', () => {
  it('retains editor drafts when saving fails and prevents reversed work dates', async () => {
    mocks.loadProfile.mockResolvedValue(resumeProfileSchema.parse({ workExperience: [workExperienceSchema.parse({ id: 'role-1', jobTitle: 'Engineer', company: 'Example', startDate: '2024-06', endDate: '2024-08' })] }));
    const { host, root } = await renderDashboard();
    try {
      await act(async () => (host.querySelector('[aria-label="Edit Work Experience"]') as HTMLButtonElement).click());
      const date = host.querySelectorAll<HTMLInputElement>('input[type="month"]')[1];
      await act(async () => { date.value = '2024-01'; Simulate.change(date); });
      await act(async () => Simulate.submit(host.querySelector('form')!));
      expect(mocks.saveProfile).not.toHaveBeenCalled();
      expect(host.querySelector('[role="dialog"] [role="alert"]')!.textContent).toContain('End date must be on or after');
      await act(async () => { date.value = '2024-09'; Simulate.change(date); });
      mocks.saveProfile.mockRejectedValueOnce(new Error('Offline. Try again.'));
      await act(async () => Simulate.submit(host.querySelector('form')!));
      expect(date.value).toBe('2024-09');
      expect(host.querySelector('[role="dialog"] [role="alert"]')!.textContent).toContain('Offline');
      await act(async () => Simulate.submit(host.querySelector('form')!));
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(host.querySelector('#experience')!.textContent).toContain('2024-09');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it('cancels draft deletions and clears an end date when a role becomes current', async () => {
    mocks.loadProfile.mockResolvedValue(resumeProfileSchema.parse({ workExperience: [workExperienceSchema.parse({ id: 'role-1', company: 'Example', jobTitle: 'Engineer', startDate: '2024-01', endDate: '2024-06' })] }));
    const { host, root } = await renderDashboard();
    try {
      await act(async () => (host.querySelector('[aria-label="Edit Work Experience"]') as HTMLButtonElement).click());
      await act(async () => (host.querySelector('[aria-label="Remove work experience 1"]') as HTMLButtonElement).click());
      expect(host.querySelector('.experience-editor-entry')).toBeNull();
      await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!.click());
      expect(host.querySelector('#experience')!.textContent).toContain('Example');
      expect(mocks.saveProfile).not.toHaveBeenCalled();
      await act(async () => (host.querySelector('[aria-label="Edit Work Experience"]') as HTMLButtonElement).click());
      await act(async () => (host.querySelector('.current-role-choice input') as HTMLInputElement).click());
      const endDate = host.querySelectorAll<HTMLInputElement>('input[type="month"]')[1];
      expect(endDate.disabled).toBe(true); expect(endDate.value).toBe('');
      await act(async () => Simulate.submit(host.querySelector('form')!));
      expect(mocks.saveProfile.mock.calls[0][0]).toMatchObject({ currentTitle: 'Engineer', currentCompany: 'Example', workExperience: [expect.objectContaining({ current: true, endDate: '' })] });
      expect(host.querySelector('#experience')!.textContent).toContain('Present');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it('adds and saves separate experience records without losing descriptions', async () => {
    mocks.loadProfile.mockResolvedValue(resumeProfileSchema.parse({ workExperience: ['Engineer at Northstar', 'Built the original platform.'] }));
    const { host, root } = await renderDashboard();
    try {
      await act(async () => (host.querySelector('[aria-label="Edit Work Experience"]') as HTMLButtonElement).click());
      const add = [...host.querySelectorAll('button')].find((button) => button.textContent === '＋ Add work experience')!;
      await act(async () => add.click());
      const roles = host.querySelectorAll('.experience-editor-entry');
      expect(roles).toHaveLength(2);
      const inputs = roles[1].querySelectorAll('input');
      await act(async () => {
        inputs[0].value = 'Research Assistant'; Simulate.change(inputs[0]);
        inputs[1].value = 'Example Lab'; Simulate.change(inputs[1]);
        inputs[2].value = 'Chicago'; Simulate.change(inputs[2]);
      });
      const type = roles[1].querySelector('select')!;
      await act(async () => { type.value = 'Internship'; Simulate.change(type); });
      const dates = roles[1].querySelectorAll<HTMLInputElement>('input[type="month"]');
      await act(async () => { dates[0].value = '2024-06'; Simulate.change(dates[0]); });
      await act(async () => { dates[1].value = '2024-08'; Simulate.change(dates[1]); });
      const bulletButton = [...roles[1].querySelectorAll('button')].find((button) => button.textContent === '＋ Bullet point')!;
      await act(async () => bulletButton.click());
      const bullet = roles[1].querySelector<HTMLTextAreaElement>('.description-bullet textarea')!;
      await act(async () => { bullet.value = 'Designed an experiment.'; Simulate.change(bullet); });
      await act(async () => Simulate.submit(host.querySelector('form')!));
      const saved = mocks.saveProfile.mock.calls[0][0];
      expect(saved.workExperience).toHaveLength(2);
      expect(saved.workExperience[0]).toMatchObject({ company: 'Northstar', description: ['Built the original platform.'] });
      expect(saved.workExperience[1]).toMatchObject({ jobTitle: 'Research Assistant', company: 'Example Lab', location: 'Chicago', jobType: 'Internship', startDate: '2024-06', endDate: '2024-08', description: ['Designed an experiment.'] });
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(host.querySelector('#experience')!.textContent).toContain('Designed an experiment.');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it('loads old profiles without guessing a combined answer, then saves the two requested answers', async () => {
    mocks.save.mockImplementation(async (answers) => ({ ...answers, updatedAt: 1 }));
    const { host, root } = await renderDashboard();
    try {
      await act(async () => { (host.querySelector('[aria-label="Edit Equal Employment"]') as HTMLButtonElement).click(); });
      const authorized = host.querySelector('#sa-workAuthorized select') as HTMLSelectElement;
      const combined = host.querySelector('#sa-sponsorshipNowOrFuture select') as HTMLSelectElement;
      expect(host.querySelector('#sa-workAuthorized')!.textContent).toContain('Are you authorized to work lawfully in the country for the position in which you are applying?');
      expect(host.querySelector('#sa-sponsorshipNowOrFuture')!.textContent).toContain('Will you now or in the future require the employer to commence (‘sponsor’) an immigration case in order to employ you?');
      expect(combined.value).toBe('');
      expect([...combined.options].map((option) => option.value)).toEqual(['', 'yes', 'no', 'unsure']);
      await act(async () => { authorized.value = 'yes'; Simulate.change(authorized); combined.value = 'yes'; Simulate.change(combined); });
      await act(async () => { Simulate.submit(host.querySelector('form')!); });
      expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ workAuthorized: 'yes', sponsorshipNowOrFuture: 'yes', requiresSponsorship: 'no', sponsorshipFuture: 'yes' }), 'test-user');
      expect(host.textContent).toContain('Standing answers saved.');
      expect(emptyPreferences().sponsorshipNowOrFuture).toBe('');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
