import type { ProfileField, ResumeProfile } from './profile';
import { profileFieldValue } from './profile';
import rules from '../shared/field-rules.json';

export interface DetectedField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  selector: string;
  frameId?: number;
  frameFieldId?: string;
  description?: string;
}

type MatchKey = ProfileField | 'firstName' | 'lastName';

interface ProfileRule {
  pattern: string;
  key: string;
  guard?: string;
}

// Label rules live in shared/field-rules.json so the Python service resolves profile facts
// from the same table instead of a drifting copy. Order is match priority, and a guard
// stops a broad row from swallowing a narrower one the way a plain table would.
const guards: Record<string, RegExp> = Object.fromEntries(
  Object.entries(rules.guards).map(([name, source]) => [name, new RegExp(source)]),
);

const matches: [RegExp, MatchKey, RegExp?][] = (rules.profileMatches as ProfileRule[]).map((rule) => [
  new RegExp(rule.pattern),
  rule.key as MatchKey,
  rule.guard ? guards[rule.guard] : undefined,
]);

const sensitivePattern = new RegExp(rules.sensitivePattern, 'i');
const coverLetterPattern = new RegExp(rules.coverLetterPattern, 'i');

// Portal labels arrive with casing and punctuation noise; padding with spaces lets the
// pattern tables rely on \b instead of guessing at word edges.
export function normalizeLabel(label: string): string {
  return ` ${label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

export function findProfileValue(label: string, profile: ResumeProfile): string | undefined {
  const normalized = normalizeLabel(label);
  const match = matches.find(([pattern, , guard]) => pattern.test(normalized) && !guard?.test(normalized));
  if (!match) return undefined;
  const key = match[1];
  const nameParts = profile.fullName.split(/\s+/).filter(Boolean);
  let value: string | string[];
  if (key === 'firstName') value = nameParts[0] ?? '';
  else if (key === 'lastName') value = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  else if (key === 'city' && /\blocation\b/.test(normalized) && profile.city.trim()) value = [profile.city, profile.state, profile.country].filter(Boolean).join(', ');
  else value = profileFieldValue(profile, key);
  let text = Array.isArray(value) ? value.join(', ') : value;
  if ((key === 'linkedin' || key === 'portfolio') && text.trim() && !/^https?:\/\//i.test(text)) text = `https://${text}`;
  return text.trim() ? text : undefined;
}

export function isSensitiveField(label: string): boolean {
  return sensitivePattern.test(label);
}

export function isCoverLetterField(label: string): boolean {
  return coverLetterPattern.test(label);
}
