import { z } from 'zod';
import rules from '../shared/field-rules.json';

const yesNo = z.enum(['', 'yes', 'no']).default('');
const yesNoUnsure = z.enum(['', 'yes', 'no', 'unsure']).default('');
const yesNoDecline = z.enum(['', 'yes', 'no', 'decline']).default('');

// Standing answers are the questions every portal asks that a resume cannot answer.
// '' means "not set" and prompts the user; 'decline' means the user opted out of a
// voluntary question and must never be asked again.
export const preferencesSchema = z.object({
  workAuthorized: yesNoUnsure,
  requiresSponsorship: yesNoUnsure,
  sponsorshipNowOrFuture: yesNoUnsure,
  sponsorshipFuture: yesNoUnsure,
  visaStatus: z.string().max(120).default(''),
  workAuthExpiry: z.string().max(20).default(''),
  citizenship: z.string().max(120).default(''),
  clearanceLevel: z.string().max(120).default(''),
  exportControlEligible: yesNoUnsure,
  inJobCountry: yesNoUnsure,
  desiredSalary: z.string().max(60).default(''),
  salaryCurrency: z.string().max(20).default(''),
  salaryPeriod: z.enum(['', 'year', 'month', 'hour']).default(''),
  currentSalary: z.string().max(60).default(''),
  earliestStartDate: z.string().max(40).default(''),
  noticePeriod: z.string().max(120).default(''),
  willingToRelocate: z.enum(['', 'yes', 'no', 'case_by_case']).default(''),
  remotePreference: z.enum(['', 'remote', 'hybrid', 'onsite', 'flexible']).default(''),
  travelWillingness: z.string().max(60).default(''),
  shiftAvailability: z.string().max(200).default(''),
  driversLicense: yesNoUnsure,
  over18: yesNoUnsure,
  backgroundCheckConsent: yesNoUnsure,
  drugTestConsent: yesNoUnsure,
  criminalRecord: yesNoUnsure,
  criminalRecordExplanation: z.string().max(1000).default(''),
  previouslyEmployedHere: yesNoUnsure,
  relativeEmployedHere: yesNoUnsure,
  boundByNonCompete: yesNoUnsure,
  previouslyApplied: yesNoUnsure,
  howDidYouHear: z.string().max(200).default(''),
  eeoOptIn: z.boolean().default(false),
  gender: z.string().max(120).default(''),
  pronouns: z.string().max(120).default(''),
  transgenderStatus: yesNoDecline,
  sexualOrientation: z.string().max(120).default(''),
  raceEthnicity: z.string().max(120).default(''),
  hispanicLatino: yesNoDecline,
  veteranStatus: z.string().max(120).default(''),
  disabilityStatus: yesNoDecline,
  updatedAt: z.number().optional(),
}).strict();

export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferenceKey = Exclude<keyof Preferences, 'updatedAt'>;
// Everything the dashboard edits as text. The EEO opt-in is a checkbox handled on its own.
export type AnswerKey = Exclude<PreferenceKey, 'eeoOptIn'>;

type Choice = { value: string; label: string };

const YES_NO: Choice[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
export const YES_NO_UNSURE: Choice[] = [...YES_NO, { value: 'unsure', label: 'Not sure' }];
const YES_NO_DECLINE: Choice[] = [...YES_NO, { value: 'decline', label: 'Prefer not to say' }];

export interface PreferenceField {
  key: AnswerKey;
  label: string;
  hint?: string;
  choices?: Choice[];
  multiline?: boolean;
}

export interface PreferenceGroup {
  id: string;
  eyebrow: string;
  title: string;
  fields: PreferenceField[];
}

// Grouped the way the questions appear on a real portal, so filling this in once
// covers the same facts however the next form phrases them.
export const PREFERENCE_GROUPS: PreferenceGroup[] = [
  {
    id: 'work-eligibility',
    eyebrow: 'WORK ELIGIBILITY',
    title: 'Right to work',
    fields: [
      { key: 'workAuthorized', label: 'Are you authorized to work lawfully in the country for the position in which you are applying?', choices: YES_NO_UNSURE },
      { key: 'sponsorshipNowOrFuture', label: 'Will you now or in the future require the employer to commence (‘sponsor’) an immigration case in order to employ you?', hint: 'Used for the Illumio question and equivalent questions from other employers. Answer separately from sponsorship now or future-only sponsorship.', choices: YES_NO_UNSURE },
      { key: 'requiresSponsorship', label: 'Do you require visa sponsorship now?', choices: YES_NO_UNSURE },
      { key: 'sponsorshipFuture', label: 'Will you require sponsorship in the future?', choices: YES_NO_UNSURE },
      { key: 'visaStatus', label: 'Current visa or immigration status', hint: 'For example H-1B, F-1 OPT, Green Card, citizen' },
      { key: 'workAuthExpiry', label: 'Work authorization expiry', hint: 'YYYY-MM, leave blank if it does not expire' },
      { key: 'citizenship', label: 'Citizenship' },
      { key: 'clearanceLevel', label: 'Security clearance', hint: 'Leave blank if you do not hold one' },
      { key: 'exportControlEligible', label: 'Eligible under export control rules (ITAR/EAR)?', choices: YES_NO_UNSURE },
      { key: 'inJobCountry', label: 'Are you currently located in the job’s country?', choices: YES_NO_UNSURE },
    ],
  },
  {
    id: 'compensation',
    eyebrow: 'COMPENSATION',
    title: 'Pay expectations',
    fields: [
      { key: 'desiredSalary', label: 'Desired salary', hint: 'A number, or a range' },
      { key: 'salaryCurrency', label: 'Currency', hint: 'For example USD, EUR, GBP' },
      {
        key: 'salaryPeriod',
        label: 'Salary is quoted',
        choices: [
          { value: 'year', label: 'Per year' },
          { value: 'month', label: 'Per month' },
          { value: 'hour', label: 'Per hour' },
        ],
      },
      { key: 'currentSalary', label: 'Current salary', hint: 'Leave blank if you would rather not share it' },
    ],
  },
  {
    id: 'availability',
    eyebrow: 'AVAILABILITY',
    title: 'Start date and conditions',
    fields: [
      { key: 'earliestStartDate', label: 'Earliest start date', hint: 'YYYY-MM-DD' },
      { key: 'noticePeriod', label: 'Notice period', hint: 'For example 2 weeks, 1 month, immediate' },
      {
        key: 'willingToRelocate',
        label: 'Willing to relocate?',
        choices: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'case_by_case', label: 'Case by case' },
        ],
      },
      {
        key: 'remotePreference',
        label: 'Preferred work arrangement',
        choices: [
          { value: 'remote', label: 'Remote' },
          { value: 'hybrid', label: 'Hybrid' },
          { value: 'onsite', label: 'On-site' },
          { value: 'flexible', label: 'Flexible' },
        ],
      },
      { key: 'travelWillingness', label: 'Travel you accept', hint: 'For example none, up to 25%, frequent' },
      { key: 'shiftAvailability', label: 'Shifts, weekends or on-call you can work', multiline: true },
      { key: 'driversLicense', label: 'Valid driver’s licence?', choices: YES_NO_UNSURE },
    ],
  },
  {
    id: 'background',
    eyebrow: 'BACKGROUND',
    title: 'Screening questions',
    fields: [
      { key: 'over18', label: 'Are you 18 or older?', choices: YES_NO_UNSURE },
      { key: 'backgroundCheckConsent', label: 'Consent to a background check?', choices: YES_NO_UNSURE },
      { key: 'drugTestConsent', label: 'Consent to a drug test?', choices: YES_NO_UNSURE },
      { key: 'criminalRecord', label: 'Have you ever been convicted of a crime?', choices: YES_NO_UNSURE },
      { key: 'criminalRecordExplanation', label: 'Explanation, if you answered yes', multiline: true },
      { key: 'previouslyEmployedHere', label: 'Have you worked at this company before?', choices: YES_NO_UNSURE },
      { key: 'relativeEmployedHere', label: 'Do you have a relative working here?', choices: YES_NO_UNSURE },
      { key: 'boundByNonCompete', label: 'Are you bound by a non-compete?', choices: YES_NO_UNSURE },
      { key: 'previouslyApplied', label: 'Have you applied to this company before?', choices: YES_NO_UNSURE },
      { key: 'howDidYouHear', label: 'How did you hear about the role?', hint: 'For example LinkedIn, referral, company site' },
    ],
  },
  {
    id: 'voluntary',
    eyebrow: 'VOLUNTARY · SKIPPABLE',
    title: 'Equal opportunity questions',
    fields: [
      { key: 'gender', label: 'Gender identity', hint: 'Use the wording your portals offer' },
      { key: 'pronouns', label: 'Pronouns', hint: 'For example she/her, he/him, they/them' },
      { key: 'transgenderStatus', label: 'Are you transgender?', choices: YES_NO_DECLINE },
      { key: 'sexualOrientation', label: 'Sexual orientation' },
      { key: 'raceEthnicity', label: 'Race or ethnicity' },
      { key: 'hispanicLatino', label: 'Are you Hispanic or Latino?', choices: YES_NO_DECLINE },
      { key: 'veteranStatus', label: 'Veteran status' },
      { key: 'disabilityStatus', label: 'Do you have a disability?', choices: YES_NO_DECLINE },
    ],
  },
];

export function emptyPreferences(): Preferences {
  return preferencesSchema.parse({});
}

export const PREFERENCE_FIELDS: PreferenceField[] = PREFERENCE_GROUPS.flatMap((group) => group.fields);

// Canonical values are stored short ('yes', 'decline') so one answer can be translated
// into whatever wording each portal's options use. The wording table is shared with the
// Python service, which stamps the same text into the answers it resolves.
const answerText = rules.preferenceAnswers as Record<string, string>;

export function preferenceAnswer(value: string): string {
  const clean = value.trim();
  if (!clean) return '';
  return answerText[clean] ?? clean;
}
