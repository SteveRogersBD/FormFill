import { z } from 'zod';

const experienceMonth = z.string().regex(/^$|^\d{4}-(0[1-9]|1[0-2])$/, 'Use a valid year and month.').default('');

export const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary', 'Freelance', 'Self-employed', 'Volunteer', 'Apprenticeship', 'Seasonal'] as const;

export const workExperienceSchema = z.object({
  id: z.string().min(1).max(100),
  jobTitle: z.string().max(200).default(''),
  company: z.string().max(200).default(''),
  jobType: z.enum(['', ...JOB_TYPES]).default(''),
  location: z.string().max(200).default(''),
  startDate: experienceMonth,
  endDate: experienceMonth,
  current: z.boolean().default(false),
  summary: z.string().max(2000).default(''),
  description: z.array(z.string().max(2000)).max(100).default([]),
}).strict().superRefine((entry, context) => {
  if (!entry.current && entry.startDate && entry.endDate && entry.endDate < entry.startDate) context.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after the start date.' });
  if (entry.current && entry.endDate) context.addIssue({ code: 'custom', path: ['endDate'], message: 'A current role should not have an end date.' });
});

export type WorkExperience = z.infer<typeof workExperienceSchema>;

export function normalizeWorkExperience(value: unknown): unknown {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return value;
  const entries: WorkExperience[] = [];
  for (const [index, raw] of value.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const role = line.length <= 160 && !line.endsWith('.') && line.split(/\s+/).length <= 12
      && !/^(led|built|worked|created|managed|designed|developed|drove|owned|shipped|delivered|launched|partnered|collaborated)\b/i.test(line)
      ? line.match(/^(.+?)\s+at\s+(.+?)(?:\s*[·|]\s*.*)?$/i) : null;
    if (role || !entries.length) entries.push(workExperienceSchema.parse({ id: `imported-${index}`, jobTitle: role?.[1] ?? '', company: role?.[2] ?? '' }));
    if (!role) entries[entries.length - 1].description.push(line);
  }
  return entries;
}

export function formatWorkExperience(entries: WorkExperience[]): string[] {
  return entries.map((entry) => [
    [entry.jobTitle, entry.company].filter(Boolean).join(' at '),
    [entry.jobType, entry.location].filter(Boolean).join(' · '),
    [entry.startDate, entry.current ? 'Present' : entry.endDate].filter(Boolean).join(' – '),
    entry.summary,
    ...entry.description,
  ].filter(Boolean).join('\n')).filter(Boolean);
}

export const resumeProfileSchema = z.object({
  fullName: z.string().max(200).default(''),
  email: z.string().max(320).default(''),
  phone: z.string().max(80).default(''),
  linkedin: z.string().max(500).default(''),
  portfolio: z.string().max(500).default(''),
  streetAddress: z.string().max(300).default(''),
  city: z.string().max(120).default(''),
  state: z.string().max(120).default(''),
  postalCode: z.string().max(40).default(''),
  country: z.string().max(120).default(''),
  university: z.string().max(300).default(''),
  degree: z.string().max(200).default(''),
  major: z.string().max(200).default(''),
  graduationDate: z.string().max(80).default(''),
  gpa: z.string().max(30).default(''),
  currentCompany: z.string().max(200).default(''),
  currentTitle: z.string().max(200).default(''),
  targetRole: z.string().max(200).default(''),
  skills: z.array(z.string().max(200)).max(100).default([]),
  workExperience: z.preprocess(normalizeWorkExperience, z.array(workExperienceSchema).max(100).default([])),
  projects: z.array(z.string().max(2000)).max(100).default([]),
  achievements: z.array(z.string().max(1000)).max(100).default([]),
  resumePath: z.string().max(1000).default(''),
  updatedAt: z.number().optional(),
}).strict();

export type ResumeProfile = z.infer<typeof resumeProfileSchema>;
export type ProfileField = Exclude<keyof ResumeProfile, 'resumePath' | 'updatedAt'>;

export const PROFILE_FIELDS: { key: ProfileField; label: string; multiline?: boolean; list?: boolean }[] = [
  { key: 'fullName', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'streetAddress', label: 'Street address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State / region' },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'country', label: 'Country' },
  { key: 'linkedin', label: 'LinkedIn URL' },
  { key: 'portfolio', label: 'Portfolio URL' },
  { key: 'university', label: 'University' },
  { key: 'degree', label: 'Degree' },
  { key: 'major', label: 'Major / field of study' },
  { key: 'graduationDate', label: 'Graduation date' },
  { key: 'gpa', label: 'GPA' },
  { key: 'currentCompany', label: 'Current company' },
  { key: 'currentTitle', label: 'Current job title' },
  { key: 'targetRole', label: 'Role you’re looking for' },
  { key: 'skills', label: 'Skills', list: true, multiline: true },
  { key: 'workExperience', label: 'Work experience', list: true, multiline: true },
  { key: 'projects', label: 'Projects', list: true, multiline: true },
  { key: 'achievements', label: 'Achievements', list: true, multiline: true },
];

export function emptyProfile(): ResumeProfile {
  return {
    fullName: '',
    email: '',
    phone: '',
    linkedin: '',
    portfolio: '',
    streetAddress: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
    university: '',
    degree: '',
    major: '',
    graduationDate: '',
    gpa: '',
    currentCompany: '',
    currentTitle: '',
    targetRole: '',
    skills: [],
    workExperience: [],
    projects: [],
    achievements: [],
    resumePath: '',
  };
}
