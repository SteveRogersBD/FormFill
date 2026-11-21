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

function labelFor(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const text = [
    ...(element.labels ? [...element.labels].map((label) => label.innerText) : []),
    element.getAttribute('aria-label') ?? '',
    ...(element.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '') ?? []),
    element.getAttribute('placeholder') ?? '',
    element.name,
    element.id,
    element.closest('fieldset')?.querySelector('legend')?.textContent ?? '',
  ].map((value) => value.trim()).filter(Boolean);
  return [...new Set(text)].join(' · ');
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

function scanFields(): DetectedField[] {
  const elements = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')]
    .filter((element) => {
      const label = labelFor(element).toLowerCase();
      return !element.disabled && element.type !== 'hidden' && element.type !== 'submit' && element.type !== 'button' && element.type !== 'reset'
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
    const index = fields.length;
    const id = `applyai-${index}`;
    const members = groupKey ? radioGroups.get(groupKey) ?? [element] : [element];
    members.forEach((member) => member.setAttribute('data-applyai-field', id));
    if (groupKey) handledGroups.add(groupKey);
    const options = element instanceof HTMLSelectElement
      ? [...element.options].filter((option) => option.value).map((option) => option.text.trim())
      : groupKey ? members.map((member) => member.labels?.[0]?.innerText.trim() || member.value).filter(Boolean) : [];
    fields.push({
      id,
      label: labelFor(element),
      type: groupKey ? 'radio' : element instanceof HTMLInputElement ? element.type : element instanceof HTMLSelectElement ? element.multiple ? 'select-multiple' : 'select' : 'textarea',
      required: members.some((member) => member.required || member.getAttribute('aria-required') === 'true'),
      options,
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

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(setter, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillFields(values: Record<string, string>) {
  let filled = 0;
  for (const [id, value] of Object.entries(values)) {
    const elements = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-applyai-field="${CSS.escape(id)}"]`)];
    const first = elements[0];
    if (!first || !value) continue;
    if (first instanceof HTMLInputElement && first.type === 'radio') {
      const selected = elements.find((element) => element instanceof HTMLInputElement && element.type === 'radio' && (element.value.trim().toLowerCase() === value.trim().toLowerCase() || element.labels?.[0]?.innerText.trim().toLowerCase() === value.trim().toLowerCase()));
      if (!(selected instanceof HTMLInputElement)) continue;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set?.call(selected, true);
      selected.dispatchEvent(new Event('input', { bubbles: true }));
      selected.dispatchEvent(new Event('change', { bubbles: true }));
      filled += 1;
      continue;
    }
    if (first instanceof HTMLInputElement && first.type === 'checkbox') {
      if (value !== 'true') continue;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set?.call(first, true);
      first.dispatchEvent(new Event('input', { bubbles: true }));
      first.dispatchEvent(new Event('change', { bubbles: true }));
      filled += 1;
      continue;
    }
    if (first instanceof HTMLSelectElement && first.multiple) continue;
    if (first instanceof HTMLInputElement && ['file', 'password'].includes(first.type)) continue;
    if (first instanceof HTMLInputElement && first.type === 'number' && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) continue;
    if (first instanceof HTMLSelectElement) {
      const option = findOption([...first.options].filter((item) => item.value), value);
      if (!option) continue;
      setValue(first, option.value);
    } else if (first instanceof HTMLInputElement && first.type === 'date') {
      const date = dateValue(value);
      if (!date) continue;
      setValue(first, date);
    } else if (first instanceof HTMLInputElement && first.type === 'month') {
      const month = monthValue(value);
      if (!month) continue;
      setValue(first, month);
    } else if (first instanceof HTMLInputElement && first.type === 'url' && !/^https?:\/\//i.test(value)) {
      continue;
    } else {
      setValue(first, value);
    }
    filled += 1;
  }
  return filled;
}

const contentWorld = globalThis as typeof globalThis & { __applyAiPageListenerInstalled?: boolean };
if (!contentWorld.__applyAiPageListenerInstalled) {
  contentWorld.__applyAiPageListenerInstalled = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'APPLYAI_SCAN_FIELDS') {
      const title = document.title;
      sendResponse({
        fields: scanFields(),
        title,
        url: location.href,
        applicationFrameOrigins: applicationFrameOrigins(),
        ...inferContentPageContext(location.hostname, title, document.querySelector('h1')?.textContent ?? ''),
      } satisfies ApplicationScan);
    }
    if (message?.type === 'APPLYAI_FILL_FIELDS') {
      sendResponse({ filled: fillFields(message.values ?? {}) });
    }
    return true;
  });
}
