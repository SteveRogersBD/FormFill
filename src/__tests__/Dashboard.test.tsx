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
