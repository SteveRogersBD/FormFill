import { JOB_TYPES, workExperienceSchema, type WorkExperience } from './profile';

interface WorkExperienceEditorProps {
  value: WorkExperience[];
  onChange: (entries: WorkExperience[]) => void;
}

function replaceEntry(entries: WorkExperience[], id: string, patch: Partial<WorkExperience>) {
  return entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry);
}
