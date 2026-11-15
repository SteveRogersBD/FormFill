import { describe, expect, it } from 'vitest';
import { findProfileValue, isSensitiveField } from '../fields';
import { emptyProfile } from '../profile';

const profile = {
  ...emptyProfile(),
  fullName: 'Jordan Lee',
  email: 'jordan@example.com',
  phone: '+1 555 010 0100',
  linkedin: 'linkedin.com/in/jordan-lee',
  skills: ['TypeScript', 'React'],
  workExperience: ['Built reliable onboarding flows.'],
  targetRole: 'Product Designer',
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

  it('uses user-entered preferences and leaves unknown values blank', () => {
    expect(findProfileValue('What target role are you seeking?', profile)).toBe('Product Designer');
    expect(findProfileValue('What is your salary expectation?', profile)).toBeUndefined();
    expect(findProfileValue('Tell us your favorite color', profile)).toBeUndefined();
  });
});

describe('isSensitiveField', () => {
  it.each(['Work authorization', 'Visa sponsorship', 'Salary expectation', 'Gender'])('%s requires confirmation', (label) => {
    expect(isSensitiveField(label)).toBe(true);
  });

  it('does not flag ordinary profile fields', () => {
    expect(isSensitiveField('University')).toBe(false);
  });
});
