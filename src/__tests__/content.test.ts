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
  it('identifies embedded Paycor forms without requesting unrelated frame origins', async () => {
    document.body.innerHTML = '<iframe id="gnewtonIframe" title="open positions" src="https://recruitingbypaycor.com/career/SubmitResume.action?id=fixture"></iframe><iframe src="https://unrelated.example.test/widget"></iframe>';
    expect((await scan()).applicationFrameOrigins).toEqual(['https://recruitingbypaycor.com']);
  });

  it('rejects ambiguous submit buttons, non-final steps and multiple forms', async () => {
    document.body.innerHTML = '<form><label>Name<input value="Riley"></label><button>Next</button></form>';
    const clicked = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('button')!.addEventListener('click', clicked);
    expect(await send({ type: 'APPLYAI_SUBMIT_APPLICATION', fields: (await scan()).fields })).toMatchObject({ requested: false, error: expect.stringContaining('final submit button') });
    expect(clicked).not.toHaveBeenCalled();
    document.querySelector('button')!.textContent = 'Submit';
    document.querySelector('form')!.insertAdjacentHTML('beforeend', '<button>Submit application</button>');
    expect(await send({ type: 'APPLYAI_SUBMIT_APPLICATION', fields: (await scan()).fields })).toMatchObject({ requested: false, error: expect.stringContaining('one final') });
    document.body.insertAdjacentHTML('beforeend', '<form><label>Phone<input></label></form>');
    expect(await send({ type: 'APPLYAI_SUBMIT_APPLICATION', fields: (await scan()).fields })).toMatchObject({ requested: false, error: expect.stringContaining('one application form') });
    expect(clicked).not.toHaveBeenCalled();
  });

  it('submits only after an explicit request with a current valid snapshot', async () => {
    document.body.innerHTML = '<form><label>Email<input type="email" required></label><button type="submit">Submit application</button></form>';
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', submitted);
    const empty = await scan();
    expect(await send({ type: 'APPLYAI_SUBMIT_APPLICATION', fields: empty.fields })).toMatchObject({ requested: false, error: expect.stringContaining('invalid') });
    expect(await fill({ [empty.fields[0].id]: 'riley@example.test' })).toMatchObject({ filled: 1 });
    expect(submitted).not.toHaveBeenCalled();
    expect(await send({ type: 'APPLYAI_SUBMIT_APPLICATION', fields: empty.fields })).toMatchObject({ requested: false, error: expect.stringContaining('changed') });
    const filled = await scan();
    expect(await send({ type: 'APPLYAI_SUBMIT_APPLICATION', fields: filled.fields })).toEqual({ requested: true });
    expect(submitted).toHaveBeenCalledOnce();
  });

  it('reads external labels on custom radios with hidden backing inputs', async () => {
    document.body.innerHTML = '<div role="radiogroup" aria-label="Gender"><button type="button" role="radio" id="man" data-state="unchecked"></button><label for="man">Man</label><input type="hidden"><button type="button" role="radio" id="woman" data-state="unchecked"></button><label for="woman">Woman</label><input type="hidden"></div>';
    document.getElementById('man')!.addEventListener('mousedown', (event) => { (event.currentTarget as HTMLElement).setAttribute('data-state', 'checked'); });
    const { fields } = await scan();
    expect(fields).toHaveLength(1);
    expect(fields[0].options).toEqual(['Man', 'Woman']);
    expect(await fill({ [fields[0].id]: 'Man' })).toMatchObject({ filled: 1, failed: [] });
  });

  it('discovers a delayed portal menu even when an aria-controls ID is initially missing', async () => {
    document.body.innerHTML = '<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title">Gender</label><button type="button" role="combobox" aria-expanded="false">Choose</button></div>';
    const combo = document.querySelector('button')!;
    combo.addEventListener('mousedown', () => {
      if (combo.getAttribute('aria-expanded') === 'true') { document.getElementById('portal')?.remove(); combo.setAttribute('aria-expanded', 'false'); return; }
      setTimeout(() => {
        combo.setAttribute('aria-expanded', 'true'); combo.setAttribute('aria-controls', 'portal');
        const menu = document.createElement('div'); menu.id = 'portal'; menu.setAttribute('role', 'listbox'); menu.innerHTML = '<div role="option">Man</div><div role="option">Woman</div>'; document.body.append(menu);
        menu.querySelectorAll<HTMLElement>('[role="option"]').forEach((option) => option.addEventListener('mousedown', () => { combo.textContent = option.textContent; combo.setAttribute('aria-expanded', 'false'); menu.remove(); }));
      }, 20);
    });
    const { fields } = await scan();
    expect(fields[0].options).toEqual(['Man', 'Woman']);
    expect(await fill({ [fields[0].id]: 'Man' })).toMatchObject({ filled: 1, failed: [] });
    expect(combo.textContent).toBe('Man');
  });
  it('captures full job descriptions and stable identities without entering answers', async () => {
    const description = 'Responsibility '.repeat(900) + 'FINAL QUALIFICATION';
    document.body.innerHTML = `<div data-job-description>${description}</div><label for="email">Email</label><input id="email" type="email" required maxlength="80">`;
    const first = await scan();
    expect(first.description).toBe(description);
    expect(first.fields[0]).toMatchObject({ maxLength: 80, required: true, currentValue: '' });
    const added = document.createElement('label'); added.innerHTML = 'Phone<input type="tel">';
    document.body.prepend(added);
    const second = await scan();
    expect(second.fields.find((field: any) => field.label === 'Email').id).toBe(first.fields[0].id);
    expect(document.querySelector<HTMLInputElement>('#email')!.value).toBe('');
  });

  it('scouts and fills a custom button dropdown through its offered options', async () => {
    document.body.innerHTML = `<form><div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title">Gender</label><button type="button" role="combobox" aria-controls="gender-options" aria-expanded="false" aria-required="true">Choose</button><div id="gender-options"></div></div><button type="submit">Submit</button></form>`;
    const combo = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    const list = document.getElementById('gender-options')!;
    const submit = vi.fn(); document.querySelector('[type="submit"]')!.addEventListener('click', submit);
    combo.addEventListener('click', () => {
      const open = combo.getAttribute('aria-expanded') !== 'true';
      combo.setAttribute('aria-expanded', String(open));
      list.innerHTML = open ? '<div role="option">Man</div><div role="option">Woman</div>' : '';
      list.querySelectorAll<HTMLElement>('[role="option"]').forEach((option) => option.addEventListener('click', () => { combo.textContent = option.textContent; combo.setAttribute('aria-expanded', 'false'); list.innerHTML = ''; }));
    });
    const { fields } = await scan();
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ label: 'Gender', type: 'select', required: true, options: ['Man', 'Woman'], currentValue: '' });
    expect(combo.textContent).toBe('Choose');
    expect(await fill({ [fields[0].id]: 'Man' })).toMatchObject({ filled: 1, failed: [], outcomes: { [fields[0].id]: 'verified' } });
    expect(combo.textContent).toBe('Man'); expect(submit).not.toHaveBeenCalled();
  });

  it('reports page handlers that reset values or ignore button selection', async () => {
    document.body.innerHTML = '<label>Name<input></label><form><fieldset><legend>Authorized?</legend><button type="button" aria-pressed="false">Yes</button><button type="button" aria-pressed="false">No</button></fieldset></form>';
    document.querySelector('input')!.addEventListener('change', (event) => { setTimeout(() => { (event.target as HTMLInputElement).value = ''; }, 20); });
    const { fields } = await scan();
    expect(await fill({ [fields[0].id]: 'Jordan', [fields[1].id]: 'Yes' })).toMatchObject({ filled: 0, failed: [fields[0].id, fields[1].id], outcomes: { [fields[0].id]: 'failed', [fields[1].id]: 'failed' } });
  });

  it('rejects native input values that violate page validation constraints', async () => {
    document.body.innerHTML = '<label>Zip code<input pattern="[0-9]{5}" required></label>';
    const { fields } = await scan();
    expect(fields[0].pattern).toBe('[0-9]{5}');
    expect(await fill({ [fields[0].id]: 'invalid' })).toMatchObject({ filled: 0, failed: [fields[0].id] });
  });
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
