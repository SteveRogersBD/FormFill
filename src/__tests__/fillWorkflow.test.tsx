// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://jobs.ashbyhq.com/apex-technology-inc/692bb497-59ba-44df-bacf-fffd2f7c6344/application?jr_id=test"}
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { emptyProfile } from '../profile';
import { emptyPreferences } from '../preferences';
import { SidePanel } from '../SidePanel';

const modelWork = vi.hoisted(() => ({ current: null as Promise<unknown> | null, fill: null as Promise<unknown> | null, prepare: vi.fn(), device: vi.fn(), cloud: vi.fn(), submit: vi.fn(), appCheck: false }));

vi.mock('../firebase', () => ({ get firebaseAppCheckReady() { return modelWork.appCheck; } }));
vi.mock('../data', () => ({
  loadProfile: async () => ({ ...emptyProfile(), updatedAt: 1, fullName: 'Riley Example', email: 'riley@example.test', phone: '+15550101234', postalCode: '60601', linkedin: 'https://linkedin.com/in/riley-example', skills: ['TypeScript'] }),
  loadPreferences: async () => ({ ...emptyPreferences(), eeoOptIn: true, gender: 'Male', veteranStatus: 'I am not a veteran', remotePreference: 'hybrid' }), listApplications: async () => [], getResumeText: vi.fn(), getResumeAttachment: vi.fn(), saveApplication: vi.fn(), updateApplication: vi.fn(),
}));
vi.mock('../plannerModel', async () => {
  const { runPlanner } = await import('../plannerGraph');
  return { planApplication: (input: Parameters<typeof runPlanner>[0]) => { modelWork.current = runPlanner(input, { prepareDevice: modelWork.prepare, device: modelWork.device, cloud: modelWork.cloud }); return modelWork.current; } };
});

const roots: Root[] = [];

beforeEach(() => {
  vi.clearAllMocks(); vi.resetModules(); modelWork.current = null; modelWork.fill = null; modelWork.appCheck = false;
  modelWork.prepare.mockResolvedValue(false);
});

function ControlledChoices() {
  const [open, setOpen] = useState(false);
  const [gender, setGender] = useState('');
  const [veteran, setVeteran] = useState('');
  const [arrangement, setArrangement] = useState('');
  return <>
    <div className="ashby-application-form-field-entry"><label className="ashby-application-form-question-title">Gender</label><button type="button" role="combobox" aria-expanded={open} aria-controls={open ? 'gender-popup' : undefined} onMouseDown={(event) => { event.preventDefault(); flushSync(() => setOpen((current) => !current)); }}>{gender || 'Choose gender'}</button></div>
    {open && createPortal(<div role="listbox" id="gender-popup">{['Man', 'Woman'].map((option) => <div key={option} role="option" onMouseDown={(event) => { event.preventDefault(); flushSync(() => { setGender(option); setOpen(false); }); }}>{option}</div>)}</div>, document.body)}
    <label htmlFor="veteran">Veteran status</label><select id="veteran" required value={veteran} onChange={(event) => setVeteran(event.target.value)}><option value="">Choose</option><option value="none">I am not a veteran</option><option value="veteran">I am a veteran</option></select>
    <div role="radiogroup" aria-label="Preferred work arrangement">{['Remote', 'Hybrid'].map((option) => <span key={option}><button type="button" role="radio" data-state={arrangement === option ? 'checked' : 'unchecked'} onMouseDown={() => flushSync(() => setArrangement(option))}>{option}</button><input type="hidden" value={arrangement === option ? 'true' : 'false'} /></span>)}</div>
    <output aria-label="Accepted choice values">{JSON.stringify({ gender, veteran, arrangement })}</output>
  </>;
}

function ControlledApplication({ withAiQuestions = false }: { withAiQuestions?: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return <form onSubmit={(event) => { event.preventDefault(); modelWork.submit(); }}>
    <div data-job-description>Build test and automation tools using TypeScript. This is fixture job context.</div>
    {[['Full name', 'text'], ['First name', 'text'], ['Last name', 'text'], ['Email', 'email'], ['Phone', 'tel'], ['Zip code', 'text'], ['LinkedIn', 'url']].map(([label, type]) => <div className="ashby-application-form-field-entry" key={label}><label className="ashby-application-form-question-title" htmlFor={label}>{label}</label><input id={label} type={type} required value={values[label] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [label]: event.target.value }))} /></div>)}
    <label htmlFor="essay">Why are you interested?</label><textarea id="essay" required value={values.essay ?? ''} onChange={(event) => setValues((current) => ({ ...current, essay: event.target.value }))} />
    {withAiQuestions && ['Networking profile', 'Mail routing code'].map((label) => <label key={label}>{label}<input required value={values[label] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [label]: event.target.value }))} /></label>)}
    <button type="submit">Submit application</button>
    <output aria-label="Accepted application values">{JSON.stringify(values)}</output>
    <ControlledChoices />
  </form>;
}
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach((root) => root.unmount()); });
  document.body.innerHTML = ''; vi.unstubAllGlobals();
  delete (globalThis as any).__applyAiPageListenerInstalled;
});

async function mountWorkflow(withAiQuestions = false) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const job = document.createElement('div'); const panel = document.createElement('div');
  document.body.append(job, panel);
  const jobRoot = createRoot(job); const panelRoot = createRoot(panel); roots.push(jobRoot, panelRoot);
  let listener!: (message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean;
  const messages: unknown[] = [];
  const session = new Map<string, unknown>();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value; } } },
    tabs: { query: async () => [{ id: 1, url: location.href }], sendMessage: async (_tab: number, message: unknown) => {
      messages.push(message); panel.hidden = true;
      const response = new Promise((resolve) => listener(message, {}, resolve));
      if ((message as { type: string }).type === 'APPLYAI_FILL_FIELDS') modelWork.fill = response;
      try { return await response; }
      finally { panel.hidden = false; }
    } },
    scripting: { executeScript: async () => [{ frameId: 0 }] }, permissions: { contains: async () => true },
    storage: { session: { get: async (key: string) => ({ [key]: session.get(key) }), set: async (data: Record<string, unknown>) => { for (const [key, value] of Object.entries(data)) session.set(key, value); }, remove: async (key: string) => { session.delete(key); } } },
  });
  await import('../content');
  await act(async () => { jobRoot.render(<ControlledApplication withAiQuestions={withAiQuestions} />); panelRoot.render(<SidePanel user={{ uid: 'fixture-user' } as User} onLogout={async () => {}} />); });
  return { job, panel, messages, session };
}

describe('complete contact autofill integration', () => {
  it('scans once, resolves database then local then cloud, fills, and submits only on the separate click', async () => {
    modelWork.appCheck = true; modelWork.prepare.mockResolvedValue(true);
    modelWork.device.mockImplementation(async (prompt: string) => {
      const data = JSON.parse(prompt.split('DATA:\n')[1]);
      const localId = data.fields.find((field: any) => field.label === 'Networking profile').id;
      return JSON.stringify({ answers: [{ fieldId: localId, kind: 'profile', keys: ['linkedin'], draft: '', reason: 'Saved networking link.' }] });
    });
    modelWork.cloud.mockImplementation(async (prompt: string) => {
      const data = JSON.parse(prompt.split('DATA:\n')[1]);
      return JSON.stringify({ answers: data.targetIds.map((fieldId: string) => {
        const field = data.fields.find((item: any) => item.id === fieldId);
        return field.label === 'Mail routing code'
          ? { fieldId, kind: 'profile', keys: ['postalCode'], draft: '', reason: 'Saved postal code.' }
          : { fieldId, kind: 'draft', keys: ['skills'], draft: 'My TypeScript skills align with the role.', reason: 'Reviewed career evidence.' };
      }) });
    });
    const { job, panel, messages, session } = await mountWorkflow(true);
    await act(async () => panel.querySelector<HTMLInputElement>('.cloud-consent input')!.click());
    await act(async () => [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Scan and analyze with AI')!.click());
    await act(async () => { await vi.waitFor(() => expect(modelWork.current, panel.textContent ?? '').toBeTruthy(), { timeout: 5000 }); await modelWork.current; });
    expect(modelWork.device).toHaveBeenCalledOnce(); expect(modelWork.cloud).toHaveBeenCalledOnce();
    const cloudData = JSON.parse(modelWork.cloud.mock.calls[0][0].split('DATA:\n')[1]);
    expect(cloudData.targetIds.map((id: string) => cloudData.fields.find((field: any) => field.id === id).label)).toEqual(['Why are you interested?', 'Mail routing code']);
    expect(panel.textContent).toContain('Attempted: on-device → cloud');
    const submit = [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Submit application')!;
    expect(submit.disabled).toBe(true);
    await act(async () => panel.querySelectorAll<HTMLInputElement>('.confirm-sensitive input').forEach((approval) => approval.click()));
    await act(async () => [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Fill reviewed answers')!.click());
    await act(async () => { await modelWork.fill; });
    expect(modelWork.submit).not.toHaveBeenCalled();
    expect(submit.disabled, panel.textContent ?? '').toBe(false);
    expect(job.querySelector('textarea')!.value).toBe('My TypeScript skills align with the role.');
    await act(async () => submit.click());
    await act(async () => { await vi.waitFor(() => expect(modelWork.submit, panel.textContent ?? '').toHaveBeenCalledOnce(), { timeout: 5000 }); });
    expect(modelWork.submit).toHaveBeenCalledOnce();
    expect(messages.filter((message: any) => message.type === 'APPLYAI_SUBMIT_APPLICATION')).toHaveLength(1);
    expect(panel.textContent).toContain('Submission requested');
    expect(submit.disabled).toBe(true);
    expect((session.get('applyAiWorkspace:fixture-user') as any).submissionRequested).toBe(true);
    expect(modelWork.device).toHaveBeenCalledOnce(); expect(modelWork.cloud).toHaveBeenCalledOnce();
  }, 10000);

  it('prepares saved facts through the real graph and fills real controlled inputs despite an unanswered required essay', async () => {
    const { job, panel, messages } = await mountWorkflow();
    const scan = [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Scan and analyze with AI')!;
    await act(async () => scan.click());
    await act(async () => { await vi.waitFor(() => expect(modelWork.current, panel.textContent ?? '').toBeTruthy(), { timeout: 5000 }); await modelWork.current; });
    await act(async () => { panel.querySelectorAll<HTMLInputElement>('.confirm-sensitive input').forEach((approval) => approval.click()); });
    const partial = [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Fill prepared answers')!;
    expect(partial).toBeTruthy(); expect(partial.disabled, panel.textContent ?? '').toBe(false);
    await act(async () => partial.click());
    await act(async () => { await vi.waitFor(() => expect(modelWork.fill).toBeTruthy(), { timeout: 5000 }); expect(await modelWork.fill).toMatchObject({ filled: 10, failed: [] }); });
    const accepted = JSON.parse(job.querySelector('output')!.textContent!);
    expect(accepted).toMatchObject({ 'Full name': 'Riley Example', 'First name': 'Riley', 'Last name': 'Example', Email: 'riley@example.test', Phone: '+15550101234', 'Zip code': '60601', LinkedIn: 'https://linkedin.com/in/riley-example' });
    expect(job.querySelector('textarea')!.value).toBe('');
    expect(JSON.parse(job.querySelector('output[aria-label="Accepted choice values"]')!.textContent!)).toEqual({ gender: 'Man', veteran: 'none', arrangement: 'Hybrid' });
    expect(panel.textContent).toContain('Verified 10 fields');
    expect(messages.filter((message: any) => message.type === 'APPLYAI_FILL_FIELDS')).toHaveLength(1);
    expect(modelWork.submit).not.toHaveBeenCalled();
  });
});
