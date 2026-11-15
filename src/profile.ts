import { z } from 'zod';

export const resumeProfileSchema = z.object({
  fullName: z.string().max(200).default(''),
  email: z.string().max(320).default(''),
  phone: z.string().max(80).default(''),
  linkedin: z.string().max(500).default(''),
  portfolio: z.string().max(500).default(''),
  university: z.string().max(300).default(''),
  graduationDate: z.string().max(80).default(''),
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
  { key: 'linkedin', label: 'LinkedIn URL' },
  { key: 'portfolio', label: 'Portfolio URL' },
  { key: 'university', label: 'University' },
  { key: 'graduationDate', label: 'Graduation date' },
  { key: 'targetRole', label: 'Role you’re looking for' },
  { key: 'skills', label: 'Skills', list: true, multiline: true },
  { key: 'workExperience', label: 'Work experience', list: true, multiline: true },
  { key: 'projects', label: 'Projects', list: true, multiline: true },
  { key: 'achievements', label: 'Achievements', list: true, multiline: true },
];

export function emptyProfile(): ResumeProfile {
  return { fullName: '', email: '', phone: '', linkedin: '', portfolio: '', university: '', graduationDate: '', targetRole: '', skills: [], workExperience: [], projects: [], achievements: [], resumePath: '' };
}
