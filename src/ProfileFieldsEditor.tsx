import { PROFILE_FIELDS, profileFieldValue, type ProfileField, type ResumeProfile } from './profile';

interface ProfileFieldsEditorProps {
  fields: ProfileField[];
  profile: ResumeProfile;
  onChange: (key: ProfileField, value: string) => void;
}
