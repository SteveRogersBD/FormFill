import { describe, expect, it } from 'vitest';
import { matchQuestion, questionAnswer } from '../questions';
import { emptyPreferences } from '../preferences';

describe('matchQuestion', () => {
  it('maps the additional common questions shown in the reference dashboard', () => {
    expect(matchQuestion('Countries where you want to work')?.id).toBe('workCountries');
    expect(matchQuestion('Are you a citizen of the United States?')?.id).toBe('usCitizen');
    expect(matchQuestion('What is your citizenship?')?.id).toBe('citizenship');
    expect(matchQuestion('Do you identify as LGBTQ+?')?.id).toBe('lgbtqIdentity');
    expect(matchQuestion('What is your sexual orientation?')?.id).toBe('sexualOrientation');
  });
  it('maps the same question however a portal phrases it', () => {
    for (const label of [
      'Do you require sponsorship?',
      'Do you need any help with visa?',
      'Will you require work authorization?',
    ]) {
      expect(matchQuestion(label)?.id).toBe('requiresSponsorship');
    }
  });

  it('matches the exact Illumio questions and separates combined sponsorship from current sponsorship', () => {
    expect(matchQuestion('Are you authorized to work lawfully in the country for the position in which you are applying?')?.id).toBe('workAuthorized');
    expect(matchQuestion('Will you now or in the future require Illumio to commence (‘sponsor’) an immigration case in order to employ you?')?.id).toBe('sponsorshipNowOrFuture');
    expect(matchQuestion('Will you now or in the future require visa sponsorship?')?.id).toBe('sponsorshipNowOrFuture');
    expect(matchQuestion('Will you require sponsorship now or in the future?')?.id).toBe('sponsorshipNowOrFuture');
    expect(matchQuestion('Do you currently require sponsorship?')?.id).toBe('requiresSponsorship');
    expect(matchQuestion('Will you require sponsorship in the future?')?.id).toBe('sponsorshipFuture');
  });

  it('keeps sponsorship and visa status apart when both share the word visa', () => {
    expect(matchQuestion('Will you require sponsorship for employment visa status?')?.id).toBe('requiresSponsorship');
    expect(matchQuestion('What is your current visa status?')?.id).toBe('visaStatus');
    expect(matchQuestion('What type of visa do you hold?')?.id).toBe('visaStatus');
    expect(matchQuestion('Will you require visa sponsorship in the future?')?.id).toBe('sponsorshipFuture');
    expect(matchQuestion('When does your work authorization expire?')?.id).toBe('workAuthExpiry');
  });

  it('keeps work authorization apart from sponsorship', () => {
    expect(matchQuestion('Are you legally authorized to work in the United States?')?.id).toBe('workAuthorized');
    expect(matchQuestion('Are you authorized to work without sponsorship?')?.id).toBe('workAuthorized');
    expect(matchQuestion('Do you have the right to work in the UK?')?.id).toBe('workAuthorized');
  });

  it('maps compensation, availability and background questions', () => {
    expect(matchQuestion('What is your expected salary?')?.id).toBe('desiredSalary');
    expect(matchQuestion('What are your compensation requirements?')?.id).toBe('desiredSalary');
    expect(matchQuestion('What is your current salary?')?.id).toBe('currentSalary');
    expect(matchQuestion('How much notice do you need to give?')?.id).toBe('noticePeriod');
    expect(matchQuestion('When can you start?')?.id).toBe('earliestStartDate');
    expect(matchQuestion('Are you open to relocation?')?.id).toBe('willingToRelocate');
    expect(matchQuestion('Are you willing to travel up to 25%?')?.id).toBe('travelWillingness');
    expect(matchQuestion('Do you have a valid driver’s license?')?.id).toBe('driversLicense');
    expect(matchQuestion('Are you 18 years of age or older?')?.id).toBe('over18');
    expect(matchQuestion('Do you consent to a background check?')?.id).toBe('backgroundCheckConsent');
    expect(matchQuestion('Have you ever been convicted of a felony?')?.id).toBe('criminalRecord');
    expect(matchQuestion('How did you hear about this role?')?.id).toBe('howDidYouHear');
  });

  it('maps the voluntary demographic questions', () => {
    expect(matchQuestion('Gender identity')?.id).toBe('gender');
    expect(matchQuestion('Preferred pronouns')?.id).toBe('pronouns');
    expect(matchQuestion('Are you Hispanic or Latino?')?.id).toBe('hispanicLatino');
    expect(matchQuestion('Race')?.id).toBe('raceEthnicity');
    expect(matchQuestion('Veteran status')?.id).toBe('veteranStatus');
    expect(matchQuestion('Do you have a disability?')?.id).toBe('disabilityStatus');
  });

  it('marks open-ended questions as drafts instead of filling them from the profile', () => {
    expect(matchQuestion('Why do you want to join Acme?')?.answerFrom).toBe('llm');
    expect(matchQuestion('Tell us about your best project')?.id).toBe('bestProject');
    expect(matchQuestion('Tell us about a project you’re proud of')?.id).toBe('bestProject');
    expect(matchQuestion('Describe a time you handled conflict')?.id).toBe('conflict');
    expect(matchQuestion('Cover letter')?.id).toBe('coverLetter');
  });

  it('does not match unrelated labels or questions about someone else', () => {
    expect(matchQuestion('First name')).toBeUndefined();
    expect(matchQuestion('University')).toBeUndefined();
    expect(matchQuestion('The gender of your manager')).toBeUndefined();
    expect(matchQuestion('Are you attending a visa-sponsored event?')).toBeUndefined();
    expect(matchQuestion('What is your salary history?')).toBeUndefined();
    expect(matchQuestion('Describe your work experience')).toBeUndefined();
  });
});

describe('questionAnswer', () => {
  it('keeps LGBTQ identity private unless voluntary sharing is enabled', () => {
    const question = matchQuestion('Do you identify as LGBTQ+?')!;
    const saved = { ...emptyPreferences(), lgbtqIdentity: 'decline' as const };
    expect(questionAnswer(question, saved)).toBe('');
    expect(questionAnswer(question, { ...saved, eeoOptIn: true })).toBe('I don’t wish to answer');
  });
  const preferences = { ...emptyPreferences(), requiresSponsorship: 'no' as const, visaStatus: 'H-1B', gender: 'Woman' };

  it('translates the stored value into the wording a form expects', () => {
    expect(questionAnswer(matchQuestion('Do you require sponsorship?')!, preferences)).toBe('No');
  });

  it('withholds voluntary demographics until the user opts in', () => {
    expect(questionAnswer(matchQuestion('Gender identity')!, preferences)).toBe('');
    expect(questionAnswer(matchQuestion('Gender identity')!, { ...preferences, eeoOptIn: true })).toBe('Woman');
  });

  it('leaves unanswered questions empty rather than guessing', () => {
    expect(questionAnswer(matchQuestion('What are your salary expectations?')!, preferences)).toBe('');
    expect(questionAnswer(matchQuestion('Why do you want to join Acme?')!, preferences)).toBe('');
  });

  it('does not treat no current sponsorship as no future sponsorship', () => {
    const combined = matchQuestion('Will you now or in the future require Illumio to commence (‘sponsor’) an immigration case in order to employ you?')!;
    expect(questionAnswer(combined, { ...emptyPreferences(), requiresSponsorship: 'no', sponsorshipFuture: 'yes' })).toBe('');
    expect(questionAnswer(combined, { ...emptyPreferences(), sponsorshipNowOrFuture: 'yes' })).toBe('Yes');
    expect(questionAnswer(combined, { ...emptyPreferences(), sponsorshipNowOrFuture: 'no' })).toBe('No');
  });

  it('maps a declined voluntary question to a decline answer', () => {
    const declined = { ...emptyPreferences(), eeoOptIn: true, disabilityStatus: 'decline' as const };
    expect(questionAnswer(matchQuestion('Do you have a disability?')!, declined)).toBe('I don’t wish to answer');
  });
});
