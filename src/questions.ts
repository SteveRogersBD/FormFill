import taxonomy from '../shared/questions.json';
import { normalizeLabel } from './fields';
import { preferenceAnswer, type PreferenceKey, type Preferences } from './preferences';

export interface QuestionDef {
  id: string;
  label: string;
  patterns: RegExp[];
  fieldType: 'yesno' | 'select' | 'text' | 'date' | 'number' | 'narrative';
  answerFrom: 'preferences' | 'profile' | 'llm';
  prefKey?: PreferenceKey;
  sensitivity: 'standard' | 'consequential' | 'eeo';
  negative?: RegExp[];
}

interface QuestionEntry {
  id: string;
  label: string;
  fieldType: QuestionDef['fieldType'];
  answerFrom: QuestionDef['answerFrom'];
  prefKey?: string;
  sensitivity: QuestionDef['sensitivity'];
  patterns: string[];
  negative?: string[];
}

// Job portals ask the same ~40 questions in their own words, so each entry absorbs the
// phrasings seen in the wild. The definitions live in shared/questions.json because the
// Python service reads the same file for taxonomy ids and preference keys — one table, no
// drift. List order is match priority: specific rows first, and a general row carries
// negatives for the specific rows it would otherwise swallow ("visa status" must not
// capture "sponsorship for employment visa status").
// Patterns stay strings until this module load, which is the only place they are compiled.
export const QUESTIONS: QuestionDef[] = (taxonomy as QuestionEntry[]).map((entry) => ({
  id: entry.id,
  label: entry.label,
  fieldType: entry.fieldType,
  answerFrom: entry.answerFrom,
  prefKey: entry.prefKey as PreferenceKey | undefined,
  sensitivity: entry.sensitivity,
  patterns: entry.patterns.map((pattern) => new RegExp(pattern)),
  negative: entry.negative?.map((pattern) => new RegExp(pattern)),
}));

export function matchQuestion(label: string): QuestionDef | undefined {
  const normalized = normalizeLabel(label);
  return QUESTIONS.find((question) => question.patterns.some((pattern) => pattern.test(normalized))
    && !question.negative?.some((pattern) => pattern.test(normalized)));
}

export function questionAnswer(question: QuestionDef, preferences: Preferences): string {
  if (question.answerFrom !== 'preferences' || !question.prefKey) return '';
  if (question.sensitivity === 'eeo' && !preferences.eeoOptIn) return '';
  const stored = preferences[question.prefKey];
  return typeof stored === 'string' ? preferenceAnswer(stored) : '';
}
