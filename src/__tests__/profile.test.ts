import { describe, expect, it } from 'vitest';
import { emptyProfile, formatWorkExperience, resumeProfileSchema, workExperienceSchema } from '../profile';

describe('resumeProfileSchema', () => {
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
