import type { WorkExperience } from './profile';

export function ExperienceTimeline({ entries }: { entries: WorkExperience[] }) {
  if (!entries.length) return <p className="profile-empty">Add your experience to keep every role ready for applications.</p>;
  return <div className="experience-timeline">{entries.map((entry) => <article className="timeline-entry" key={entry.id}>
    <p className="timeline-date">{entry.startDate || 'Start date not provided'} <span aria-hidden="true">↔</span> {entry.current ? 'Present' : entry.endDate || 'End date not provided'}</p>
    <h3>{entry.company || 'Imported work experience'}</h3>
    {entry.jobTitle && <p className="timeline-role">{entry.jobTitle}</p>}
    {(entry.jobType || entry.location) && <p className="timeline-meta">{[entry.jobType, entry.location].filter(Boolean).join(' · ')}</p>}
    {entry.summary && <p className="timeline-summary">{entry.summary}</p>}
    {!!entry.description.filter((line) => line.trim()).length && <ul>{entry.description.filter((line) => line.trim()).map((line, index) => <li key={index}>{line}</li>)}</ul>}
    {!entry.company && !entry.jobTitle && <p className="field-note">Your imported notes are preserved. Edit this entry to add its role and employer.</p>}
  </article>)}</div>;
}
