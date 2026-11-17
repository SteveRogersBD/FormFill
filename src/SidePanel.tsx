import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { findProfileValue, isCoverLetterField, isSensitiveField } from './fields';
import { listApplications, loadProfile, saveApplication, type ApplicationRecord } from './data';
import { emptyProfile, type ResumeProfile } from './profile';
import { firebaseAppCheckReady } from './firebase';
import type { ApplicationScan } from './applicationPage';

async function scanActivePage(): Promise<ApplicationScan> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error('Open a supported job application page in a regular browser tab first.');
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'APPLYAI_SCAN_FIELDS' }) as ApplicationScan;
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(tab.id, { type: 'APPLYAI_SCAN_FIELDS' }) as ApplicationScan;
  }
}

export function SidePanel({ user, onLogout }: { user: User; onLogout: () => Promise<void> }) {
  const [profile, setProfile] = useState<ResumeProfile>(emptyProfile());
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [scan, setScan] = useState<ApplicationScan | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filled, setFilled] = useState(false);
  const [cloudConsent, setCloudConsent] = useState(false);
  const [inferenceSource, setInferenceSource] = useState('');
  const [coverLetterCloudConsent, setCoverLetterCloudConsent] = useState(false);
  const [jobDescription, setJobDescription] = useState('');
  const [coverLetterDraft, setCoverLetterDraft] = useState('');
  const [coverLetterSource, setCoverLetterSource] = useState('');

  useEffect(() => {
    Promise.all([loadProfile(user.uid), listApplications(user.uid)]).then(([savedProfile, records]) => {
      setProfile(savedProfile ?? emptyProfile()); setApplications(records);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load your profile.')).finally(() => setLoading(false));
  }, [user.uid]);

  const suggestions = useMemo(() => scan?.fields.map((field) => ({ field, suggested: findProfileValue(field.label, profile) ?? '' })) ?? [], [scan, profile]);
  const coverLetterField = scan?.fields.find((field) => isCoverLetterField(field.label) && ['text', 'textarea'].includes(field.type));
  const scanPage = async () => {
    setBusy(true); setError(''); setNotice(''); setFilled(false);
    try {
      const result = await scanActivePage(); setScan(result);
      setCompany(result.company || (result.platform === 'greenhouse' ? '' : new URL(result.url).hostname.replace(/^www\./, '').split('.')[0] ?? ''));
      setRole(result.role || result.title);
      setValues(Object.fromEntries(result.fields.map((field) => [field.id, findProfileValue(field.label, profile) ?? ''])));
      setJobDescription(''); setCoverLetterDraft(''); setCoverLetterSource(''); setCoverLetterCloudConsent(false);
      const pageType = result.platform === 'greenhouse' ? ' on this Greenhouse application' : '';
      setNotice(result.fields.length ? `Found ${result.fields.length} fields${pageType}. Review the suggestions before filling.` : 'No supported form fields were found on this page.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not inspect this page.'); }
    finally { setBusy(false); }
  };

  const fillPage = async () => {
    if (!scan) return;
    setBusy(true); setError('');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('The application tab is no longer available.');
      const safeValues = Object.fromEntries(Object.entries(values).filter(([id, value]) => {
        const field = scan.fields.find((candidate) => candidate.id === id);
        return Boolean(value.trim()) && (!field || !isSensitiveField(field.label) || confirmed[id]);
      }));
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'APPLYAI_FILL_FIELDS', values: safeValues }) as { filled: number };
      setFilled(result.filled > 0);
      setNotice(`Filled ${result.filled} field${result.filled === 1 ? '' : 's'}. Check the application before continuing.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not fill this page. Try scanning it again.'); }
    finally { setBusy(false); }
  };

  const suggestWithAI = async (cloud: boolean) => {
    if (!scan) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { suggestCloudAnswers, suggestOnDeviceAnswers } = await import('./ai');
      const result = cloud
        ? await suggestCloudAnswers(scan.fields, profile)
        : await suggestOnDeviceAnswers(scan.fields, profile);
      setValues((current) => ({ ...result.answers, ...Object.fromEntries(Object.entries(current).filter(([, value]) => value.trim())) }));
      setInferenceSource(result.source === 'ON_DEVICE' ? 'On-device AI' : 'Cloud AI (approved)');
      setNotice('AI suggestions are ready. Check and edit each answer before filling the page.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI suggestions are unavailable. You can still use exact profile matches.');
    } finally { setBusy(false); }
  };

  const createCoverLetterDraft = async (cloud: boolean) => {
    if (!coverLetterField || !jobDescription.trim() || (cloud && (!coverLetterCloudConsent || !firebaseAppCheckReady))) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { draftCoverLetterInCloud, draftCoverLetterOnDevice } = await import('./ai');
      const result = cloud
        ? await draftCoverLetterInCloud(profile, jobDescription)
        : await draftCoverLetterOnDevice(profile, jobDescription);
      setCoverLetterDraft(result.letter);
      setCoverLetterSource(result.source === 'ON_DEVICE' ? 'On-device AI' : 'Cloud AI (approved)');
      setNotice('Draft ready. Review and edit it before using it in the application.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not draft a cover letter. You can still write your answer manually.');
    } finally { setBusy(false); }
  };

  const useCoverLetterDraft = () => {
    if (!coverLetterField || !coverLetterDraft.trim()) return;
    setValues((current) => ({ ...current, [coverLetterField.id]: coverLetterDraft.trim() }));
    setNotice('Draft added to the cover-letter answer. Review it, then fill the application.');
  };

  const confirmSubmitted = async () => {
    if (!scan) return;
    setBusy(true); setError('');
    try {
      const url = new URL(scan.url);
      await saveApplication(user.uid, { company: company.trim(), role: role.trim(), url: scan.url, status: 'submitted' });
      setApplications(await listApplications(user.uid)); setNotice(`Saved ${role.trim() || 'this application'} as submitted.`); setFilled(false);
      setCompany(url.hostname); setRole('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this application.'); }
    finally { setBusy(false); }
  };

  return <main className="panel-shell">
    <header className="panel-header"><a className="brand" href="dashboard.html" target="_blank"><span className="brand-mark small">A</span><span>apply<span className="brand-accent">ai</span></span></a><a className="button quiet compact" href="dashboard.html" target="_blank">{profile.updatedAt ? 'Edit profile' : 'Set up profile'}</a><button className="button quiet compact" onClick={onLogout}>Sign out</button></header>
    <section className="panel-intro"><p className="eyebrow">APPLICATION ASSISTANT</p><h1>Let’s fill this out.</h1><p className="muted">Your profile stays yours. You choose what gets filled.</p></section>
    {error && <div className="notice error compact-notice" role="alert">{error}</div>}{notice && <div className="notice success compact-notice" role="status">{notice}</div>}
    {!loading && !profile.updatedAt && <div className="notice info compact-notice">Set up your resume profile before scanning. Use <strong>Set up profile</strong> above.</div>}
    <button className="button primary wide scan-button" onClick={scanPage} disabled={loading || busy || !profile.updatedAt}>{busy ? 'Working…' : scan ? 'Scan page again' : 'Scan this application'}</button>
    {suggestions.length > 0 && <section className="panel-section"><div className="panel-section-heading"><h2>Review answers</h2><span>{suggestions.length} fields</span></div>{inferenceSource && <div className="inference-badge">✦ {inferenceSource}</div>}<div className="answer-list">{suggestions.map(({ field, suggested }) => {
      const sensitive = isSensitiveField(field.label);
      const unsupported = ['file', 'password', 'date', 'number'].includes(field.type);
      return <div className="answer-row" key={field.id}><label className="answer-label" htmlFor={`answer-${field.id}`}>{field.label || 'Unlabeled field'}{field.required && <i>Required</i>}</label>
        {field.type === 'radio' && field.options.length > 0 ? <select id={`answer-${field.id}`} value={values[field.id] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}><option value="">Choose an option</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
          : field.type === 'checkbox' ? <select id={`answer-${field.id}`} value={values[field.id] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}><option value="">Leave unchanged</option><option value="true">Check this box</option></select>
          : <input id={`answer-${field.id}`} value={values[field.id] ?? ''} disabled={unsupported} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} placeholder={unsupported ? 'Review on the page' : suggested ? 'Suggested from your profile' : 'No saved answer'} />}
        {sensitive && <label className="confirm-sensitive"><input type="checkbox" checked={Boolean(confirmed[field.id])} onChange={(event) => setConfirmed((current) => ({ ...current, [field.id]: event.target.checked }))} /> I reviewed this sensitive answer.</label>}
        {unsupported && <span className="field-hint">This field type needs your attention on the page.</span>}
        {!suggested && !values[field.id] && !unsupported && !sensitive && <span className="field-hint">No matching profile detail. It will stay empty.</span>}
      </div>;
    })}</div><button className="button secondary wide ai-button" onClick={() => suggestWithAI(false)} disabled={busy}>✦ Suggest with on-device AI</button><label className="cloud-consent"><input type="checkbox" checked={cloudConsent} onChange={(event) => setCloudConsent(event.target.checked)} /> I approve sending this form’s field labels and relevant profile details to Firebase AI Logic for cloud suggestions.</label>{!firebaseAppCheckReady && <p className="field-hint">Cloud AI needs a Firebase App Check site key in your local configuration.</p>}<button className="text-button cloud-button" onClick={() => suggestWithAI(true)} disabled={busy || !cloudConsent || !firebaseAppCheckReady}>Use cloud AI with my approval ↗</button><button className="button primary wide fill-button" onClick={fillPage} disabled={busy}>{busy ? 'Working…' : 'Fill reviewed answers'}</button><p className="fine-print center">ApplyAI never submits the application for you.</p></section>}
    {filled && <section className="confirm-card"><p className="eyebrow">AFTER YOU SUBMIT</p><h2>Applied? Save it here.</h2><label className="form-field"><span>Company</span><input value={company} onChange={(event) => setCompany(event.target.value)} /></label><label className="form-field"><span>Role</span><input value={role} onChange={(event) => setRole(event.target.value)} /></label><button className="button secondary wide" onClick={confirmSubmitted} disabled={busy}>I submitted this application</button></section>}
    <section className="panel-section recent-applications"><div className="panel-section-heading"><h2>Recent applications</h2><a href="dashboard.html" target="_blank">View all</a></div>{applications.length === 0 ? <p className="empty-state">Your confirmed applications will appear here.</p> : applications.slice(0, 3).map((application) => <div className="mini-application" key={application.id}><span>{application.role || application.company || 'Application'}</span><i>{application.status.replace('_', ' ')}</i></div>)}</section>
  </main>;
}
