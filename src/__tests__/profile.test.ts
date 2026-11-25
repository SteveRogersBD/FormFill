import { describe, expect, it } from 'vitest';
import { emptyProfile, formatWorkExperience, resumeProfileSchema, workExperienceSchema } from '../profile';

describe('resumeProfileSchema', () => {
  it('rejects duplicate experience identities that would make edits ambiguous', () => {
    const entry = workExperienceSchema.parse({ id: 'same-id', jobTitle: 'Engineer' });
    expect(resumeProfileSchema.safeParse({ workExperience: [entry, entry] }).success).toBe(false);
  });
  it('keeps dates and locations embedded in imported role headings', () => {
    const profile = resumeProfileSchema.parse({ workExperience: ['Engineer at Example | Chicago, IL | Jun 2024 – Aug 2024'] });
    expect(profile.workExperience[0]).toMatchObject({ company: 'Example', jobTitle: 'Engineer', summary: 'Chicago, IL · Jun 2024 – Aug 2024' });
    expect(formatWorkExperience(profile.workExperience)[0]).toContain('Jun 2024 – Aug 2024');
  });
  it('rejects invalid months reversed dates and contradictory current roles', () => {
    expect(workExperienceSchema.safeParse({ id: '1', startDate: '2024-13' }).success).toBe(false);
    expect(workExperienceSchema.safeParse({ id: '1', startDate: '2025-01', endDate: '2024-12' }).success).toBe(false);
    expect(workExperienceSchema.safeParse({ id: '1', current: true, endDate: '2024-12' }).success).toBe(false);
    expect(workExperienceSchema.safeParse({ id: '1', current: true, startDate: '2024-12' }).success).toBe(true);
  });
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
