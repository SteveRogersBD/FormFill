export interface ResumeProfile {
  fullName: string;
  email: string;
  phone: string;
  linkedin: string;
  portfolio: string;
  university: string;
  graduationDate: string;
  skills: string[];
  workExperience: string[];
  projects: string[];
  achievements: string[];
  resumePath: string;
  updatedAt?: number;
}

export type ProfileField = Exclude<keyof ResumeProfile, 'resumePath' | 'updatedAt'>;

export const PROFILE_FIELDS: { key: ProfileField; label: string; multiline?: boolean; list?: boolean }[] = [
  { key: 'fullName', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'linkedin', label: 'LinkedIn URL' },
  { key: 'portfolio', label: 'Portfolio URL' },
  { key: 'university', label: 'University' },
  { key: 'graduationDate', label: 'Graduation date' },
  { key: 'skills', label: 'Skills', list: true, multiline: true },
  { key: 'workExperience', label: 'Work experience', list: true, multiline: true },
  { key: 'projects', label: 'Projects', list: true, multiline: true },
  { key: 'achievements', label: 'Achievements', list: true, multiline: true },
];

export function emptyProfile(): ResumeProfile {
  return { fullName: '', email: '', phone: '', linkedin: '', portfolio: '', university: '', graduationDate: '', skills: [], workExperience: [], projects: [], achievements: [], resumePath: '' };
}
