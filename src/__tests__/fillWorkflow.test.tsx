// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://jobs.ashbyhq.com/apex-technology-inc/692bb497-59ba-44df-bacf-fffd2f7c6344/application?jr_id=test"}
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { emptyProfile } from '../profile';
import { emptyPreferences } from '../preferences';
import { SidePanel } from '../SidePanel';

const modelWork = vi.hoisted(() => ({ current: null as Promise<unknown> | null }));

vi.mock('../firebase', () => ({ firebaseAppCheckReady: false }));
vi.mock('../data', () => ({
  loadProfile: async () => ({ ...emptyProfile(), updatedAt: 1, fullName: 'Riley Example', email: 'riley@example.test', phone: '+15550101234', postalCode: '60601', linkedin: 'https://linkedin.com/in/riley-example' }),
  loadPreferences: async () => ({ ...emptyPreferences() }), listApplications: async () => [], getResumeText: vi.fn(), getResumeAttachment: vi.fn(), saveApplication: vi.fn(), updateApplication: vi.fn(),
}));
vi.mock('../plannerModel', async () => {
  const { runPlanner } = await import('../plannerGraph');
  return { planApplication: (input: Parameters<typeof runPlanner>[0]) => { modelWork.current = runPlanner(input, { prepareDevice: async () => false, device: vi.fn(), cloud: vi.fn() }); return modelWork.current; } };
});

const roots: Root[] = [];

function ControlledApplication() {
  const [values, setValues] = useState<Record<string, string>>({});
  return <form onSubmit={(event) => { event.preventDefault(); throw new Error('Autofill must never submit.'); }}>
    <div data-job-description>Build test and automation tools using TypeScript. This is fixture job context.</div>
    {[['Full name', 'text'], ['First name', 'text'], ['Last name', 'text'], ['Email', 'email'], ['Phone', 'tel'], ['Zip code', 'text'], ['LinkedIn', 'url']].map(([label, type]) => <div className="ashby-application-form-field-entry" key={label}><label className="ashby-application-form-question-title" htmlFor={label}>{label}</label><input id={label} type={type} required value={values[label] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [label]: event.target.value }))} /></div>)}
    <label htmlFor="essay">Why are you interested?</label><textarea id="essay" required value={values.essay ?? ''} onChange={(event) => setValues((current) => ({ ...current, essay: event.target.value }))} />
    <button type="submit">Submit application</button>
    <output aria-label="Accepted application values">{JSON.stringify(values)}</output>
  </form>;
}
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach((root) => root.unmount()); });
  document.body.innerHTML = ''; vi.unstubAllGlobals();
  delete (globalThis as any).__applyAiPageListenerInstalled;
});

describe('complete contact autofill integration', () => {
  it('prepares saved facts through the real graph and fills real controlled inputs despite an unanswered required essay', async () => {
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
        try { return await new Promise((resolve) => listener(message, {}, resolve)); }
        finally { panel.hidden = false; }
      } },
      scripting: { executeScript: async () => [{ frameId: 0 }] }, permissions: { contains: async () => true },
      storage: { session: { get: async (key: string) => ({ [key]: session.get(key) }), set: async (data: Record<string, unknown>) => { for (const [key, value] of Object.entries(data)) session.set(key, value); }, remove: async (key: string) => { session.delete(key); } } },
    });
    await import('../content');
    await act(async () => { jobRoot.render(<ControlledApplication />); panelRoot.render(<SidePanel user={{ uid: 'fixture-user' } as User} onLogout={async () => {}} />); });
    const scan = [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Scan and analyze with AI')!;
    await act(async () => scan.click());
    await act(async () => { await vi.waitFor(() => expect(modelWork.current).toBeTruthy()); await modelWork.current; });
    const partial = [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Fill prepared answers')!;
    expect(partial).toBeTruthy(); expect(partial.disabled, panel.textContent ?? '').toBe(false);
    await act(async () => partial.click());
    const accepted = JSON.parse(job.querySelector('output')!.textContent!);
    expect(accepted).toMatchObject({ 'Full name': 'Riley Example', 'First name': 'Riley', 'Last name': 'Example', Email: 'riley@example.test', Phone: '+15550101234', 'Zip code': '60601', LinkedIn: 'https://linkedin.com/in/riley-example' });
    expect(job.querySelector('textarea')!.value).toBe('');
    expect(panel.textContent).toContain('Verified 7 fields');
    expect(messages.filter((message: any) => message.type === 'APPLYAI_FILL_FIELDS')).toHaveLength(1);
  });
});
