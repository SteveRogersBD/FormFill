import { PROFILE_FIELDS, profileFieldValue, type ProfileField, type ResumeProfile } from './profile';

interface ProfileFieldsEditorProps {
  fields: ProfileField[];
  profile: ResumeProfile;
  onChange: (key: ProfileField, value: string) => void;
}

export function ProfileFieldsEditor({ fields, profile, onChange }: ProfileFieldsEditorProps) {
  return <div className="field-grid">{fields.filter((key) => key !== 'workExperience').map((key) => {
    const field = PROFILE_FIELDS.find((item) => item.key === key)!;
    const value = profileFieldValue(profile, key);
    const text = Array.isArray(value) ? value.join(key === 'projects' ? '\n\n' : '\n') : value;
    const inputType = key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text';
    return <label className={`form-field ${field.multiline || key === 'streetAddress' ? 'span-two' : ''}`} key={key}><span>{field.label}</span>{field.multiline
      ? <textarea rows={key === 'skills' ? 4 : 5} value={text} onChange={(event) => onChange(key, event.target.value)} placeholder={key === 'projects' ? 'One project per block; separate projects with a blank line' : field.list ? 'One item per line' : ''} />
      : <input type={inputType} value={text} onChange={(event) => onChange(key, event.target.value)} />}</label>;
  })}</div>;
}
