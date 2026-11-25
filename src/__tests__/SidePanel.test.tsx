// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { emptyProfile } from '../profile';
import { emptyPreferences } from '../preferences';
import { SidePanel } from '../SidePanel';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), preferences: vi.fn(), plan: vi.fn(), message: vi.fn() }));
vi.mock('../data', () => ({ loadProfile: mocks.profile, loadPreferences: mocks.preferences, listApplications: async () => [], getResumeText: async () => 'Full resume text', getResumeAttachment: vi.fn(), saveApplication: vi.fn(), updateApplication: vi.fn() }));
vi.mock('../firebase', () => ({ firebaseAppCheckReady: true }));
vi.mock('../plannerModel', () => ({ planApplication: mocks.plan }));

let root: Root;
let host: HTMLDivElement;
const application = { title: 'Engineer', role: 'Engineer', company: 'Example', description: 'Entire job description with requirements.', url: 'https://jobs.example.com/apply', platform: 'standard', fields: [
  { id: 'a', label: 'Preferred setup', type: 'choice', required: true, options: ['Remote', 'Hybrid'], selector: '', description: 'Choose your preferred arrangement.' },
  { id: 'b', label: 'Will you require sponsorship?', type: 'radio', required: true, options: ['Yes', 'No'], selector: '' },
] };
const button = (label: string) => [...host.querySelectorAll('button')].find((item) => item.textContent === label)!;

beforeEach(async () => {
  vi.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.profile.mockResolvedValue({ ...emptyProfile(), updatedAt: 1 });
  mocks.preferences.mockResolvedValue({ ...emptyPreferences(), requiresSponsorship: 'no' });
  mocks.plan.mockResolvedValue({ entries: [
    { fieldId: 'frame-0-a', value: 'Remote', status: 'ready', source: 'ON_DEVICE', evidence: ['preferences.remotePreference'], reason: 'Saved arrangement.', requiresConfirmation: false },
    { fieldId: 'frame-0-b', value: 'No', status: 'ready', source: 'saved', evidence: ['preferences.requiresSponsorship'], reason: 'Saved sponsorship answer.', requiresConfirmation: true },
  ], attempts: ['ON_DEVICE'], warnings: [] });
  mocks.message.mockImplementation(async (_tab: number, message: { type: string }) => message.type === 'APPLYAI_SCAN_FIELDS' ? application : { filled: 1, failed: [] });
  vi.stubGlobal('chrome', {
    tabs: { query: async () => [{ id: 1, url: application.url }], sendMessage: mocks.message },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, permissions: { contains: async () => true },
    scripting: { executeScript: async () => [{ frameId: 0 }] },
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<SidePanel user={{ uid: 'user' } as User} onLogout={async () => {}} />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('AI side panel workflow', () => {
  it('analyzes the scan, displays provenance, and preserves edits when approved cloud fallback is rerun', async () => {
    await act(async () => button('Scan and analyze with AI').click());
    await vi.waitFor(() => expect(mocks.plan).toHaveBeenCalledOnce());
    expect(mocks.plan.mock.calls[0][0]).toMatchObject({ allowCloud: false, job: { company: 'Example' }, fields: [expect.objectContaining({ description: 'Choose your preferred arrangement.' }), expect.anything()] });
    expect(host.textContent).toContain('On-device AI');
    expect(host.textContent).toContain('Source: Preferred work arrangement');
    const select = host.querySelectorAll('select')[0];
    await act(async () => { select.value = 'Hybrid'; Simulate.change(select); });
    const cloudConsent = host.querySelector('.ai-settings input') as HTMLInputElement;
    await act(async () => cloudConsent.click());
    await act(async () => button('Analyze answers again').click());
    expect(mocks.plan.mock.calls[1][0].allowCloud).toBe(true);
    expect(select.value).toBe('Hybrid');
    expect(host.textContent).toContain('Edited by you.');
    expect(mocks.profile).toHaveBeenCalledTimes(3); // initial load, scan, reanalysis
  });

  it('blocks all filling until required sensitive answers are reviewed', async () => {
    await act(async () => button('Scan and analyze with AI').click());
    await act(async () => button('Fill reviewed answers').click());
    let calls = mocks.message.mock.calls.filter((call) => call[1].type === 'APPLYAI_FILL_FIELDS');
    expect(calls).toHaveLength(0);
    expect(button('Fill reviewed answers').disabled).toBe(true);
    const approval = host.querySelector('.confirm-sensitive input') as HTMLInputElement;
    await act(async () => approval.click());
    await act(async () => button('Fill reviewed answers').click());
    calls = mocks.message.mock.calls.filter((call) => call[1].type === 'APPLYAI_FILL_FIELDS');
    expect(calls[0][1].values).toEqual({ a: 'Remote', b: 'No' });
  });
});
