import { JOB_TYPES, workExperienceSchema, type WorkExperience } from './profile';

interface WorkExperienceEditorProps {
  value: WorkExperience[];
  onChange: (entries: WorkExperience[]) => void;
}

function replaceEntry(entries: WorkExperience[], id: string, patch: Partial<WorkExperience>) {
  return entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry);
}

export function WorkExperienceEditor({ value, onChange }: WorkExperienceEditorProps) {
  return <div className="experience-editor-list">
    {!value.length && <p className="muted">Add each role separately so its dates, employer, and responsibilities stay together.</p>}
    {value.map((entry, index) => <section className="experience-editor-entry" key={entry.id} aria-label={`Work Experience ${index + 1}`}>
      <div className="experience-editor-heading"><h3>Work Experience {index + 1}</h3><button type="button" className="remove-entry" aria-label={`Remove work experience ${index + 1}`} onClick={() => onChange(value.filter((item) => item.id !== entry.id))}>×</button></div>
      <div className="field-grid">
        <label className="form-field span-two"><span>Job title <i aria-hidden="true">*</i></span><input required maxLength={200} value={entry.jobTitle} onChange={(event) => onChange(replaceEntry(value, entry.id, { jobTitle: event.target.value }))} /></label>
        <label className="form-field span-two"><span>Company <i aria-hidden="true">*</i></span><input required maxLength={200} value={entry.company} onChange={(event) => onChange(replaceEntry(value, entry.id, { company: event.target.value }))} /></label>
        <label className="form-field"><span>Job type</span><select value={entry.jobType} onChange={(event) => onChange(replaceEntry(value, entry.id, { jobType: event.target.value as WorkExperience['jobType'] }))}><option value="">Not provided</option>{JOB_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="form-field"><span>Location</span><input maxLength={200} value={entry.location} onChange={(event) => onChange(replaceEntry(value, entry.id, { location: event.target.value }))} /></label>
        <label className="form-field"><span>Start date</span><input type="month" value={entry.startDate} onChange={(event) => onChange(replaceEntry(value, entry.id, { startDate: event.target.value }))} /></label>
        <div className="form-field"><label className="form-field"><span>End date</span><input type="month" min={entry.startDate || undefined} disabled={entry.current} value={entry.endDate} onChange={(event) => onChange(replaceEntry(value, entry.id, { endDate: event.target.value }))} /></label><label className="current-role-choice"><input type="checkbox" checked={entry.current} onChange={(event) => onChange(replaceEntry(value, entry.id, { current: event.target.checked, endDate: event.target.checked ? '' : entry.endDate }))} /> I currently work here</label></div>
        <label className="form-field span-two"><span>Experience summary</span><textarea maxLength={2000} rows={2} value={entry.summary} onChange={(event) => onChange(replaceEntry(value, entry.id, { summary: event.target.value }))} /></label>
      </div>
      <div className="description-editor"><h4>Job description</h4>{entry.description.map((bullet, bulletIndex) => <div className="description-bullet" key={bulletIndex}><span aria-hidden="true">•</span><textarea rows={2} maxLength={2000} aria-label={`Description bullet ${bulletIndex + 1} for work experience ${index + 1}`} value={bullet} onChange={(event) => onChange(replaceEntry(value, entry.id, { description: entry.description.map((item, itemIndex) => itemIndex === bulletIndex ? event.target.value : item) }))} /><button type="button" className="remove-entry" aria-label={`Remove description bullet ${bulletIndex + 1} from work experience ${index + 1}`} onClick={() => onChange(replaceEntry(value, entry.id, { description: entry.description.filter((_, itemIndex) => itemIndex !== bulletIndex) }))}>×</button></div>)}<button type="button" className="button quiet" disabled={entry.description.length >= 100} onClick={() => onChange(replaceEntry(value, entry.id, { description: [...entry.description, ''] }))}>＋ Bullet point</button></div>
    </section>)}
    <button type="button" className="button secondary" disabled={value.length >= 100} onClick={() => onChange([...value, workExperienceSchema.parse({ id: crypto.randomUUID() })])}>＋ Add work experience</button>
  </div>;
}
