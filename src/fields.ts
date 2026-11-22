import type { ProfileField, ResumeProfile } from './profile';

export interface DetectedField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  selector: string;
  frameId?: number;
  frameFieldId?: string;
}

type MatchKey = ProfileField | 'firstName' | 'lastName';

const notAQuestion = /\b(hear about|why|describe|tell us|what interests|how would|additional information|cover letter)\b/;
const notALocationChoice = /\b(relocat|open to|willing|preferred|remote|hybrid|onsite)\b/;
const notAnApplicantName = /\b(company|employer|organi[sz]ation|school|university|college|reference|manager|user|file|account|first|last)\b/;

const matches: [RegExp, MatchKey, RegExp?][] = [
  [/\b(first|given|forename) name\b/, 'firstName'],
  [/\b(last|family|sur) ?name\b/, 'lastName'],
  [/\b(e mail|email)\b/, 'email'],
  [/\b(phone|mobile|telephone|cell)\b/, 'phone'],
  [/\blinkedin\b/, 'linkedin'],
  [/\b(github|gitlab|portfolio|personal website|website|url)\b/, 'portfolio'],
  [/\b(university|college|school|institution)\b/, 'university'],
  [/\b(major|field of study|discipline|concentration)\b/, 'major'],
  [/\b(degree|qualification)\b/, 'degree'],
  [/\b(graduation|graduated|degree completion|completion date)\b/, 'graduationDate'],
  [/\b(company|employer|organi[sz]ation)\b/, 'currentCompany', notAQuestion],
  [/\b(job title|current title|position title|your title)\b/, 'currentTitle'],
  [/\b(target role|desired role|role you are seeking|role are you seeking|position sought|desired position)\b/, 'targetRole'],
  [/\b(skills|technologies|programming languages)\b/, 'skills'],
  [/\b(work experience|employment|professional experience)\b/, 'workExperience'],
  [/\bprojects?\b/, 'projects'],
  [/\b(achievements|awards|honors)\b/, 'achievements'],
  [/\b(city|town|location)\b/, 'city', notALocationChoice],
  [/\b(state|province|region)\b/, 'state'],
  [/\b(zip|postal code|postcode)\b/, 'postalCode'],
  [/\bcountry\b/, 'country'],
  [/\b(full|preferred|legal|your) name\b/, 'fullName'],
  [/\bname\b/, 'fullName', notAnApplicantName],
];

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
  else value = profile[key];
  let text = Array.isArray(value) ? value.join(', ') : value;
  if ((key === 'linkedin' || key === 'portfolio') && text.trim() && !/^https?:\/\//i.test(text)) text = `https://${text}`;
  return text.trim() ? text : undefined;
}

export function isSensitiveField(label: string): boolean {
  return /salary|compensation|sponsorship|visa|work authorization|authorized to work|citizenship|citizen|background check|security clearance|relocat|criminal|disability|medical|health|veteran|military|gender|pronoun|race|ethnicity|sexual orientation|consent|certify|attest|terms and conditions/i.test(label);
}

export function isCoverLetterField(label: string): boolean {
  return /\bcover letter\b|\bletter of (?:interest|motivation)\b|\bstatement of interest\b/i.test(label);
}
