export interface DetectedField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  selector: string;
}

export function findProfileValue(label: string, profile: import('./profile').ResumeProfile): string | undefined {
  const normalized = label.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const matches: [RegExp, keyof import('./profile').ResumeProfile][] = [
    [/\b(first|given) name\b/, 'fullName'],
    [/\b(last|family|sur) ?name\b/, 'fullName'],
    [/\b(full|preferred)? ?name\b/, 'fullName'],
    [/\b(email|e mail)\b/, 'email'],
    [/\b(phone|mobile|telephone)\b/, 'phone'],
    [/\blinkedin\b/, 'linkedin'],
    [/\b(portfolio|personal website|website|github)\b/, 'portfolio'],
    [/\b(university|college|school|institution)\b/, 'university'],
    [/\b(graduation|degree completion|graduated)\b/, 'graduationDate'],
    [/\b(target role|desired role|role you are seeking|position sought)\b/, 'targetRole'],
    [/\b(skills?|technologies?|programming languages?)\b/, 'skills'],
    [/\b(work experience|employment|professional experience)\b/, 'workExperience'],
    [/\bprojects?\b/, 'projects'],
    [/\b(achievements?|awards?|honors?)\b/, 'achievements'],
  ];
  const match = matches.find(([pattern]) => pattern.test(normalized));
  if (!match) return undefined;
  let value = profile[match[1]];
  if (match[1] === 'fullName' && /\b(first|given) name\b/.test(normalized)) value = profile.fullName.split(/\s+/)[0] ?? '';
  if (match[1] === 'fullName' && /\b(last|family|sur) ?name\b/.test(normalized)) value = profile.fullName.split(/\s+/).at(-1) ?? '';
  if (Array.isArray(value)) value = value.join(', ');
  if (typeof value === 'string' && ['linkedin', 'portfolio'].includes(match[1]) && value.trim() && !/^https?:\/\//i.test(value)) value = `https://${value}`;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function isSensitiveField(label: string): boolean {
  return /salary|compensation|sponsorship|visa|work authorization|authorized to work|criminal|disability|gender|race|ethnicity/i.test(label);
}

