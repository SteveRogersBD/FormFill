import { useEffect, useState, type ChangeEvent } from 'react';
import type { User } from 'firebase/auth';
import { deleteApplication, getResumeUrl, listApplications, loadProfile, saveProfile, saveResume, updateApplication, type ApplicationRecord } from './data';
import { emptyProfile, PROFILE_FIELDS, type ProfileField, type ResumeProfile } from './profile';

export function Dashboard({ user, onLogout }: { user: User; onLogout: () => Promise<void> }) {
  const [profile, setProfile] = useState<ResumeProfile>(emptyProfile());
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([loadProfile(user.uid), listApplications(user.uid)]).then(([savedProfile, records]) => {
      setProfile(savedProfile ?? emptyProfile());
      setApplications(records);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load your profile.')).finally(() => setLoading(false));
  }, [user.uid]);

  const chooseResume = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setError(''); setMessage('');
    if (selected.type !== 'application/pdf' || !selected.name.toLowerCase().endsWith('.pdf')) { setError('Choose a PDF file.'); return; }
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
    setProfile((current) => ({ ...current, [key]: value }));
  };

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

  return <div className="dashboard-shell">
    <header className="topbar">
      <a className="brand" href="dashboard.html"><span className="brand-mark small">A</span><span>apply<span className="brand-accent">ai</span></span></a>
      <div className="user-menu"><div className="avatar">{(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}</div><span className="user-name">{user.displayName || user.email}</span><button className="button quiet" onClick={onLogout}>Sign out</button></div>
    </header>
    <main className="dashboard-content">
      <section className="welcome-row"><div><p className="eyebrow">YOUR PROFILE</p><h1>One profile. Less repetition.</h1><p className="muted">Upload your resume, check what we found, and make it yours.</p></div><div className="profile-status"><span className={`status-dot ${profile.updatedAt ? 'complete' : ''}`}></span>{profile.updatedAt ? 'Profile saved' : 'Profile not saved'}</div></section>
      {error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice success" role="status">{message}</div>}
      <div className="dashboard-grid">
        <section className="card resume-card"><div className="section-heading"><div><p className="eyebrow">01 · START HERE</p><h2>Your resume</h2></div><span className="icon-badge">↥</span></div>
          <label className="upload-zone"><input type="file" accept="application/pdf,.pdf" onChange={chooseResume} /><span className="upload-icon">↑</span><strong>{working ? 'Reading your resume…' : file ? file.name : 'Drop in your PDF resume'}</strong><span className="muted small-text">or click to browse · PDF up to 10 MB</span></label>
          {profile.resumePath && !file && <button className="text-button" onClick={openResume}>↗ Open current resume</button>}
          <p className="privacy-note"><span>◈</span> Text extraction happens in your browser. Your PDF is uploaded only when you save.</p>
        </section>
        <section className="card profile-card"><div className="section-heading"><div><p className="eyebrow">02 · REVIEW & EDIT</p><h2>Your details</h2></div><span className="field-count">{PROFILE_FIELDS.filter(({ key }) => profile[key]?.length).length}/{PROFILE_FIELDS.length} filled</span></div>
          {loading ? <div className="skeleton">Loading saved details…</div> : <div className="field-grid">{PROFILE_FIELDS.map(({ key, label, multiline, list }) => {
            const value = profile[key];
            const text = Array.isArray(value) ? value.join('\n') : value;
            return <label className={`form-field ${multiline ? 'span-two' : ''}`} key={key}><span>{label}</span>{multiline ? <textarea rows={key === 'skills' ? 3 : 4} value={text} onChange={(event) => updateField(key, event.target.value)} placeholder={list ? 'One item per line' : ''} /> : <input value={text} onChange={(event) => updateField(key, event.target.value)} placeholder={`Add ${label.toLowerCase()}`} />}</label>;
          })}</div>}
          <div className="save-row"><span className="muted tiny-text">You can edit any detail before saving.</span><button className="button primary" onClick={save} disabled={working || loading}>{working ? 'Saving…' : 'Save profile'}</button></div>
        </section>
      </div>
      <section className="card applications-card"><div className="section-heading"><div><p className="eyebrow">YOUR SEARCH</p><h2>Applications</h2></div><span className="field-count">{applications.length} saved</span></div>
        {loading ? <div className="skeleton">Loading applications…</div> : applications.length === 0 ? <p className="empty-state">When you confirm that you’ve applied, your application will show up here.</p> : <div className="application-list">{applications.map((application) => <article className="application-row" key={application.id}><div><strong>{application.role || 'Role not specified'}</strong><span>{application.company || application.url}</span><a href={application.url} target="_blank" rel="noreferrer">Open application ↗</a></div><select aria-label={`Update status for ${application.role || application.company}`} value={application.status} onChange={(event) => changeStatus(application, event.target.value as ApplicationRecord['status'])}><option value="submitted">Submitted</option><option value="in_progress">In progress</option><option value="interview">Interview</option><option value="rejected">Rejected</option><option value="offer">Offer</option></select><time>{application.createdAt ? new Date(application.createdAt).toLocaleDateString() : ''}</time><button className="text-button delete-button" onClick={() => removeApplication(application)}>Delete</button></article>)}</div>}
      </section>
    </main>
  </div>;
}
