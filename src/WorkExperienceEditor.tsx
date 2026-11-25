import { JOB_TYPES, workExperienceSchema, type WorkExperience } from './profile';

interface WorkExperienceEditorProps {
  value: WorkExperience[];
  onChange: (entries: WorkExperience[]) => void;
}
