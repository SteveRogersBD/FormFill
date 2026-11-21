import { z } from 'zod';

export const resumeProfileSchema = z.object({
  fullName: z.string().max(200).default(''),
  email: z.string().max(320).default(''),
  phone: z.string().max(80).default(''),
  linkedin: z.string().max(500).default(''),
  portfolio: z.string().max(500).default(''),
  city: z.string().max(120).default(''),
  state: z.string().max(120).default(''),
  postalCode: z.string().max(40).default(''),
  country: z.string().max(120).default(''),
  university: z.string().max(300).default(''),
  degree: z.string().max(200).default(''),
  major: z.string().max(200).default(''),
  graduationDate: z.string().max(80).default(''),
  currentCompany: z.string().max(200).default(''),
  currentTitle: z.string().max(200).default(''),
  targetRole: z.string().max(200).default(''),
  skills: z.array(z.string().max(200)).max(100).default([]),
  workExperience: z.array(z.string().max(2000)).max(100).default([]),
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
    city: '',
    state: '',
    postalCode: '',
    country: '',
    university: '',
    degree: '',
    major: '',
    graduationDate: '',
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
