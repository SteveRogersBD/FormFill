import { describe, expect, it } from 'vitest';
import { emptyProfile, formatWorkExperience, resumeProfileSchema, workExperienceSchema } from '../profile';

describe('resumeProfileSchema', () => {
  it('round-trips structured roles with dates location summary and bullets', () => {
    const entry = workExperienceSchema.parse({ id: 'role-1', jobTitle: 'Engineer', company: 'Northstar', jobType: 'Internship', location: 'Chicago, IL', startDate: '2024-06', endDate: '2024-08', summary: 'Platform engineering.', description: ['Built APIs.', 'Improved reliability.'] });
    expect(resumeProfileSchema.parse({ workExperience: [entry] }).workExperience).toEqual([entry]);
    expect(formatWorkExperience([entry])).toEqual(['Engineer at Northstar\nInternship · Chicago, IL\n2024-06 – 2024-08\nPlatform engineering.\nBuilt APIs.\nImproved reliability.']);
  });
  it('preserves imported notes and groups explicit role-at-company headings', () => {
    const profile = resumeProfileSchema.parse({ workExperience: ['Unstructured career note.', 'Engineer at Northstar', 'Built dashboards.', 'Researcher at Example Lab', 'Published a paper.'] });
    expect(profile.workExperience).toMatchObject([
      { jobTitle: '', company: '', description: ['Unstructured career note.'] },
      { jobTitle: 'Engineer', company: 'Northstar', description: ['Built dashboards.'] },
      { jobTitle: 'Researcher', company: 'Example Lab', description: ['Published a paper.'] },
    ]);
    expect(formatWorkExperience(profile.workExperience).join('\n')).toContain('Researcher at Example Lab\nPublished a paper.');
  });
  it('accepts a complete editable profile', () => {
    const profile = { ...emptyProfile(), fullName: 'Jordan Lee', skills: ['React'], updatedAt: 123 };
    expect(resumeProfileSchema.parse(profile)).toEqual(profile);
  });

  it('applies defaults to missing optional profile fields', () => {
    expect(resumeProfileSchema.parse({}).fullName).toBe('');
    expect(resumeProfileSchema.parse({}).skills).toEqual([]);
  });

  it('rejects malformed and unexpected profile data from Firestore', () => {
    expect(resumeProfileSchema.safeParse({ ...emptyProfile(), skills: 'React' }).success).toBe(false);
    expect(resumeProfileSchema.safeParse({ ...emptyProfile(), unexpected: true }).success).toBe(false);
  });
});
