import type { DetectedField } from './fields';
import { inferApplicationContext, type ApplicationScan } from './applicationPage';

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

function scanFields(): DetectedField[] {
  const elements = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')]
    .filter((element) => !element.disabled && element.type !== 'hidden' && element.type !== 'submit' && element.type !== 'button' && element.type !== 'reset');
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
    if (first instanceof HTMLInputElement && ['file', 'password', 'number'].includes(first.type)) continue;
    if (first instanceof HTMLSelectElement) {
      const option = [...first.options].find((item) => item.text.trim().toLowerCase() === value.trim().toLowerCase() || item.value.toLowerCase() === value.trim().toLowerCase());
      if (!option) continue;
      setValue(first, option.value);
    } else if (first instanceof HTMLInputElement && first.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      setValue(first, value);
    } else if (first instanceof HTMLInputElement && first.type === 'url' && !/^https?:\/\//i.test(value)) {
      continue;
    } else {
      setValue(first, value);
    }
    filled += 1;
  }
  return filled;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'APPLYAI_SCAN_FIELDS') {
    const title = document.title;
    sendResponse({
      fields: scanFields(),
      title,
      url: location.href,
      ...inferApplicationContext(location.hostname, title, document.querySelector('h1')?.textContent ?? ''),
    } satisfies ApplicationScan);
  }
  if (message?.type === 'APPLYAI_FILL_FIELDS') {
    sendResponse({ filled: fillFields(message.values ?? {}) });
  }
  return true;
});
