import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { deleteApplication, getResumeUrl, listApplications, loadPreferences, loadProfile, savePreferences, saveProfile, saveResume, updateApplication, type ApplicationRecord } from './data';
import { emptyProfile, PROFILE_FIELDS, PROFILE_SECTIONS, resumeProfileSchema, type ProfileField, type ResumeProfile } from './profile';
import { emptyPreferences, EMPLOYMENT_OVERVIEW_KEYS, PREFERENCE_FIELDS, PREFERENCE_GROUPS, preferenceAnswer, preferencesSchema, type AnswerKey, type Preferences } from './preferences';
import { ProfileSection } from './ProfileSection';
import { ProfileEditor } from './ProfileEditor';
import { ProfileFieldsEditor } from './ProfileFieldsEditor';
import { WorkExperienceEditor } from './WorkExperienceEditor';
import { ExperienceTimeline } from './ExperienceTimeline';
import { findProfileValue } from './fields';

export function Dashboard({ user, onLogout }: { user: User; onLogout: () => Promise<void> }) {
  const [profile, setProfile] = useState<ResumeProfile>(emptyProfile());
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [preferences, setPreferences] = useState<Preferences>(emptyPreferences());
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftProfile, setDraftProfile] = useState<ResumeProfile>(emptyProfile());
  const [draftPreferences, setDraftPreferences] = useState<Preferences>(emptyPreferences());
  const [editorError, setEditorError] = useState('');
  const [activeSection, setActiveSection] = useState('personal');

  const openEditor = (section: string) => {
    if (!loaded || working) return;
    setDraftProfile(resumeProfileSchema.parse(profile));
    setDraftPreferences(preferencesSchema.parse(preferences));
    setEditorError(''); setEditing(section);
  };

  useEffect(() => {
    let cancelled = false;
    setLoaded(false); setLoading(true); setEditing(null);
    Promise.all([loadProfile(user.uid), listApplications(user.uid), loadPreferences(user.uid)]).then(([savedProfile, records, savedPreferences]) => {
      if (cancelled) return;
      setProfile(savedProfile ?? emptyProfile());
      setApplications(records);
      setPreferences(savedPreferences ?? emptyPreferences());
      setLoaded(true);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load your profile.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user.uid]);

  const chooseResume = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setError(''); setMessage('');
    setFile(null); event.currentTarget.value = '';
    if ((selected.type && selected.type !== 'application/pdf') || !selected.name.toLowerCase().endsWith('.pdf')) { setError('Choose a PDF file.'); return; }
    if (selected.size > 10 * 1024 * 1024) { setError('PDFs must be 10 MB or smaller.'); return; }
    setFile(selected);
    setWorking(true);
    try {
      const { extractProfile } = await import('./resumeParser');
      const extracted = await extractProfile(selected);
      setProfile((current) => ({ ...extracted, resumePath: current.resumePath }));
      setMessage('Resume parsed in this browser. Review every field and fill in anything that was missed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read this PDF.'); }
    finally { setWorking(false); }
  };

  const updateField = (key: ProfileField, rawValue: string) => {
    const field = PROFILE_FIELDS.find((item) => item.key === key);
    const value = field?.list ? rawValue.split(field.key === 'skills' ? /\n|,/ : /\n/).map((item) => item.trim()).filter(Boolean) : rawValue;
    setDraftProfile((current) => ({ ...current, [key]: value }));
  };

  const updatePreference = <K extends AnswerKey>(key: K, value: Preferences[K]) => {
    setDraftPreferences((current) => ({ ...current, [key]: value }));
  };

  const saveEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking(true); setEditorError(''); setMessage('');
    try {
      if (editing === 'employment') {
        const saved = await savePreferences(preferencesSchema.parse(draftPreferences), user.uid);
        setPreferences(saved); setMessage('Standing answers saved. Scanned forms will use them from now on.');
      } else {
        const validated = resumeProfileSchema.safeParse(draftProfile);
        if (!validated.success) {
          const issue = validated.error.issues[0];
          const row = issue.path[0] === 'workExperience' && typeof issue.path[1] === 'number' ? `Work experience ${issue.path[1] + 1}: ` : '';
          setEditorError(`${row}${issue.message}`); return;
        }
        const currentRole = editing === 'experience' ? validated.data.workExperience.find((entry) => entry.current) : undefined;
        const reviewed = currentRole ? { ...validated.data, currentTitle: currentRole.jobTitle, currentCompany: currentRole.company } : validated.data;
        const saved = file ? await saveResume(file, reviewed, user.uid) : await saveProfile(reviewed, user.uid);
        setProfile(saved); setFile(null); setMessage('Your reviewed profile is saved. Future scans will use these details.');
      }
      setEditing(null);
    } catch (reason) { setEditorError(reason instanceof Error ? reason.message : 'Could not save these details. Your draft is still here.'); }
    finally { setWorking(false); }
  };

  useEffect(() => {
    if (!loaded) return;
    const target = window.location.hash.slice(1);
    if (target.startsWith('sa-') || target === 'standing-answers') {
      setDraftProfile(resumeProfileSchema.parse(profile)); setDraftPreferences(preferencesSchema.parse(preferences)); setEditing('employment');
    } else if (target) document.getElementById(target)?.scrollIntoView({ block: 'start' });
    // Deep links apply once when data loads; normal editor actions manage later drafts.
  }, [loaded]);

  useEffect(() => {
    if (editing !== 'employment') return;
    const target = window.location.hash.slice(1);
    if (!target.startsWith('sa-')) return;
    const field = document.getElementById(target);
    const group = field?.closest('details');
    if (group) group.open = true;
    field?.scrollIntoView?.({ block: 'center' });
  }, [editing]);

  useEffect(() => {
    if (!loaded || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: '-65px 0px -65% 0px' });
    document.querySelectorAll('.profile-section').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [loaded]);

  const save = async () => {
    setWorking(true); setError(''); setMessage('');
    try {
      const saved = file ? await saveResume(file, profile, user.uid) : await saveProfile(profile, user.uid);
      setProfile(saved); setFile(null); setMessage('Your reviewed profile is saved to Firebase.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save your profile. Check your Firebase configuration and rules.'); }
    finally { setWorking(false); }
  };

  const openResume = async () => {
    try { window.open(await getResumeUrl(profile.resumePath), '_blank', 'noopener,noreferrer'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open the saved resume.'); }
  };

  const changeStatus = async (application: ApplicationRecord, status: ApplicationRecord['status']) => {
    try {
      await updateApplication(user.uid, application.id, status);
      setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update this application.'); }
  };

  const removeApplication = async (application: ApplicationRecord) => {
    if (!window.confirm(`Delete the ${application.role || application.company || 'application'} record?`)) return;
    try {
      await deleteApplication(user.uid, application.id);
      setApplications((current) => current.filter((item) => item.id !== application.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this application.'); }
  };

  const section = PROFILE_SECTIONS.find((item) => item.id === editing);
  const sectionCompletion = [Boolean(profile.fullName && profile.email), Boolean(profile.university), profile.workExperience.some((entry) => entry.jobTitle && entry.company), Boolean(profile.skills.length), Boolean(preferences.workAuthorized && preferences.sponsorshipNowOrFuture)];
  const completeSections = sectionCompletion.filter(Boolean).length;

  return <div className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <a className="brand" href="dashboard.html"><span className="brand-mark small">A</span><span>apply<span className="brand-accent">ai</span></span></a>
      <p className="sidebar-label">YOUR WORKSPACE</p>
      <nav aria-label="Dashboard navigation"><a className="sidebar-link selected" href="#personal" onClick={() => setActiveSection('personal')}><span aria-hidden="true">◉</span> My profile</a><a className="sidebar-link" href="#applications"><span aria-hidden="true">▤</span> Applications <span className="sidebar-count">{applications.length}</span></a><a className="sidebar-link" href="#resume"><span aria-hidden="true">▧</span> My resume</a></nav>
      <div className="sidebar-bottom"><div className="sidebar-account"><div className="avatar">{(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}</div><div><strong>{user.displayName || 'Your account'}</strong><span>{user.email}</span></div></div><button className="button quiet" onClick={onLogout}>Sign out</button></div>
    </aside>
    <div className="dashboard-workspace">
      <header className="topbar"><div><p className="eyebrow">YOUR APPLICATION HOME</p><h1>Profile</h1></div><div className="profile-status"><span className={`status-dot ${profile.updatedAt && !file ? 'complete' : ''}`}></span>{file ? 'Resume ready for review' : profile.updatedAt ? 'Profile saved' : 'Make yourself at home'}</div></header>
      <main className="dashboard-content">
        <div className="dashboard-main">
          <p className="profile-privacy"><span aria-hidden="true">◈</span> One profile for every application. You choose what gets shared.</p>
          {error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice success" role="status">{message}</div>}
          <div className="profile-overview card">
            <nav className="profile-tabs" aria-label="Profile sections">{PROFILE_SECTIONS.map((item) => <a key={item.id} href={`#${item.id}`} className={activeSection === item.id ? 'active' : ''} aria-current={activeSection === item.id ? 'location' : undefined} onClick={() => setActiveSection(item.id)}>{item.title}</a>)}</nav>
            {loading ? <div className="skeleton">Loading your profile…</div> : <>
              <ProfileSection id="personal" title="Personal" heading={<span className="personal-name">{profile.fullName || 'Make your profile yours.'}</span>} onEdit={() => openEditor('personal')} disabled={!loaded || working}>
                <div className="personal-contact-chips">
                  {[{ icon: '⌖', value: [profile.streetAddress, profile.city, profile.state, profile.postalCode, profile.country].filter(Boolean).join(', ') }, { icon: '✉', value: profile.email }, { icon: '☎', value: profile.phone }].filter((item) => item.value).map((item) => <span className="profile-chip" key={item.icon}><span aria-hidden="true">{item.icon}</span>{item.value}</span>)}
                  {profile.linkedin && <a className="profile-chip" href={findProfileValue('LinkedIn', profile)} target="_blank" rel="noreferrer"><span aria-hidden="true">in</span>{profile.linkedin}</a>}
                  {profile.portfolio && <a className="profile-chip" href={findProfileValue('Portfolio', profile)} target="_blank" rel="noreferrer"><span aria-hidden="true">↗</span>{profile.portfolio}</a>}
                </div>
                {profile.targetRole && <p className="target-role">Looking for <strong>{profile.targetRole}</strong></p>}
                {!profile.email && !profile.phone && <p className="profile-empty">Add your contact details, location, and professional links.</p>}
              </ProfileSection>
              <ProfileSection id="education" title="Education" onEdit={() => openEditor('education')} disabled={!loaded || working}>
                {profile.university || profile.degree || profile.major ? <div className="experience-timeline"><article className="timeline-entry"><h3>{profile.university || 'School not provided'}</h3><p className="timeline-role">{[profile.degree, profile.major].filter(Boolean).join(' · ') || 'Degree not provided'}</p>{profile.graduationDate && <p className="timeline-meta">Graduation: {profile.graduationDate}</p>}{profile.gpa && <p className="timeline-meta">GPA: {profile.gpa}</p>}</article></div> : <p className="profile-empty">Add your school, degree, major, graduation date, and GPA.</p>}
              </ProfileSection>
              <ProfileSection id="experience" title="Work Experience" onEdit={() => openEditor('experience')} disabled={!loaded || working}><ExperienceTimeline entries={profile.workExperience} /></ProfileSection>
              <ProfileSection id="skills" title="Skills" onEdit={() => openEditor('skills')} disabled={!loaded || working}>
                {profile.skills.length ? <div className="skills-chips">{profile.skills.map((skill, index) => <span className="skill-chip" key={`${skill}-${index}`}>{skill}</span>)}</div> : <p className="profile-empty">Add the skills you want to bring to your next role.</p>}
                {(['projects', 'achievements'] as const).map((key) => profile[key].length > 0 && <div className="profile-supporting-details" key={key}><h3>{key === 'projects' ? 'Projects' : 'Achievements'}</h3><ul>{profile[key].map((item, index) => <li key={index}>{item}</li>)}</ul></div>)}
              </ProfileSection>
              <div id="standing-answers"><ProfileSection id="employment" title="Equal Employment" onEdit={() => openEditor('employment')} disabled={!loaded || working}>
                <p className="employment-intro">Common application questions, answered once. Voluntary answers stay optional.</p>
                <dl className="employment-questions">{EMPLOYMENT_OVERVIEW_KEYS.map((key) => <div className="employment-question" key={key}><dt>{PREFERENCE_FIELDS.find((field) => field.key === key)!.label}</dt><dd><span className={`answer-chip ${preferences[key] ? '' : 'not-provided'}`}>{preferenceAnswer(preferences[key]) || 'Not provided'}</span></dd></div>)}</dl>
                <p className="voluntary-status">Voluntary answer sharing: <strong>{preferences.eeoOptIn ? 'Enabled by you' : 'Off'}</strong></p>
              </ProfileSection></div>
            </>}
          </div>
      <section className="card applications-card" id="applications"><div className="section-heading"><div><p className="eyebrow">YOUR SEARCH</p><h2>Applications</h2></div><span className="field-count">{applications.length} saved</span></div>
        {loading ? <div className="skeleton">Loading applications…</div> : applications.length === 0 ? <p className="empty-state">When you confirm that you’ve applied, your application will show up here.</p> : <div className="application-list">{applications.map((application) => <article className="application-row" key={application.id}><div><strong>{application.role || 'Role not specified'}</strong><span>{application.company || application.url}</span><a href={application.url} target="_blank" rel="noreferrer">Open application ↗</a></div><select aria-label={`Update status for ${application.role || application.company}`} value={application.status} onChange={(event) => changeStatus(application, event.target.value as ApplicationRecord['status'])}><option value="submitted">Submitted</option><option value="in_progress">In progress</option><option value="interview">Interview</option><option value="rejected">Rejected</option><option value="offer">Offer</option></select><time>{application.createdAt ? new Date(application.createdAt).toLocaleDateString() : ''}</time><button className="text-button delete-button" onClick={() => removeApplication(application)}>Delete</button></article>)}</div>}
      </section>
        </div>
        <aside className="dashboard-rail" aria-label="Profile tools">
          <section className="profile-readiness"><span className="readiness-icon" aria-hidden="true">✦</span><h2>A little setup. A lot less repetition.</h2><p>Keep your details ready so you can focus on your next opportunity.</p><div className="readiness-progress" role="progressbar" aria-label="Profile sections completed" aria-valuemin={0} aria-valuemax={5} aria-valuenow={completeSections}><span style={{ width: `${completeSections * 20}%` }} /></div><p className="readiness-count">{completeSections} of 5 sections ready</p><button className="button primary wide" disabled={!loaded || working} onClick={() => openEditor(PROFILE_SECTIONS[completeSections === 5 ? 0 : sectionCompletion.findIndex((complete) => !complete)].id)}>{completeSections === 5 ? 'Review my profile' : 'Complete my profile'}</button></section>
          <section className="card resume-card" id="resume"><div className="section-heading"><h2>Your resume</h2><span className="icon-badge" aria-hidden="true">↥</span></div>
            <label className="upload-zone"><input type="file" accept="application/pdf,.pdf" disabled={!loaded || working} onChange={chooseResume} /><span className="upload-icon" aria-hidden="true">↑</span><strong>{working ? 'Working…' : file ? file.name : 'Upload a PDF resume'}</strong><span className="muted small-text">Click to browse · up to 10 MB</span></label>
            {profile.resumePath && !file && <button className="text-button" onClick={openResume}>Open current resume ↗</button>}
            {file && <><p className="field-note">Review the imported details before saving.</p><button className="button primary wide" onClick={save} disabled={working || !loaded}>Save imported resume</button></>}
            <p className="privacy-note">Text extraction happens in your browser. Your PDF is uploaded only when you save.</p>
          </section>
          <section className="card profile-shortcuts"><button onClick={() => document.getElementById('resume')?.scrollIntoView({ block: 'center' })}>Manage my resume <span aria-hidden="true">›</span></button><button disabled={!loaded || working} onClick={() => openEditor('personal')}>Update LinkedIn & portfolio <span aria-hidden="true">›</span></button><p>Your saved details are the source for future autofill answers.</p></section>
        </aside>
      </main>
    </div>
    {editing && section && <ProfileEditor title={section.title} busy={working} error={editorError} onClose={() => setEditing(null)} onSave={saveEditor}>
      {editing === 'experience' ? <WorkExperienceEditor value={draftProfile.workExperience} onChange={(entries) => setDraftProfile((current) => ({ ...current, workExperience: entries }))} />
        : editing === 'employment' ? <div className="standing-groups">{PREFERENCE_GROUPS.map((group) => <details className="standing-group" key={group.id} open={group.id === 'work-eligibility' || group.id === 'voluntary'}><summary><strong>{group.title}</strong><span className="field-count">{group.fields.filter(({ key }) => String(draftPreferences[key]).trim()).length}/{group.fields.length}</span></summary><div className="field-grid">{group.fields.map((field) => <label className={`form-field ${field.multiline ? 'span-two' : ''}`} key={field.key} id={`sa-${field.key}`}><span>{field.label}</span>{field.choices ? <select value={draftPreferences[field.key]} onChange={(event) => updatePreference(field.key, event.target.value)}><option value="">Not set</option>{field.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select> : field.multiline ? <textarea rows={3} value={draftPreferences[field.key]} onChange={(event) => updatePreference(field.key, event.target.value)} /> : <input value={draftPreferences[field.key]} onChange={(event) => updatePreference(field.key, event.target.value)} />}{field.hint && <small className="field-note">{field.hint}</small>}</label>)}</div>{group.id === 'voluntary' && <label className="cloud-consent"><input type="checkbox" checked={draftPreferences.eeoOptIn} onChange={(event) => setDraftPreferences((current) => ({ ...current, eeoOptIn: event.target.checked }))} /> Use my voluntary answers when forms ask. Sharing stays off unless I enable this.</label>}</details>)}</div>
        : <ProfileFieldsEditor fields={section.fields} profile={draftProfile} onChange={updateField} />}
      <div className="editor-footer"><span className="field-note">Changes are saved only when you choose Update.</span><button type="button" className="button quiet" disabled={working} onClick={() => setEditing(null)}>Cancel</button></div>
    </ProfileEditor>}
  </div>;
}
