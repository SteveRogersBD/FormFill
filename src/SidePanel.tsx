import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { findProfileValue, isCoverLetterField, isSensitiveField } from './fields';
import { listApplications, loadProfile, saveApplication, updateApplication, type ApplicationRecord } from './data';
import { emptyProfile, type ResumeProfile } from './profile';
import { firebaseAppCheckReady } from './firebase';
import { hostPermissionPattern, type ApplicationScan } from './applicationPage';

async function requestSiteAccess(tabId: number, pattern?: string): Promise<'pending' | 'granted' | 'denied'> {
  if (chrome.permissions.addHostAccessRequest) {
    try {
      await chrome.permissions.addHostAccessRequest({ tabId, ...(pattern ? { pattern } : {}) });
      return 'pending';
    } catch { /* Fall back to the direct permission prompt when available. */ }
  }
  if (pattern && await chrome.permissions.request({ origins: [pattern] })) return 'granted';
  return 'denied';
}

async function getActiveApplicationTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabId = tab?.id;
  const url = tab?.url;
  if (typeof tabId !== 'number') throw new Error('Could not find the active Chrome tab. Keep the job application open and try again.');
  if (!url) {
    const access = await requestSiteAccess(tabId);
    if (access === 'pending') throw new Error('Chrome is asking for access to this site. Approve the request on the job page, then scan again.');
    throw new Error('ApplyAI could not read this page address. Allow site access in Chrome, then scan again.');
  }
  if (!/^https?:/.test(url)) throw new Error('Open a job application in a regular HTTP or HTTPS tab before scanning.');
  const pattern = hostPermissionPattern(url);
  if (!await chrome.permissions.contains({ origins: [pattern] })) {
    const access = await requestSiteAccess(tabId, pattern);
    if (access === 'pending') throw new Error('Chrome is asking for access to this site. Approve the request on the job page, then scan again.');
    if (access !== 'granted') throw new Error('ApplyAI needs access to this site to scan it. Allow access in Chrome, then try again.');
  }
  return { ...tab, id: tabId, url };
}

async function scanActivePage(): Promise<ApplicationScan> {
  const tab = await getActiveApplicationTab();
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

  const refreshProfile = useCallback(async () => {
    setLoading(true);
    try {
      const [savedProfile, records] = await Promise.all([loadProfile(user.uid), listApplications(user.uid)]);
      setProfile(savedProfile ?? emptyProfile()); setApplications(records);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load your profile.'); }
    finally { setLoading(false); }
  }, [user.uid]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const suggestions = useMemo(() => scan?.fields.map((field) => ({ field, suggested: findProfileValue(field.label, profile) ?? '' })) ?? [], [scan, profile]);
  const coverLetterField = scan?.fields.find((field) => isCoverLetterField(field.label) && ['text', 'textarea'].includes(field.type));
  const scanPage = async () => {
    setBusy(true); setError(''); setNotice(''); setFilled(false);
    setScan(null); setValues({}); setConfirmed({}); setCloudConsent(false); setInferenceSource('');
    setJobDescription(''); setCoverLetterDraft(''); setCoverLetterSource(''); setCoverLetterCloudConsent(false);
    try {
      const result = await scanActivePage(); setScan(result);
      setCompany(result.company || (result.platform === 'greenhouse' ? '' : new URL(result.url).hostname.replace(/^www\./, '').split('.')[0] ?? ''));
      setRole(result.role || result.title);
      setValues(Object.fromEntries(result.fields.map((field) => [field.id, findProfileValue(field.label, profile) ?? ''])));
      const pageType = result.platform === 'greenhouse' ? ' on this Greenhouse application' : '';
      setNotice(result.fields.length ? `Found ${result.fields.length} fields${pageType}. Review the suggestions before filling.` : 'No supported form fields were found on this page.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not inspect this page.'); }
    finally { setBusy(false); }
  };

  const fillPage = async () => {
    if (!scan) return;
    setBusy(true); setError('');
    try {
      const tab = await getActiveApplicationTab();
      if (tab.url !== scan.url) throw new Error('The active application page changed. Scan it again before filling.');
      const safeValues = Object.fromEntries(Object.entries(values).filter(([id, value]) => {
        const field = scan.fields.find((candidate) => candidate.id === id);
        return field !== undefined && !['file', 'password', 'date', 'number', 'select-multiple'].includes(field.type)
          && Boolean(value.trim()) && (!isSensitiveField(field.label) || confirmed[id]);
      }));
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'APPLYAI_FILL_FIELDS', values: safeValues }) as { filled: number };
      setFilled(result.filled > 0);
      setNotice(`Filled ${result.filled} field${result.filled === 1 ? '' : 's'}. Check the application before continuing.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not fill this page. Try scanning it again.'); }
    finally { setBusy(false); }
  };

  const suggestWithAI = async (cloud: boolean) => {
    if (!scan || (cloud && (!cloudConsent || !firebaseAppCheckReady))) return;
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
      const existing = applications.find((application) => application.url === scan.url);
      if (existing?.status !== 'submitted') {
        if (existing) await updateApplication(user.uid, existing.id, 'submitted');
        else await saveApplication(user.uid, { company: company.trim(), role: role.trim(), url: scan.url, status: 'submitted' });
      }
      setApplications(await listApplications(user.uid)); setNotice(`${existing ? 'Updated' : 'Saved'} ${role.trim() || 'this application'} as submitted.`); setFilled(false);
      setCompany(url.hostname); setRole('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this application.'); }
    finally { setBusy(false); }
  };

  const trackedApplication = scan ? applications.find((application) => application.url === scan.url) : undefined;

  return <main className="panel-shell">
    <header className="panel-header"><a className="brand" href="dashboard.html" target="_blank"><span className="brand-mark small">A</span><span>apply<span className="brand-accent">ai</span></span></a><a className="button quiet compact" href="dashboard.html" target="_blank">{profile.updatedAt ? 'Edit profile' : 'Set up profile'}</a><button className="button quiet compact" onClick={onLogout}>Sign out</button></header>
    <section className="panel-intro"><p className="eyebrow">APPLICATION ASSISTANT</p><h1>Let’s fill this out.</h1><p className="muted">Your profile stays yours. You choose what gets filled.</p></section>
    {error && <div className="notice error compact-notice" role="alert">{error}</div>}{notice && <div className="notice success compact-notice" role="status">{notice}</div>}
    {!loading && !profile.updatedAt && <div className="notice info compact-notice">Set up your resume profile before scanning. Use <strong>Set up profile</strong> above, then <button className="text-button" onClick={refreshProfile}>refresh the profile here</button>.</div>}
    <button className="button primary wide scan-button" onClick={scanPage} disabled={loading || busy || !profile.updatedAt}>{busy ? 'Working…' : scan ? 'Scan page again' : 'Scan this application'}</button>
    {suggestions.length > 0 && <section className="panel-section"><div className="panel-section-heading"><h2>Review answers</h2><span>{suggestions.length} fields</span></div>{inferenceSource && <div className="inference-badge">✦ {inferenceSource}</div>}<div className="answer-list">{suggestions.map(({ field, suggested }) => {
      const sensitive = isSensitiveField(field.label);
      const unsupported = ['file', 'password', 'date', 'number', 'select-multiple'].includes(field.type);
      return <div className="answer-row" key={field.id}><label className="answer-label" htmlFor={`answer-${field.id}`}>{field.label || 'Unlabeled field'}{field.required && <i>Required</i>}</label>
        {['radio', 'select'].includes(field.type) && field.options.length > 0 ? <select id={`answer-${field.id}`} value={values[field.id] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}><option value="">Choose an option</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
          : field.type === 'checkbox' ? <select id={`answer-${field.id}`} value={values[field.id] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}><option value="">Leave unchanged</option><option value="true">Check this box</option></select>
          : field.type === 'textarea' ? <textarea id={`answer-${field.id}`} rows={4} value={values[field.id] ?? ''} disabled={unsupported} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} placeholder={unsupported ? 'Review on the page' : suggested ? 'Suggested from your profile' : 'No saved answer'} />
          : <input id={`answer-${field.id}`} value={values[field.id] ?? ''} disabled={unsupported} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} placeholder={unsupported ? 'Review on the page' : suggested ? 'Suggested from your profile' : 'No saved answer'} />}
        {sensitive && <label className="confirm-sensitive"><input type="checkbox" checked={Boolean(confirmed[field.id])} onChange={(event) => setConfirmed((current) => ({ ...current, [field.id]: event.target.checked }))} /> I reviewed this sensitive answer.</label>}
        {unsupported && <span className="field-hint">This field type needs your attention on the page.</span>}
        {!suggested && !values[field.id] && !unsupported && !sensitive && <span className="field-hint">No matching profile detail. It will stay empty.</span>}
      </div>;
    })}</div><button className="button secondary wide ai-button" onClick={() => suggestWithAI(false)} disabled={busy}>✦ Suggest with on-device AI</button><label className="cloud-consent"><input type="checkbox" checked={cloudConsent} onChange={(event) => setCloudConsent(event.target.checked)} /> I approve sending this form’s field labels and relevant profile details to Firebase AI Logic for cloud suggestions.</label>{!firebaseAppCheckReady && <p className="field-hint">Cloud AI needs a Firebase App Check site key in your local configuration.</p>}<button className="text-button cloud-button" onClick={() => suggestWithAI(true)} disabled={busy || !cloudConsent || !firebaseAppCheckReady}>Use cloud AI with my approval ↗</button><button className="button primary wide fill-button" onClick={fillPage} disabled={busy}>{busy ? 'Working…' : 'Fill reviewed answers'}</button><p className="fine-print center">ApplyAI never submits the application for you.</p></section>}
    {coverLetterField && <section className="panel-section cover-letter-section">
      <div className="panel-section-heading"><h2>Cover letter requested</h2>{coverLetterSource && <span>{coverLetterSource}</span>}</div>
      <p className="field-hint">Paste the job description. The draft uses only your reviewed career details and stays here for you to review.</p>
      <label className="form-field"><span>Job description</span><textarea rows={5} maxLength={12000} value={jobDescription} onChange={(event) => { setJobDescription(event.target.value); setCoverLetterDraft(''); setCoverLetterSource(''); }} placeholder="Paste the job description here" /></label>
      <button className="button secondary wide ai-button" onClick={() => createCoverLetterDraft(false)} disabled={busy || !jobDescription.trim()}>Draft on this device</button>
      <label className="cloud-consent"><input type="checkbox" checked={coverLetterCloudConsent} onChange={(event) => setCoverLetterCloudConsent(event.target.checked)} /> I approve sending the job description and career details from my profile to Firebase AI Logic for a cover letter draft.</label>
      {!firebaseAppCheckReady && <p className="field-hint">Cloud AI needs a Firebase App Check site key in your local configuration.</p>}
      <button className="text-button cloud-button" onClick={() => createCoverLetterDraft(true)} disabled={busy || !jobDescription.trim() || !coverLetterCloudConsent || !firebaseAppCheckReady}>Draft with cloud AI after approval</button>
      {coverLetterDraft && <><label className="form-field"><span>Review and edit the draft</span><textarea rows={8} value={coverLetterDraft} onChange={(event) => setCoverLetterDraft(event.target.value)} /></label><button className="button primary wide" onClick={useCoverLetterDraft} disabled={busy}>Use draft in application field</button></>}
    </section>}
    {scan && <section className="confirm-card"><p className="eyebrow">{filled ? 'AFTER YOU SUBMIT' : 'APPLICATION TRACKING'}</p><h2>{filled ? 'Applied? Save it here.' : 'Submitted this application?'}</h2><label className="form-field"><span>Company</span><input value={company} onChange={(event) => setCompany(event.target.value)} /></label><label className="form-field"><span>Role</span><input value={role} onChange={(event) => setRole(event.target.value)} /></label><button className="button secondary wide" onClick={confirmSubmitted} disabled={busy || trackedApplication?.status === 'submitted'}>{trackedApplication?.status === 'submitted' ? 'Already saved as submitted' : trackedApplication ? 'Mark this application submitted' : 'I submitted this application'}</button></section>}
    <section className="panel-section recent-applications"><div className="panel-section-heading"><h2>Recent applications</h2><a href="dashboard.html" target="_blank">View all</a></div>{applications.length === 0 ? <p className="empty-state">Your confirmed applications will appear here.</p> : applications.slice(0, 3).map((application) => <div className="mini-application" key={application.id}><span>{application.role || application.company || 'Application'}</span><i>{application.status.replace('_', ' ')}</i></div>)}</section>
  </main>;
}
