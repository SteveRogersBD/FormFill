// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

let listener: (message: unknown, sender: unknown, respond: (result: any) => void) => boolean;
const send = (message: unknown): Promise<any> => new Promise((resolve) => listener(message, {}, resolve));
const scan = () => send({ type: 'APPLYAI_SCAN_FIELDS' });
const fill = (values: Record<string, string>, resume?: unknown) => send({ type: 'APPLYAI_FILL_FIELDS', values, resume });

beforeEach(async () => {
  document.body.innerHTML = '';
  vi.resetModules();
  delete (globalThis as any).__applyAiPageListenerInstalled;
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  await import('../content');
});

describe('Ashby controls', () => {
  it('does not click submit buttons disguised as a choice group', async () => {
    document.body.innerHTML = '<form><fieldset><legend>Continue?</legend><button>Yes</button><button>No</button></fieldset></form>';
    expect((await scan()).fields).toHaveLength(0);
  });

  it('reports ambiguous city suggestions instead of choosing the first one', async () => {
    document.body.innerHTML = '<label>Location<input role="combobox"></label><div role="option">Springfield, Illinois, USA</div><div role="option">Springfield, Missouri, USA</div>';
    const click = vi.fn();
    document.querySelectorAll('[role="option"]').forEach((option) => option.addEventListener('click', click));
    const { fields } = await scan();
    expect(await fill({ [fields[0].id]: 'Springfield' })).toMatchObject({ filled: 0, failed: [fields[0].id] });
    expect(click).not.toHaveBeenCalled();
  });
  it('reads the location question outside an unlabelled combobox and fills saved links and ZIP', async () => {
    document.body.innerHTML = `<div class="ashby-application-form-field-entry">
      <label class="ashby-application-form-question-title" for="missing-id">Location</label>
      <div><input role="combobox" aria-autocomplete="list" placeholder="Start typing..."></div>
      <div role="option">Chicago, Illinois, USA</div>
    </div><label for="zip">Zip Code</label><input id="zip">
    <label for="linkedin">LinkedIn Profile</label><input id="linkedin">
    <label for="website">Website</label><input id="website">`;
    const click = vi.fn();
    document.querySelector('[role="option"]')!.addEventListener('click', (event) => { click(); (event.currentTarget as HTMLElement).setAttribute('aria-selected', 'true'); });
    const { fields } = await scan();
    expect(fields.map((f: any) => f.label)).toEqual(['Location', 'Zip Code', 'LinkedIn Profile', 'Website']);
    const result = await fill(Object.fromEntries(fields.map((f: any, i: number) => [f.id, ['Chicago, IL, United States', '60601', 'https://linkedin.com/in/test', 'https://example.com'][i]])));
    expect(result).toMatchObject({ filled: 4, failed: [] });
    expect(click).toHaveBeenCalledOnce();
    expect((document.getElementById('zip') as HTMLInputElement).value).toBe('60601');
    expect((document.getElementById('linkedin') as HTMLInputElement).value).toBe('https://linkedin.com/in/test');
    expect((document.getElementById('website') as HTMLInputElement).value).toBe('https://example.com');
  });

  it('detects Ashby Yes/No buttons without treating their backing checkbox as another question', async () => {
    document.body.innerHTML = `<div class="ashby-application-form-field-entry">
      <label class="ashby-application-form-question-title">Are you authorized to work lawfully?</label>
      <div class="ashby-application-form-input-yesno"><button aria-pressed="false">Yes</button><button aria-pressed="false">No</button><input type="checkbox"></div>
    </div><button>Submit Application</button>`;
    const buttons = document.querySelectorAll('button');
    const no = vi.fn(); const submit = vi.fn();
    buttons[1].addEventListener('click', () => { no(); buttons[1].setAttribute('aria-pressed', 'true'); });
    buttons[2].addEventListener('click', submit);
    const { fields } = await scan();
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ type: 'choice', options: ['Yes', 'No'], label: 'Are you authorized to work lawfully?' });
    expect(await fill({ [fields[0].id]: 'No' })).toMatchObject({ filled: 1, failed: [] });
    expect(no).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it('clicks radios to notify framework handlers, including a single acknowledgment option', async () => {
    document.body.innerHTML = `<fieldset><legend>Arbitration Acknowledgment</legend>
      <label><input type="radio" name="ack">I Acknowledge/Accept this Statement</label></fieldset>`;
    const click = vi.fn();
    document.querySelector('input')!.addEventListener('click', click);
    const { fields } = await scan();
    expect(await fill({ [fields[0].id]: fields[0].options[0] })).toMatchObject({ filled: 1, failed: [] });
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('input')!.checked).toBe(true);
  });

  it('keeps SMS consent separate from the phone question', async () => {
    document.body.innerHTML = `<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="phone">Phone Number</label><input id="phone" type="tel">
    <div class="ashby-application-form-texting-consent-description"><div role="textbox">Do you consent to text messages?</div>
    <label><input type="radio" name="communicationConsent" value="given">Yes - I consent</label>
    <label><input type="radio" name="communicationConsent" value="notGiven">No - I do not consent</label></div></div>`;
    const { fields } = await scan();
    expect(fields[1].label).toBe('Do you consent to text messages?');
  });

  it('preserves successful text fills when an attachment fails', async () => {
    document.body.innerHTML = '<label>Name<input></label><label>Resume<input type="file"></label>';
    const { fields } = await scan();
    const result = await fill({ [fields[0].id]: 'Jordan Lee' }, { fieldId: fields[1].id, data: '!invalid base64!', name: 'resume.pdf' });
    expect(result).toMatchObject({ filled: 1, failed: [fields[1].id] });
    expect(document.querySelector('input')!.value).toBe('Jordan Lee');
  });

  it('reconstructs the PDF from extension bytes without a job-page download', async () => {
    document.body.innerHTML = '<div class="ashby-application-form-autofill-input-root"><input type="file"></div><label>Resume<input type="file"></label><label>Cover Letter<input type="file"></label>';
    // jsdom has no DataTransfer; emulate its FileList for the browser files setter.
    let attached: File[] = [];
    vi.stubGlobal('DataTransfer', class {
      files: File[] = [];
      items = { add: (file: File) => this.files.push(file) };
    });
    const input = document.querySelectorAll('input')[1];
    Object.defineProperty(input, 'files', { configurable: true, get: () => attached });
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')!;
    Object.defineProperty(HTMLInputElement.prototype, 'files', { configurable: true, get: setter.get, set: (files: File[]) => { attached = files; } });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try {
      const { fields } = await scan();
      expect(fields.map((f: any) => f.label)).toEqual(['Resume', 'Cover Letter']);
      expect(await fill({}, { fieldId: fields[0].id, data: btoa('%PDF-test'), name: 'resume.pdf' })).toMatchObject({ filled: 1, failed: [] });
      expect(attached[0].name).toBe('resume.pdf');
      expect(attached[0].size).toBe(9);
      expect(fetch).not.toHaveBeenCalled();
      expect(document.querySelectorAll('input')[2].files).toHaveLength(0);
    } finally { Object.defineProperty(HTMLInputElement.prototype, 'files', setter); }
  });
});
