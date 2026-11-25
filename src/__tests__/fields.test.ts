import { describe, expect, it } from 'vitest';
import { findProfileValue, isCoverLetterField, isSensitiveField } from '../fields';
import { emptyProfile, resumeProfileSchema } from '../profile';

const profile = resumeProfileSchema.parse({
  ...emptyProfile(),
  fullName: 'Jordan Lee',
  email: 'jordan@example.com',
  phone: '+1 555 010 0100',
  linkedin: 'linkedin.com/in/jordan-lee',
  portfolio: 'jordanlee.dev',
  university: 'State University',
  skills: ['TypeScript', 'React'],
  workExperience: ['Built reliable onboarding flows.'],
  targetRole: 'Product Designer',
});

const detailedProfile = {
  ...profile,
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94103',
  country: 'United States',
  degree: 'Bachelor of Science',
  major: 'Computer Science',
  currentCompany: 'Northstar Studio',
  currentTitle: 'Product Designer',
};

describe('findProfileValue', () => {
  it('matches common contact and education labels to saved facts', () => {
    expect(findProfileValue('Full name', profile)).toBe('Jordan Lee');
    expect(findProfileValue('First name', profile)).toBe('Jordan');
    expect(findProfileValue('Last name', profile)).toBe('Lee');
    expect(findProfileValue('Email address', profile)).toBe('jordan@example.com');
    expect(findProfileValue('Phone number', profile)).toBe('+1 555 010 0100');
  });

  it('normalizes social links and formats list answers', () => {
    expect(findProfileValue('LinkedIn profile', profile)).toBe('https://linkedin.com/in/jordan-lee');
    expect(findProfileValue('What skills would you bring?', profile)).toBe('TypeScript, React');
  });

  it('matches Greenhouse-style contact and education labels', () => {
    expect(findProfileValue('First Name*', profile)).toBe('Jordan');
    expect(findProfileValue('Last Name*', profile)).toBe('Lee');
    expect(findProfileValue('Email*', profile)).toBe('jordan@example.com');
    expect(findProfileValue('Phone*', profile)).toBe('+1 555 010 0100');
    expect(findProfileValue('Portfolio Website', profile)).toBe('https://jordanlee.dev');
    expect(findProfileValue('University or college', profile)).toBe('State University');
  });

  it('matches location, education, and current-role facts', () => {
    expect(findProfileValue('Street address', { ...detailedProfile, streetAddress: '123 Example St' })).toBe('123 Example St');
    expect(findProfileValue('GPA', { ...detailedProfile, gpa: '3.8 / 4.0' })).toBe('3.8 / 4.0');
    expect(findProfileValue('Location', detailedProfile)).toBe('San Francisco, CA, United States');
    expect(findProfileValue('ZipCode', detailedProfile)).toBe('94103');
    expect(findProfileValue('Linked In profile', detailedProfile)).toBe('https://linkedin.com/in/jordan-lee');
    expect(findProfileValue('City', detailedProfile)).toBe('San Francisco');
    expect(findProfileValue('State', detailedProfile)).toBe('CA');
    expect(findProfileValue('Zip code', detailedProfile)).toBe('94103');
    expect(findProfileValue('Country', detailedProfile)).toBe('United States');
    expect(findProfileValue('Degree', detailedProfile)).toBe('Bachelor of Science');
    expect(findProfileValue('Major / Field of Study', detailedProfile)).toBe('Computer Science');
    expect(findProfileValue('Current company', detailedProfile)).toBe('Northstar Studio');
    expect(findProfileValue('Job title', detailedProfile)).toBe('Product Designer');
  });

  it('leaves missing saved contact details empty', () => {
    expect(findProfileValue('Zip Code', emptyProfile())).toBeUndefined();
    expect(findProfileValue('LinkedIn Profile', emptyProfile())).toBeUndefined();
    expect(findProfileValue('Location', { ...emptyProfile(), state: 'CA' })).toBeUndefined();
  });

  it('keeps the applicant name out of company and school name fields', () => {
    expect(findProfileValue('Company name', detailedProfile)).toBe('Northstar Studio');
    expect(findProfileValue('School name', profile)).toBe('State University');
  });

  it('does not answer location preferences with the saved city', () => {
    expect(findProfileValue('Are you open to relocation?', detailedProfile)).toBeUndefined();
    expect(findProfileValue('Preferred work location', detailedProfile)).toBeUndefined();
  });

  it('uses user-entered preferences and leaves unknown values blank', () => {
    expect(findProfileValue('What target role are you seeking?', profile)).toBe('Product Designer');
    expect(findProfileValue('What role are you seeking?', profile)).toBe('Product Designer');
    expect(findProfileValue('What is your salary expectation?', profile)).toBeUndefined();
    expect(findProfileValue('Tell us your favorite color', profile)).toBeUndefined();
  });
});

describe('isSensitiveField', () => {
  it.each(['Work authorization', 'Visa sponsorship', 'Salary expectation', 'Gender', 'Pronouns', 'Preferred pronouns', 'Citizenship', 'Background check', 'Open to relocation', 'Consent to a background check'])('%s requires confirmation', (label) => {
    expect(isSensitiveField(label)).toBe(true);
  });

  it('does not flag ordinary profile fields', () => {
    expect(isSensitiveField('University')).toBe(false);
  });
});

describe('isCoverLetterField', () => {
  it.each(['Cover letter', 'Letter of interest', 'Letter of motivation', 'Statement of interest'])('%s is a draftable application field', (label) => {
    expect(isCoverLetterField(label)).toBe(true);
  });

  it('does not match unrelated fields', () => {
    expect(isCoverLetterField('Resume/CV')).toBe(false);
  });
});
