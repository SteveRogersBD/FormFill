// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { emptyProfile } from '../profile';
import { emptyPreferences } from '../preferences';
import { SidePanel } from '../SidePanel';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), preferences: vi.fn(), plan: vi.fn(), message: vi.fn(), session: new Map<string, unknown>() }));
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
  mocks.session.clear();
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
    storage: { session: { get: async (key: string) => ({ [key]: mocks.session.get(key) }), set: async (data: Record<string, unknown>) => { for (const [key, value] of Object.entries(data)) mocks.session.set(key, structuredClone(value)); }, remove: async (key: string) => { mocks.session.delete(key); } } }, permissions: { contains: async () => true },
    scripting: { executeScript: async () => [{ frameId: 0 }] },
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<SidePanel user={{ uid: 'user' } as User} onLogout={async () => {}} />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('AI side panel workflow', () => {
  it('loads the saved PDF text before generation and stages it with the full JD', async () => {
    mocks.profile.mockResolvedValue({ ...emptyProfile(), resumePath: 'resumes/user/current.pdf', updatedAt: 2 });
    await act(async () => button('Scan and analyze with AI').click());
    expect(mocks.plan).toHaveBeenCalledOnce();
    expect(mocks.plan.mock.calls[0][0]).toMatchObject({ resumeText: 'Full resume text', job: { description: application.description } });
    await vi.waitFor(() => expect((mocks.session.get('applyAiWorkspace:user') as any)?.resumeText).toBe('Full resume text'));
    expect((mocks.session.get('applyAiWorkspace:user') as any).resumePath).toBe('resumes/user/current.pdf');
  });

  it('protects manual edits when rescanning matching questions on the same application', async () => {
    await act(async () => button('Scan and analyze with AI').click());
    const select = host.querySelectorAll('select')[0];
    await act(async () => { select.value = 'Hybrid'; Simulate.change(select); });
    await act(async () => button('Scan and analyze again').click());
    expect(host.querySelectorAll('select')[0].value).toBe('Hybrid');
    expect(mocks.plan.mock.calls[1][0].fixedAnswers).toEqual({ 'frame-0-a': 'Hybrid' });
  });
  it('restores edited answers and context on reopen without another AI call, and can discard them', async () => {
    await act(async () => button('Scan and analyze with AI').click());
    const select = host.querySelectorAll('select')[0];
    await act(async () => { select.value = 'Hybrid'; Simulate.change(select); });
    await vi.waitFor(() => expect((mocks.session.get('applyAiWorkspace:user') as any)?.values['frame-0-a']).toBe('Hybrid'));
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => { root.render(<SidePanel user={{ uid: 'user' } as User} onLogout={async () => {}} />); });
    expect(host.querySelectorAll('select')[0].value).toBe('Hybrid');
    expect(host.textContent).toContain('Restored your temporary application workspace');
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(application.description);
    expect(mocks.plan).toHaveBeenCalledOnce();
    await act(async () => button('Discard').click());
    expect(mocks.session.has('applyAiWorkspace:user')).toBe(false);
    expect(host.textContent).not.toContain('Review answers');
  });

  it('does not generate until the full JD is supplied and sends pasted context in one batch', async () => {
    mocks.message.mockImplementation(async (_tab: number, message: { type: string }) => message.type === 'APPLYAI_SCAN_FIELDS' ? { ...application, description: '' } : { filled: 1, failed: [] });
    await act(async () => button('Scan and analyze with AI').click());
    expect(mocks.plan).not.toHaveBeenCalled();
    const description = host.querySelector('textarea')!;
    const full = 'Responsibilities '.repeat(1000) + 'FINAL REQUIREMENT';
    await act(async () => { description.value = full; Simulate.change(description); });
    await act(async () => button('Analyze answers again').click());
    expect(mocks.plan).toHaveBeenCalledOnce();
    expect(mocks.plan.mock.calls[0][0].job.description).toBe(full);
  });

  it('detects new conditional questions after filling and requires another scan', async () => {
    let mutated = false;
    mocks.message.mockImplementation(async (_tab: number, message: { type: string }) => {
      if (message.type === 'APPLYAI_FILL_FIELDS') { mutated = true; return { filled: 2, failed: [], outcomes: { a: 'verified', b: 'verified' } }; }
      return mutated ? { ...application, fields: [...application.fields, { id: 'new', label: 'Explain your answer', type: 'textarea', required: true, options: [], selector: '' }] } : application;
    });
    await act(async () => button('Scan and analyze with AI').click());
    await act(async () => (host.querySelector('.confirm-sensitive input') as HTMLInputElement).click());
    await act(async () => button('Fill reviewed answers').click());
    expect(host.textContent).toContain('Filling revealed new or changed questions');
    expect(host.textContent).toContain('Filled and verified');
    expect(button('Fill reviewed answers').disabled).toBe(true);
    expect(mocks.plan).toHaveBeenCalledOnce();
  });

  it('fills unchanged questions when a different field disappears', async () => {
    await act(async () => button('Scan and analyze with AI').click());
    await act(async () => (host.querySelector('.confirm-sensitive input') as HTMLInputElement).click());
    mocks.message.mockImplementation(async (_tab: number, message: { type: string }) => message.type === 'APPLYAI_SCAN_FIELDS' ? { ...application, fields: application.fields.slice(1) } : { filled: 1, failed: [] });
    await act(async () => button('Fill reviewed answers').click());
    const calls = mocks.message.mock.calls.filter((call) => call[1].type === 'APPLYAI_FILL_FIELDS');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].values).toEqual({ b: 'No' });
    expect(host.textContent).toContain('1 answer(s) were skipped');
  });
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
