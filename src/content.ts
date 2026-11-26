import type { DetectedField } from './fields';
import type { ApplicationScan } from './applicationPage';

function inferContentPageContext(hostname: string, title: string, heading = '') {
  const host = hostname.toLowerCase();
  const greenhouse = host === 'boards.greenhouse.io'
    || host.endsWith('.boards.greenhouse.io')
    || host === 'job-boards.greenhouse.io'
    || host.endsWith('.job-boards.greenhouse.io');
  const cleanTitle = title.trim().replace(/\s*[|–—-]\s*greenhouse\s*$/i, '');
  const jobTitle = cleanTitle.match(/^(?:job application|application|apply)(?: for)?\s+(.+?)\s+at\s+(.+)$/i);

  return {
    platform: greenhouse ? 'greenhouse' as const : 'standard' as const,
    company: greenhouse ? jobTitle?.[2]?.trim() ?? '' : '',
    role: jobTitle?.[1]?.trim() || heading.trim() || cleanTitle,
  };
}

function cleanLabelText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

const questionContainer = '.ashby-application-form-field-entry, [data-field-path]';

function questionTitle(element: HTMLElement) {
  return cleanLabelText(element.closest(questionContainer)?.querySelector('.ashby-application-form-question-title, label')?.textContent);
}

function optionLabel(element: HTMLInputElement) {
  return cleanLabelText(element.labels?.[0]?.textContent) || element.value;
}

function descriptionFor(element: HTMLElement) {
  const ids = element.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
  const explicit = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
  return cleanLabelText(explicit || element.closest(questionContainer)?.querySelector('.ashby-application-form-question-description')?.textContent);
}

// A bare "Yes" is the option, not the question, so it must never become the field label.
const bareOption = /^(yes|no|true|false|male|female|other|none|decline( to (self )?identify)?|i don'?t wish to answer|prefer not to say)$/i;

function groupLabel(element: HTMLElement) {
  if (element instanceof HTMLInputElement && element.name === 'communicationConsent') {
    return cleanLabelText(element.closest(questionContainer)?.querySelector('.ashby-application-form-texting-consent-description [role="textbox"]')?.textContent) || 'Text message consent';
  }
  const group = element.closest('fieldset, [role="radiogroup"], [role="group"]');
  if (!group) return '';
  const labelledBy = group.getAttribute('aria-labelledby')?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent).join(' ') ?? '';
  return cleanLabelText(group.querySelector('legend')?.textContent)
    || cleanLabelText(group.getAttribute('aria-label'))
    || cleanLabelText(labelledBy);
}

// Portals repeat a question in several places and end with an internal id. The applicant
// reads the first piece of human text, so that is what the panel shows and matching uses.
function labelFor(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const options = [
    element instanceof HTMLInputElement && element.type === 'radio' ? groupLabel(element) : '',
    element instanceof HTMLInputElement && element.type === 'radio' ? questionTitle(element) : '',
    ...(element.labels ? [...element.labels].map((label) => label.textContent) : []),
    groupLabel(element),
    ...(element.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '') ?? []),
    element.getAttribute('aria-label') ?? '',
    questionTitle(element),
    element.getAttribute('placeholder') ?? '',
    (element.name ?? '').replace(/^_+/, '').replace(/_/g, ' '),
    element.id.replace(/^_+/, '').replace(/_/g, ' '),
  ].map(cleanLabelText).filter(Boolean);
  return options.find((text) => !bareOption.test(text)) ?? options[0] ?? '';
}

const MONTH_NUMBERS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const stateCodeByName: Record<string, string> = Object.fromEntries(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]));

function normalizeOption(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stableFieldId(label: string, identity: string, occurrence: number) {
  let hash = 2166136261;
  for (const char of `${label}|${identity}|${occurrence}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `applyai-${(hash >>> 0).toString(36)}`;
}

function monthValue(value: string) {
  const clean = value.trim();
  if (/^\d{4}-\d{2}$/.test(clean)) return clean;
  const monthYear = clean.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (monthYear) {
    const month = MONTH_NUMBERS[monthYear[1].slice(0, 3).toLowerCase()];
    if (month) return `${monthYear[2]}-${month}`;
  }
  const numeric = clean.match(/^(\d{1,2})\s*[/-]\s*(\d{4})$/);
  if (numeric) {
    const month = Number(numeric[1]);
    if (month >= 1 && month <= 12) return `${numeric[2]}-${String(month).padStart(2, '0')}`;
  }
  return undefined;
}

function dateValue(value: string) {
  const clean = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const month = monthValue(clean);
  return month ? `${month}-01` : undefined;
}

function optionEquivalents(value: string) {
  const raw = value.trim();
  const equivalents = new Set([normalizeOption(raw)]);
  const stateName = US_STATES[raw.toUpperCase()];
  if (stateName) equivalents.add(normalizeOption(stateName));
  const stateCode = stateCodeByName[raw.toLowerCase()];
  if (stateCode) equivalents.add(normalizeOption(stateCode));
  if (/^(us|usa|u s|united states|united states of america)$/i.test(raw)) ['us', 'usa', 'unitedstates', 'unitedstatesofamerica'].forEach((item) => equivalents.add(item));
  if (/^(uk|u k|united kingdom|great britain)$/i.test(raw)) ['uk', 'unitedkingdom', 'greatbritain'].forEach((item) => equivalents.add(item));
  return equivalents;
}

function findOption(options: HTMLOptionElement[], value: string) {
  const equivalents = optionEquivalents(value);
  return options.find((option) => equivalents.has(normalizeOption(option.text)) || equivalents.has(normalizeOption(option.value)));
}

function visibleControl(element: HTMLElement) {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function activateControl(element: HTMLElement) {
  const pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  element.dispatchEvent(new pointer('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
  if (element.isConnected) element.focus({ preventScroll: true });
  element.dispatchEvent(new pointer('pointerup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
  element.click();
}

function controlOptions(element: HTMLElement): HTMLElement[] {
  const selector = '[role="option"], [role="menuitemradio"], [role="menuitem"], [data-option], [class*="_option_"]';
  const collect = (scope: ParentNode) => [...scope.querySelectorAll<HTMLElement>(selector)].filter((option) => option.getAttribute('aria-disabled') !== 'true' && !option.matches(':disabled') && visibleControl(option));
  // React/portal menus may attach aria-controls only after opening. Re-read it
  // on every poll, and follow every referenced popup instead of a stale ID.
  const ids = `${element.getAttribute('aria-controls') ?? ''} ${element.getAttribute('aria-owns') ?? ''}`.trim().split(/\s+/).filter(Boolean);
  const linked = ids.flatMap((id) => { const scope = document.getElementById(id); return scope ? collect(scope) : []; });
  if (linked.length) return linked;
  const local = element.closest(questionContainer);
  const inside = local ? collect(local) : [];
  if (inside.length) return inside;
  const options = collect(document);
  const groups = new Set(options.map((option) => option.closest('[role="listbox"], [role="menu"]') ?? option.parentElement));
  // Only one visible unowned menu can safely belong to the active control.
  return groups.size === 1 ? options : [];
}

function scanFields(): DetectedField[] {
  const elements = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')]
    .filter((element) => {
      const label = labelFor(element).toLowerCase();
      return !element.disabled && !element.closest('[hidden], [aria-hidden="true"]') && element.type !== 'hidden' && element.type !== 'submit' && element.type !== 'button' && element.type !== 'reset'
        && !element.closest('.ashby-application-form-autofill-input-root, .ashby-application-form-input-yesno, .grecaptcha-badge')
        && !/\b(search|newsletter|job alert|subscribe)\b/.test(label);
    });
  const radioGroups = new Map<string, HTMLInputElement[]>();
  for (const element of elements) {
    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
      radioGroups.set(element.name, [...(radioGroups.get(element.name) ?? []), element]);
    }
  }
  const handledGroups = new Set<string>();
  const fields: DetectedField[] = [];
  for (const element of elements) {
    const groupKey = element instanceof HTMLInputElement && element.type === 'radio' && element.name ? element.name : '';
    if (groupKey && handledGroups.has(groupKey)) continue;
    const label = labelFor(element);
    const occurrence = fields.filter((field) => field.label === label).length;
    const id = stableFieldId(label, element.id || element.name || element.type, occurrence);
    const members = groupKey ? radioGroups.get(groupKey) ?? [element] : [element];
    members.forEach((member) => member.setAttribute('data-applyai-field', id));
    if (groupKey) handledGroups.add(groupKey);
    const options = element instanceof HTMLSelectElement
      ? [...element.options].filter((option) => option.value).map((option) => option.text.trim())
      : groupKey ? members.map((member) => optionLabel(member as HTMLInputElement)).filter(Boolean) : [];
    fields.push({
      id,
      label,
      description: descriptionFor(element),
      type: groupKey ? 'radio' : element instanceof HTMLInputElement ? element.type : element instanceof HTMLSelectElement ? element.multiple ? 'select-multiple' : 'select' : 'textarea',
      required: members.some((member) => member.required || member.getAttribute('aria-required') === 'true') || Boolean(element.closest(questionContainer)?.querySelector('.ashby-application-form-question-title[class*="_required_"]')),
      options: options.length ? options : JSON.parse(element.getAttribute('data-applyai-options') || '[]'),
      section: cleanLabelText(element.closest('fieldset, section')?.querySelector('legend, h2, h3')?.textContent),
      currentValue: element instanceof HTMLInputElement && element.type === 'radio' ? (members.find((member) => (member as HTMLInputElement).checked) ? optionLabel(members.find((member) => (member as HTMLInputElement).checked) as HTMLInputElement) : '') : element instanceof HTMLSelectElement ? element.selectedOptions[0]?.value ? element.selectedOptions[0].text : '' : element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked ? 'true' : '' : element.value,
      maxLength: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.maxLength >= 0 ? element.maxLength : undefined : undefined,
      min: element.getAttribute('min') || undefined,
      max: element.getAttribute('max') || undefined,
      pattern: element.getAttribute('pattern') || undefined,
      selector: `[data-applyai-field="${id}"]`,
    });
  }
  for (const element of document.querySelectorAll<HTMLElement>('[role="combobox"]:not(input):not(select):not(textarea), button[aria-haspopup="listbox"]')) {
    if (element.matches(':disabled, [aria-disabled="true"]') || element.closest('[hidden], [aria-hidden="true"]') || (element instanceof HTMLButtonElement && element.form && element.type !== 'button')) continue;
    const label = questionTitle(element) || cleanLabelText(element.getAttribute('aria-label')) || cleanLabelText(element.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(' '));
    if (!label) continue;
    const id = stableFieldId(label, element.id || 'combobox', fields.filter((field) => field.label === label).length);
    element.setAttribute('data-applyai-field', id);
    fields.push({ id, label, type: 'select', required: element.getAttribute('aria-required') === 'true', description: descriptionFor(element), options: JSON.parse(element.getAttribute('data-applyai-options') || '[]'), selector: `[data-applyai-field="${id}"]`, currentValue: element.getAttribute('data-applyai-current') || '' });
  }
  return [...fields, ...scanChoiceGroups(fields.length)];
}

// Ashby uses buttons backed by a checkbox. Other sites expose explicit radio groups.
// Restrict scanning to those containers and exclude any button that could submit a form.
function scanChoiceGroups(startIndex: number): DetectedField[] {
  const groups = [...document.querySelectorAll<HTMLElement>('.ashby-application-form-input-yesno, form [role="radiogroup"], form fieldset:not(:has([role="radiogroup"]))')];
  const fields: DetectedField[] = [];
  for (const group of groups) {
    if (!group.matches('.ashby-application-form-input-yesno') && group.querySelector('input, textarea, select')) continue;
    const buttons = [...group.querySelectorAll<HTMLElement>('button, [role="radio"]')]
      .filter((button) => {
        if (button instanceof HTMLButtonElement && (button.disabled || (button.form && button.type !== 'button'))) return false;
        const text = cleanLabelText(button.textContent);
        return text.length > 0 && text.length <= 1000;
      });
    if (buttons.length < 2 || buttons.length > 200) continue;
    const label = questionTitle(group) || cleanLabelText(group.getAttribute('aria-label'))
      || cleanLabelText(group.querySelector('legend')?.textContent)
      || cleanLabelText(group.previousElementSibling?.textContent)
      || cleanLabelText(group.parentElement?.querySelector('label, legend, h3, p')?.textContent);
    if (!label) continue;
    const id = stableFieldId(label, 'choice', fields.filter((field) => field.label === label).length);
    buttons.forEach((button) => button.setAttribute('data-applyai-field', id));
    fields.push({
      id,
      label,
      description: descriptionFor(group),
      type: 'choice',
      required: group.getAttribute('aria-required') === 'true' || Boolean(group.closest(questionContainer)?.querySelector('[class*="_required_"]')),
      options: buttons.map((button) => cleanLabelText(button.textContent)),
      currentValue: cleanLabelText(buttons.find((button) => button.getAttribute('aria-pressed') === 'true' || button.getAttribute('aria-checked') === 'true')?.textContent),
      selector: `[data-applyai-field="${id}"]`,
    });
  }
  return fields;
}

function applicationFrameOrigins(): string[] {
  const knownAtsHost = /(^|\.)(greenhouse\.io|ashbyhq\.com|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|jobvite\.com|icims\.com|bamboohr\.com|workable\.com)$/i;
  const applicationHint = /greenhouse|ashby|lever|workday|smartrecruiters|jobvite|icims|bamboohr|workable|job.?application|application.?form|apply.?form/i;
  return [...new Set([...document.querySelectorAll<HTMLIFrameElement>('iframe[src]')].flatMap((frame) => {
    try {
      const url = new URL(frame.getAttribute('src') ?? '', location.href);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin === location.origin) return [];
      const hint = [frame.id, frame.name, frame.title, url.hostname, url.pathname].join(' ');
      return knownAtsHost.test(url.hostname) || applicationHint.test(hint) ? [url.origin] : [];
    } catch { return []; }
  }))];
}

async function scoutCustomOptions() {
  for (const element of document.querySelectorAll<HTMLElement>('[role="combobox"], [aria-autocomplete], button[aria-haspopup="listbox"]')) {
    if (element.matches(':disabled, [aria-disabled="true"]') || element.closest('[hidden], [aria-hidden="true"]') || (element instanceof HTMLButtonElement && element.form && element.type !== 'button')) continue;
    const wasOpen = element.getAttribute('aria-expanded') === 'true';
    if (!wasOpen) {
      element.focus();
      activateControl(element);
      if (element.getAttribute('aria-expanded') !== 'true') element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    }
    let options: HTMLElement[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      options = controlOptions(element);
      if (options.length) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    element.setAttribute('data-applyai-options', JSON.stringify(options.map((option) => cleanLabelText(option.textContent)).filter(Boolean)));
    element.setAttribute('data-applyai-current', cleanLabelText(options.find((option) => option.getAttribute('aria-selected') === 'true')?.textContent));
    if (!wasOpen) {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (element.getAttribute('aria-expanded') === 'true') activateControl(element);
      element.blur();
    }
  }
}

function jobContext() {
  let description = document.querySelector('.ashby-job-posting-description, #content .content, [data-job-description], .posting-description, [itemprop="description"]')?.textContent?.trim() ?? '';
  let company = '';
  let role = '';
  const queue: unknown[] = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((script) => { try { return [JSON.parse(script.textContent ?? '')]; } catch { return []; } });
  while (queue.length) {
    const item = queue.shift();
    if (Array.isArray(item)) { queue.push(...item); continue; }
    if (!item || typeof item !== 'object') continue;
    const object = item as Record<string, unknown>;
    if ([object['@type']].flat().includes('JobPosting')) {
      if (!description && typeof object.description === 'string') description = new DOMParser().parseFromString(object.description, 'text/html').body.textContent?.trim() ?? '';
      role = typeof object.title === 'string' ? object.title : '';
      const organization = object.hiringOrganization as { name?: string } | undefined;
      company = typeof organization?.name === 'string' ? organization.name : '';
      break;
    }
    if (object['@graph']) queue.push(object['@graph']);
  }
  const jobLink = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find((link) => /^(?:view|back to|read|see) (?:the )?(?:job|position)(?: description| posting| details)?$/i.test(cleanLabelText(link.textContent)) && new URL(link.href, location.href).origin === location.origin);
  const jobUrl = jobLink?.href || (location.hostname === 'jobs.ashbyhq.com' && /\/application\/?$/.test(location.pathname) ? `${location.origin}${location.pathname.replace(/\/application\/?$/, '')}` : undefined);
  return { description, company, role, jobUrl };
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(setter, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

// Custom dropdowns keep their truth in a listbox, not in the input's value: typing a location
// leaves the field unset until an option is actually chosen.
async function pickListOption(element: HTMLElement, value: string) {
  const isCombobox = /\bcombobox\b/i.test(element.getAttribute('role') ?? '') || element.hasAttribute('aria-autocomplete') || element.getAttribute('aria-haspopup') === 'listbox';
  if (!isCombobox) return false;
  const wanted = optionEquivalents(value);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const options = controlOptions(element);
    // Geographic suggestions may spell out a state or country. Accept only a unique
    // match for all saved components, never the first city with the same name.
    const parts = value.split(',').map((part) => optionEquivalents(part));
    const locations = options.filter((item) => {
      const offered = (item.textContent ?? '').split(',').map((part) => normalizeOption(part));
      return offered.length >= parts.length && parts.every((part, index) => part.has(offered[index]));
    });
    const option = options.find((item) => wanted.has(normalizeOption(item.textContent ?? '')))
      ?? (locations.length === 1 ? locations[0] : undefined);
    if (option) {
      const offered = cleanLabelText(option.textContent);
      activateControl(option);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const selected = option.getAttribute('aria-selected') === 'true';
      const displayed = element instanceof HTMLInputElement ? element.value : cleanLabelText(element.textContent);
      const closed = element.getAttribute('aria-expanded') === 'false' || !option.isConnected;
      return selected || (closed && (wanted.has(normalizeOption(displayed)) || normalizeOption(displayed) === normalizeOption(offered)));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function attachResume(element: HTMLInputElement, data: string, name: string) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], name, { type: 'application/pdf' }));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set?.call(element, transfer.files);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return element.files?.[0]?.name === name;
}

async function fillFields(values: Record<string, string>, resume?: { fieldId: string; data: string; name: string }) {
  let filled = 0;
  const failed: string[] = [];
  const checks = new Map<string, () => boolean>();
  for (const [id, value] of Object.entries(values)) {
    const before = filled;
    try {
      const elements = [...document.querySelectorAll<HTMLElement>(`[data-applyai-field="${CSS.escape(id)}"]`)];
      const first = elements[0];
      if (!first || !value || first.matches(':disabled, [aria-disabled="true"]')) continue;
      if (first.matches('button, [role="radio"]') && first.getAttribute('role') !== 'combobox' && first.getAttribute('aria-haspopup') !== 'listbox') {
        const wanted = optionEquivalents(value);
        const choice = elements.find((element) => wanted.has(normalizeOption(element.textContent ?? '')));
        if (!choice || (choice instanceof HTMLButtonElement && choice.form && choice.type !== 'button')) continue;
        activateControl(choice);
        checks.set(id, () => choice.isConnected && (choice.getAttribute('aria-pressed') === 'true' || choice.getAttribute('aria-checked') === 'true'));
        filled += 1;
        continue;
      }
      if (first instanceof HTMLInputElement && first.type === 'radio') {
        const wanted = optionEquivalents(value);
        const selected = elements.find((element) => element instanceof HTMLInputElement && element.type === 'radio' && (wanted.has(normalizeOption(element.value)) || wanted.has(normalizeOption(optionLabel(element)))));
        if (!(selected instanceof HTMLInputElement)) continue;
        selected.click();
        if (!selected.checked) continue;
        checks.set(id, () => selected.isConnected && selected.checked && selected.getAttribute('aria-invalid') !== 'true');
        filled += 1;
        continue;
      }
      if (first instanceof HTMLInputElement && first.type === 'checkbox') {
        if (!['true', 'false'].includes(value)) continue;
        if (first.checked !== (value === 'true')) first.click();
        checks.set(id, () => first.isConnected && first.checked === (value === 'true') && first.checkValidity());
        filled += 1;
        continue;
      }
      if (first instanceof HTMLSelectElement && first.multiple) continue;
      if (first instanceof HTMLInputElement && ['file', 'password'].includes(first.type)) continue;
      if (first instanceof HTMLInputElement && first.type === 'number' && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) continue;
      let expected = value;
      if (first instanceof HTMLSelectElement) {
        const option = findOption([...first.options].filter((item) => item.value), value);
        if (!option) continue;
        setValue(first, option.value);
        expected = option.value;
      } else if (first instanceof HTMLInputElement && first.type === 'date') {
        const date = dateValue(value);
        if (!date) continue;
        setValue(first, date);
        expected = date;
      } else if (first instanceof HTMLInputElement && first.type === 'month') {
        const month = monthValue(value);
        if (!month) continue;
        setValue(first, month);
        expected = month;
      } else if (first instanceof HTMLInputElement && first.type === 'url' && !/^https?:\/\//i.test(value)) {
        continue;
      } else if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement || first instanceof HTMLSelectElement) {
        first.focus();
        setValue(first, value);
        if (first.getAttribute('role') === 'combobox' || first.hasAttribute('aria-autocomplete')) {
          if (!await pickListOption(first, value)) continue;
          expected = first.value;
        }
      } else if (first.getAttribute('role') === 'combobox' || first.getAttribute('aria-haspopup') === 'listbox') {
        activateControl(first);
        if (!await pickListOption(first, value)) continue;
        checks.set(id, () => first.isConnected && first.getAttribute('aria-invalid') !== 'true' && (first.getAttribute('aria-expanded') === 'false' || cleanLabelText(first.textContent) === value));
        filled += 1;
        continue;
      } else {
        continue;
      }
      if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement || first instanceof HTMLSelectElement) {
        // Read again after all handlers have run, including asynchronous resets.
        const control = first;
        checks.set(id, () => control.isConnected && control.value === expected && control.getAttribute('aria-invalid') !== 'true' && control.checkValidity());
      }
      filled += 1;
    } catch {
      // Keep other answers available when one widget rejects a value.
    } finally {
      if (filled === before) failed.push(id);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  for (const [id, verify] of checks) {
    if (!verify() && !failed.includes(id)) { filled -= 1; failed.push(id); }
  }
  if (resume) {
    try {
      const field = document.querySelector<HTMLInputElement>(`[data-applyai-field="${CSS.escape(resume.fieldId)}"]`);
      if (field?.type === 'file' && await attachResume(field, resume.data, resume.name)) filled += 1;
      else failed.push(resume.fieldId);
    } catch { failed.push(resume.fieldId); }
  }
  return { filled, failed, outcomes: Object.fromEntries(Object.keys(values).map((id) => [id, failed.includes(id) ? 'failed' : 'verified'])) };
}

const contentWorld = globalThis as typeof globalThis & { __applyAiPageListenerInstalled?: boolean };
if (!contentWorld.__applyAiPageListenerInstalled) {
  contentWorld.__applyAiPageListenerInstalled = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'APPLYAI_SCAN_FIELDS') {
      const title = document.title;
      void scoutCustomOptions().then(() => {
      const context = inferContentPageContext(location.hostname, title, document.querySelector('h1')?.textContent ?? '');
      const job = jobContext();
      sendResponse({
        fields: scanFields(),
        title,
        url: location.href,
        applicationFrameOrigins: applicationFrameOrigins(),
        ...context,
        ...job,
        company: job.company || context.company,
        role: job.role || context.role,
      } satisfies ApplicationScan);
      }).catch(() => sendResponse({ fields: [], title, url: location.href, ...inferContentPageContext(location.hostname, title) } satisfies ApplicationScan));
    }
    if (message?.type === 'APPLYAI_FILL_FIELDS') {
      fillFields(message.values ?? {}, message.resume).then(sendResponse).catch(() => sendResponse({ filled: 0, failed: Object.keys(message.values ?? {}) }));
    }
    return true;
  });
}
