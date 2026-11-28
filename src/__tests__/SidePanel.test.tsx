// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { emptyProfile } from '../profile';
import { emptyPreferences } from '../preferences';
import { SidePanel } from '../SidePanel';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), preferences: vi.fn(), plan: vi.fn(), connection: vi.fn(), debug: vi.fn(), message: vi.fn(), session: new Map<string, unknown>() }));
vi.mock('../data', () => ({ loadProfile: mocks.profile, loadPreferences: mocks.preferences, listApplications: async () => [], getResumeText: async () => 'Full resume text', getResumeAttachment: vi.fn(), saveApplication: vi.fn(), updateApplication: vi.fn() }));
vi.mock('../firebase', () => ({ firebaseAppCheckReady: true }));
vi.mock('../plannerModel', () => ({ planApplication: mocks.plan, checkAIConnection: mocks.connection }));
vi.mock('../appCheckDebug', () => ({ getAppCheckDebugDetails: mocks.debug }));

let root: Root;
let host: HTMLDivElement;
const application = { title: 'Engineer', role: 'Engineer', company: 'Example', description: 'Entire job description with requirements.', url: 'https://jobs.example.com/apply', platform: 'standard', fields: [
  { id: 'a', label: 'Preferred setup', type: 'choice', required: true, options: ['Remote', 'Hybrid'], selector: '', description: 'Choose your preferred arrangement.' },
  { id: 'b', label: 'Will you require sponsorship?', type: 'radio', required: true, options: ['Yes', 'No'], selector: '' },
] };
const button = (label: string) => [...host.querySelectorAll('button')].find((item) => item.textContent === label)!;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_FIREBASE_APPCHECK_DEBUG', 'true');
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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('AI side panel workflow', () => {
  it('keeps scanned questions available when the profile database cannot be reached', async () => {
    mocks.profile.mockRejectedValue(new Error('Profile database unavailable.'));
    mocks.plan.mockResolvedValue({ entries: [], attempts: [], warnings: [] });
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => root.render(<SidePanel user={{ uid: 'user' } as User} onLogout={async () => {}} />));
    expect(button('Scan and analyze with AI').disabled).toBe(false);
    await act(async () => button('Scan and analyze with AI').click());
    expect(host.textContent).toContain('You can still scan and enter answers manually');
    expect(host.querySelectorAll('.answer-row')).toHaveLength(2);
    expect(mocks.plan.mock.calls[0][0].profile).toEqual(emptyProfile());
  });

  it('scans all application questions without a resume or a saved profile', async () => {
    mocks.profile.mockResolvedValue(null);
    mocks.preferences.mockResolvedValue(emptyPreferences());
    mocks.plan.mockResolvedValue({ entries: [], attempts: [], warnings: [] });
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => root.render(<SidePanel user={{ uid: 'user' } as User} onLogout={async () => {}} />));
    expect(host.textContent).toContain('scan questions without a resume');
    expect(button('Scan and analyze with AI').disabled).toBe(false);
    await act(async () => button('Scan and analyze with AI').click());
    expect(mocks.plan).toHaveBeenCalledOnce();
    expect(mocks.plan.mock.calls[0][0]).toMatchObject({ profile: emptyProfile(), resumeText: '', allowCloud: false });
    expect(mocks.plan.mock.calls[0][0].fields).toHaveLength(2);
    expect(host.querySelectorAll('.answer-row')).toHaveLength(2);
    expect([...host.querySelectorAll<HTMLSelectElement>('.answer-row select')].map((select) => select.value)).toEqual(['', '']);
  });

  it('preserves an uncertain submission request across reopening without automatically resending', async () => {
    let filled = false;
    mocks.message.mockImplementation(async (_tab: number, message: { type: string }) => {
      if (message.type === 'APPLYAI_FILL_FIELDS') { filled = true; return { filled: 2, failed: [] }; }
      if (message.type === 'APPLYAI_SUBMIT_APPLICATION') throw new Error('The tab navigated before replying.');
      return { ...application, fields: application.fields.map((field) => ({ ...field, currentValue: filled ? field.id === 'a' ? 'Remote' : 'No' : '' })) };
    });
    await act(async () => button('Scan and analyze with AI').click());
    await act(async () => (host.querySelector('.confirm-sensitive input') as HTMLInputElement).click());
    await act(async () => button('Fill reviewed answers').click());
    await act(async () => button('Submit application').click());
    expect(host.textContent).toContain('may have reached the job site');
    expect(button('Submission requested').disabled).toBe(true);
    await vi.waitFor(() => expect((mocks.session.get('applyAiWorkspace:user') as any)?.submissionRequested).toBe(true));
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => root.render(<SidePanel user={{ uid: 'user' } as User} onLogout={async () => {}} />));
    expect(button('Submission requested').disabled).toBe(true);
    expect(mocks.message.mock.calls.filter((call) => call[1].type === 'APPLYAI_SUBMIT_APPLICATION')).toHaveLength(1);
    expect(mocks.plan).toHaveBeenCalledOnce();
  });

  it('rejects changed page answers before dispatching an explicit submission', async () => {
    let filled = false;
    let changed = false;
    mocks.message.mockImplementation(async (_tab: number, message: { type: string }) => {
      if (message.type === 'APPLYAI_FILL_FIELDS') { filled = true; return { filled: 2, failed: [] }; }
      return { ...application, fields: application.fields.map((field) => ({ ...field, currentValue: filled ? field.id === 'a' ? changed ? 'Hybrid' : 'Remote' : 'No' : '' })) };
    });
    await act(async () => button('Scan and analyze with AI').click());
    expect(button('Submit application').disabled).toBe(true);
    await act(async () => (host.querySelector('.confirm-sensitive input') as HTMLInputElement).click());
    await act(async () => button('Fill reviewed answers').click());
    expect(button('Submit application').disabled).toBe(false);
    changed = true;
    await act(async () => button('Submit application').click());
    expect(host.textContent).toContain('no longer match the page');
    expect(mocks.message.mock.calls.some((call) => call[1].type === 'APPLYAI_SUBMIT_APPLICATION')).toBe(false);
    const select = host.querySelectorAll('select')[0];
    await act(async () => { select.value = 'Hybrid'; Simulate.change(select); });
    expect(button('Submit application').disabled).toBe(true);
  });

  it('copies the extension token and links its matching Firebase app without scanning or sending data', async () => {
    mocks.debug.mockResolvedValue({ token: 'fixture-secret', projectId: 'fixture-project', appId: 'fixture-web-app', consoleUrl: 'https://console.firebase.google.com/project/fixture-project/appcheck/apps?selectedAppId=fixture-web-app' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await act(async () => button('Copy App Check debug token').click());
    expect(writeText).toHaveBeenCalledWith('fixture-secret');
    expect(host.textContent).toContain('Debug token copied');
    expect(host.textContent).toContain('fixture-web-app');
    expect(host.textContent).not.toContain('fixture-secret');
    expect(mocks.message).not.toHaveBeenCalled(); expect(mocks.plan).not.toHaveBeenCalled();
  });

  it('provides manual token copying when clipboard access fails', async () => {
    mocks.debug.mockResolvedValue({ token: 'fixture-secret', projectId: 'fixture-project', appId: 'fixture-web-app', consoleUrl: 'https://console.firebase.google.com/project/fixture-project/appcheck/apps' });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Not allowed')) } });
    await act(async () => button('Copy App Check debug token').click());
    expect([...host.querySelectorAll('input')].find((input) => input.readOnly)?.value).toBe('fixture-secret');
    expect(host.textContent).toContain('Clipboard access was unavailable');
  });
  it('shows Firebase connection failures without scanning or sharing the application', async () => {
    mocks.connection.mockRejectedValue(new Error('Register this extension debug token in Firebase App Check.'));
    await act(async () => button('Check AI connection').click());
    expect(host.textContent).toContain('Register this extension debug token');
    expect(mocks.connection).toHaveBeenCalledOnce(); expect(mocks.message).not.toHaveBeenCalled(); expect(mocks.plan).not.toHaveBeenCalled();
  });
  it('reports frame messaging failures while retaining results from reachable frames', async () => {
    (chrome.scripting as any).executeScript = async () => [{ frameId: 0 }, { frameId: 1 }];
    mocks.plan.mockResolvedValue({ entries: [
      { fieldId: 'frame-0-name', value: 'Riley Example', status: 'ready', source: 'saved', evidence: [], reason: '', requiresConfirmation: false },
      { fieldId: 'frame-1-email', value: 'riley@example.test', status: 'ready', source: 'saved', evidence: [], reason: '', requiresConfirmation: false },
    ], attempts: [], warnings: [] });
    mocks.message.mockImplementation(async (_tab: number, message: { type: string }, options: { frameId: number }) => {
      const id = options.frameId === 0 ? 'name' : 'email';
      if (message.type === 'APPLYAI_SCAN_FIELDS') return { ...application, fields: [{ id, label: id === 'name' ? 'Full name' : 'Email', type: 'text', required: true, options: [], selector: '' }] };
      if (options.frameId === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { filled: 1, failed: [], outcomes: { name: 'verified' } };
    });
    await act(async () => button('Scan and analyze with AI').click());
    await act(async () => button('Fill reviewed answers').click());
    expect(host.textContent).toContain('Verified 1 field');
    expect(host.textContent).toContain('Receiving end does not exist');
    expect(host.textContent).toContain('Filled and verified');
  });
  it('offers prepared answers without filling an unapproved sensitive answer', async () => {
    await act(async () => button('Scan and analyze with AI').click());
    expect(button('Fill reviewed answers').disabled).toBe(true);
    expect(button('Fill prepared answers').disabled).toBe(false);
    await act(async () => button('Fill prepared answers').click());
    const calls = mocks.message.mock.calls.filter((call) => call[1].type === 'APPLYAI_FILL_FIELDS');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].values).toEqual({ a: 'Remote' });
  });

  it('prepares profile facts when standing-answer storage fails', async () => {
    mocks.preferences.mockRejectedValue({ code: 'permission-denied' });
    mocks.profile.mockResolvedValue({ ...emptyProfile(), fullName: 'Riley Example', email: 'riley@example.test', updatedAt: 1 });
    const fields = [{ id: 'name', label: 'Full name', type: 'text', required: true, options: [], selector: '' }, { id: 'essay', label: 'Why interested?', type: 'textarea', required: true, options: [], selector: '' }];
    mocks.message.mockImplementation(async (_tab: number, message: { type: string }) => message.type === 'APPLYAI_SCAN_FIELDS' ? { ...application, description: '', fields } : { filled: 1, failed: [] });
    await act(async () => button('Scan and analyze with AI').click());
    expect(host.textContent).toContain('Profile details are still available');
    expect(button('Fill prepared answers').disabled).toBe(false);
    await act(async () => button('Fill prepared answers').click());
    expect(mocks.message.mock.calls.find((call) => call[1].type === 'APPLYAI_FILL_FIELDS')?.[1].values).toEqual({ name: 'Riley Example' });
  });

  it('does not reinject every iframe when filling an already-scanned application', async () => {
    await act(async () => button('Scan and analyze with AI').click());
    await act(async () => (host.querySelector('.confirm-sensitive input') as HTMLInputElement).click());
    const inject = vi.fn().mockRejectedValue(new Error('An unrelated iframe cannot be accessed'));
    (chrome.scripting as any).executeScript = inject;
    await act(async () => button('Fill reviewed answers').click());
    expect(inject).not.toHaveBeenCalled();
    expect(mocks.message.mock.calls.filter((call) => call[1].type === 'APPLYAI_FILL_FIELDS')).toHaveLength(1);
  });
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

  it('allows factual matching before the JD is supplied and enables drafting after context is added', async () => {
    mocks.message.mockImplementation(async (_tab: number, message: { type: string }) => message.type === 'APPLYAI_SCAN_FIELDS' ? { ...application, description: '' } : { filled: 1, failed: [] });
    await act(async () => button('Scan and analyze with AI').click());
    expect(mocks.plan.mock.calls[0][0].draftsAllowed).toBe(false);
    const description = host.querySelector('textarea')!;
    const full = 'Responsibilities '.repeat(1000) + 'FINAL REQUIREMENT';
    await act(async () => { description.value = full; Simulate.change(description); });
    await act(async () => button('Analyze answers again').click());
    expect(mocks.plan).toHaveBeenCalledTimes(2);
    expect(mocks.plan.mock.calls[1][0]).toMatchObject({ draftsAllowed: true, job: { description: full } });
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
