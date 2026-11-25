import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canPlan, needsConfirmation, savedPlan, type PlannerResult } from './planner';
import type { User } from 'firebase/auth';
import { findProfileValue, isSensitiveField } from './fields';
import { getResumeAttachment, getResumeText, listApplications, loadPreferences, loadProfile, saveApplication, updateApplication, type ApplicationRecord } from './data';
import { emptyProfile, PROFILE_FIELDS, type ResumeProfile } from './profile';
import { emptyPreferences, PREFERENCE_FIELDS, type Preferences } from './preferences';
import { matchQuestion, questionAnswer } from './questions';
import { firebaseAppCheckReady } from './firebase';
import { completeJobContext, hostPermissionPattern, type ApplicationScan } from './applicationPage';
import { applicationReadiness, clearWorkspace, loadWorkspace, saveWorkspace } from './applicationWorkspace';

async function getActiveApplicationTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabId = tab?.id;
  if (typeof tabId !== 'number') throw new Error('Could not find the active Chrome tab. Keep the job application open and try again.');
  const { applyAiActiveTab } = await chrome.storage.session.get('applyAiActiveTab');
  const actionContext = applyAiActiveTab as { tabId?: number; origin?: string } | undefined;
  const url = tab.url || (actionContext?.tabId === tabId ? actionContext.origin : undefined);
  if (!url) throw new Error('ApplyAI could not read this page address. Click the ApplyAI toolbar icon while this job page is active, then scan again.');
  if (!/^https?:/.test(url)) throw new Error('Open a job application in a regular HTTP or HTTPS tab before scanning.');
  const pattern = hostPermissionPattern(url);
  return { ...tab, id: tabId, url, pattern, hasSiteAccess: await chrome.permissions.contains({ origins: [pattern] }) };
}

async function scanFrame(tabId: number, frameId: number): Promise<ApplicationScan> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'APPLYAI_SCAN_FIELDS' }, { frameId }) as ApplicationScan;
  } catch {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(tabId, { type: 'APPLYAI_SCAN_FIELDS' }, { frameId }) as ApplicationScan;
  }
}

type ScanAttempt = { scan: ApplicationScan } | { permissionOrigin: string };

function savedAnswer(label: string, profile: ResumeProfile, preferences: Preferences) {
  const question = matchQuestion(label);
  return question ? questionAnswer(question, preferences) : findProfileValue(label, profile) ?? '';
}

function evidenceLabel(path: string) {
  const [section, key] = path.split('.');
  if (section === 'preferences') return PREFERENCE_FIELDS.find((field) => field.key === key)?.label ?? 'Saved standing answer';
  if (section === 'profile') return PROFILE_FIELDS.find((field) => field.key === key)?.label ?? 'Saved profile';
  return 'Reviewed profile';
}

async function scanActivePage(tabId: number): Promise<ScanAttempt> {
  const topScan = await scanFrame(tabId, 0);
  for (const origin of topScan.applicationFrameOrigins ?? []) {
    if (!await chrome.permissions.contains({ origins: [hostPermissionPattern(origin)] })) return { permissionOrigin: origin };
  }

  const injections = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  const frameIds = [...new Set(injections.map((injection) => injection.frameId))];
  const frameScans = await Promise.all(frameIds.map(async (frameId) => ({
    frameId,
    scan: await chrome.tabs.sendMessage(tabId, { type: 'APPLYAI_SCAN_FIELDS' }, { frameId }) as ApplicationScan,
  })));
  const primary = frameScans.find((frame) => frame.frameId === 0)?.scan ?? topScan;
  const applicationFrame = frameScans.find((frame) => frame.frameId !== 0 && frame.scan.fields.length > 0);
  const fields = frameScans.flatMap(({ frameId, scan }) => scan.fields.map((field) => ({
    ...field,
    id: `frame-${frameId}-${field.id}`,
    frameId,
    frameFieldId: field.id,
  })));
  return {
    scan: {
      ...primary,
      fields,
      platform: applicationFrame?.scan.platform ?? primary.platform,
      company: applicationFrame?.scan.company || primary.company,
      role: applicationFrame?.scan.role || primary.role,
      description: applicationFrame?.scan.description || primary.description,
      jobUrl: applicationFrame?.scan.jobUrl || primary.jobUrl,
      tabId,
    },
  };
}

export function SidePanel({ user, onLogout }: { user: User; onLogout: () => Promise<void> }) {
  const [profile, setProfile] = useState<ResumeProfile>(emptyProfile());
  const [preferences, setPreferences] = useState<Preferences>(emptyPreferences());
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
  const [siteAccessRequest, setSiteAccessRequest] = useState<{ pattern: string; hostname: string } | null>(null);
  const [filled, setFilled] = useState(false);
  const [cloudConsent, setCloudConsent] = useState(false);
  const [inferenceSource, setInferenceSource] = useState('');
  const [plan, setPlan] = useState<PlannerResult | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [manualDone, setManualDone] = useState<Record<string, boolean>>({});
  const [outcomes, setOutcomes] = useState<Record<string, 'verified' | 'failed'>>({});
  const [restored, setRestored] = useState(false);
  const [stale, setStale] = useState(false);
  const editedFields = useRef(new Set<string>());
  const operation = useRef(0);
  const owner = useRef(user.uid);
  owner.current = user.uid;

  const editAnswer = (id: string, value: string) => {
    editedFields.current.add(id);
    setValues((current) => ({ ...current, [id]: value }));
    setConfirmed((current) => ({ ...current, [id]: false }));
    setOutcomes((current) => { const next = { ...current }; delete next[id]; return next; });
  };

  const analyze = async (application: ApplicationScan, currentProfile: ResumeProfile, currentPreferences: Preferences, fullResumeText: string) => {
    const token = operation.current;
    const uid = user.uid;
    const input = {
      fields: application.fields, profile: currentProfile, preferences: currentPreferences,
      job: { company: application.company, role: application.role, description: application.description },
      resumeText: fullResumeText,
      fixedAnswers: Object.fromEntries([...editedFields.current].map((id) => [id, values[id] ?? ''])),
      allowCloud: cloudConsent && firebaseAppCheckReady,
    };
    if (!application.description?.trim() || (currentProfile.resumePath && !fullResumeText.trim())) {
      const result = { entries: savedPlan(input), attempts: [], warnings: ['Add the full job description and resume context below before making the AI request. Saved answers are prepared for review.'] } satisfies PlannerResult;
      setPlan(result);
      setValues((current) => ({ ...Object.fromEntries(result.entries.map((entry) => [entry.fieldId, entry.value])), ...Object.fromEntries([...editedFields.current].map((id) => [id, current[id] ?? ''])) }));
      setNotice('Application staged. Add the missing context, then choose Analyze answers again.');
      return;
    }
    const { planApplication } = await import('./plannerModel');
    const result = await planApplication(input, (message) => { if (token === operation.current && owner.current === uid) setNotice(message); });
    if (token !== operation.current || owner.current !== uid) return;
    setPlan(result);
    setValues((current) => ({ ...current, ...Object.fromEntries(result.entries.filter((entry) => !editedFields.current.has(entry.fieldId)).map((entry) => [entry.fieldId, entry.value])) }));
    setConfirmed({});
    const sources = [...new Set(result.entries.filter((entry) => entry.value).map((entry) => entry.source))];
    setInferenceSource(sources.map((source) => source === 'ON_DEVICE' ? 'On-device AI' : source === 'IN_CLOUD' ? 'Cloud AI (approved)' : source === 'user' ? 'Your answers' : 'Saved facts').join(' · '));
    const ready = result.entries.filter((entry) => entry.value).length;
    setNotice(`${ready} of ${application.fields.length} questions have answers. Review them, then fill. Remaining questions need your input or manual handling.`);
  };

  const refreshProfile = useCallback(async () => {
    setLoading(true);
    try {
      // Standing answers are an enhancement: a missing rules deploy or a brand-new account
      // must not block the profile load, which scanning depends on.
      const [savedProfile, records, savedPreferences] = await Promise.all([loadProfile(user.uid), listApplications(user.uid), loadPreferences(user.uid).catch(() => null)]);
      setProfile(savedProfile ?? emptyProfile()); setApplications(records); setPreferences(savedPreferences ?? emptyPreferences());
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load your profile.'); }
    finally { setLoading(false); }
  }, [user.uid]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    let cancelled = false;
    operation.current += 1;
    setRestored(false); setScan(null); setPlan(null); setValues({}); setConfirmed({}); setManualDone({}); setOutcomes({}); setResumeText(''); setCloudConsent(false); setBusy(false); setStale(false); editedFields.current.clear();
    void loadWorkspace(user.uid).then((workspace) => {
      if (cancelled || !workspace) return;
      setScan(workspace.scan); setPlan(workspace.plan); setValues(workspace.values); setConfirmed(workspace.confirmed); setManualDone(workspace.manualDone); setResumeText(workspace.resumeText); setOutcomes(workspace.outcomes); setCompany(workspace.company); setRole(workspace.role);
      editedFields.current = new Set(workspace.edited);
      setNotice('Restored your temporary application workspace. Review it before filling.');
    }).catch(() => { if (!cancelled) setError('Could not restore the temporary workspace. You can scan the application again.'); }).finally(() => { if (!cancelled) setRestored(true); });
    return () => { cancelled = true; operation.current += 1; };
  }, [user.uid]);

  useEffect(() => {
    if (!restored || !scan || scan.tabId === undefined || busy) return;
    let cancelled = false;
    void saveWorkspace({ version: 1, uid: user.uid, tabId: scan.tabId, scan, plan, values, confirmed, manualDone, edited: [...editedFields.current], company, role, resumeText, outcomes, updatedAt: Date.now() }).catch(() => { if (!cancelled) setError('The workspace could not be saved for this session. Keep this panel open to retain your answers.'); });
    return () => { cancelled = true; };
  }, [restored, scan, plan, values, confirmed, manualDone, company, role, resumeText, outcomes, busy, user.uid]);

  const discard = async () => {
    operation.current += 1;
    setScan(null); setPlan(null); setValues({}); setConfirmed({}); setManualDone({}); setResumeText(''); setOutcomes({}); setInferenceSource(''); setStale(false); editedFields.current.clear();
    await clearWorkspace(user.uid);
    setNotice('Temporary application discarded.');
  };

  const answerFor = useCallback((label: string) => {
    // A taxonomy hit is authoritative: an open-ended question must not be answered with a
    // profile list just because no standing answer exists yet.
    return savedAnswer(label, profile, preferences);
  }, [preferences, profile]);
  const suggestions = useMemo(() => scan?.fields.map((field) => ({ field, suggested: answerFor(field.label) })) ?? [], [scan, answerFor]);
  const scanPage = async () => {
    const uid = user.uid;
    const token = ++operation.current;
    setBusy(true); setError(''); setNotice(''); setFilled(false);
    setConfirmed({}); setInferenceSource(''); setOutcomes({}); setStale(false);
    try {
      const tab = await getActiveApplicationTab();
      if (!tab.hasSiteAccess) {
        setSiteAccessRequest({ pattern: tab.pattern, hostname: new URL(tab.url).hostname });
        setNotice('Approve site access below. Chrome will show its permission prompt.');
        return;
      }
      setSiteAccessRequest(null);
      const attempt = await scanActivePage(tab.id);
      if ('permissionOrigin' in attempt) {
        setSiteAccessRequest({ pattern: hostPermissionPattern(attempt.permissionOrigin), hostname: new URL(attempt.permissionOrigin).hostname });
        setNotice('The application is embedded on another site. Approve access to that site to scan its form.');
        return;
      }
      const [latestProfile, latestPreferences] = await Promise.all([loadProfile(user.uid), loadPreferences(user.uid)]);
      const currentProfile = latestProfile ?? emptyProfile();
      const currentPreferences = latestPreferences ?? emptyPreferences();
      setProfile(currentProfile); setPreferences(currentPreferences);
      const result = await completeJobContext(attempt.scan);
      let fullResumeText = profile.resumePath === currentProfile.resumePath ? resumeText : '';
      if (currentProfile.resumePath && !fullResumeText) {
        try { fullResumeText = await getResumeText(currentProfile.resumePath); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read resume text. Paste it below.'); }
      }
      if (token !== operation.current || owner.current !== uid) return;
      // Keep edits only for stable questions on the same application tab.
      if (scan?.url !== result.url || scan?.tabId !== result.tabId) editedFields.current.clear();
      setScan(result); setResumeText(fullResumeText); setPlan(null); setManualDone({});
      setCompany(result.company || (result.platform === 'greenhouse' ? '' : new URL(result.url).hostname.replace(/^www\./, '').split('.')[0] ?? ''));
      setRole(result.role || result.title);
      setValues((current) => Object.fromEntries(result.fields.map((field) => [field.id, editedFields.current.has(field.id) ? current[field.id] ?? '' : field.currentValue || savedAnswer(field.label, currentProfile, currentPreferences)])));
      const pageType = result.platform === 'greenhouse' ? ' on this Greenhouse application' : '';
      setNotice(result.fields.length ? `Found ${result.fields.length} fields${pageType}. Review the suggestions before filling.` : 'No supported form fields were found on this page.');
      if (result.fields.length) await analyze(result, currentProfile, currentPreferences, fullResumeText);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not inspect this page.'); }
    finally { setBusy(false); }
  };

  const grantSiteAccess = async () => {
    if (!siteAccessRequest) return;
    setBusy(true); setError(''); setNotice('');
    try {
      // Invoke Chrome's origin-specific permission prompt directly from this button click.
      const granted = await chrome.permissions.request({ origins: [siteAccessRequest.pattern] });
      if (!granted) throw new Error(`Chrome did not grant ApplyAI access to ${siteAccessRequest.hostname}. You can try again or review site access in Chrome settings.`);
      setSiteAccessRequest(null);
      setNotice(`Access granted for ${siteAccessRequest.hostname}. Scanning the application…`);
      await scanPage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not request access to this site.');
    } finally { setBusy(false); }
  };

  const fillPage = async () => {
    if (!scan) return;
    setBusy(true); setError('');
    try {
      const tab = await getActiveApplicationTab();
      if (tab.url !== scan.url) throw new Error('The active application page changed. Scan it again before filling.');
      const valuesByFrame = new Map<number, Record<string, string>>();
      for (const [id, value] of Object.entries(values)) {
        const field = scan.fields.find((candidate) => candidate.id === id);
        if (!field || ['file', 'password', 'select-multiple'].includes(field.type)
          || !value.trim() || ((isSensitiveField(field.label) || plan?.entries.find((entry) => entry.fieldId === id)?.requiresConfirmation) && !confirmed[id])) continue;
        const frameValues = valuesByFrame.get(field.frameId ?? 0) ?? {};
        frameValues[field.frameFieldId ?? field.id] = value;
        valuesByFrame.set(field.frameId ?? 0, frameValues);
      }
      // Only the detected resume question receives the PDF; other uploads stay manual.
      const resumeField = scan.fields.find((field) => field.type === 'file' && /\b(resume|cv|curriculum)\b/i.test(field.label));
      let resume: { fieldId: string; data: string; name: string } | undefined;
      let resumeError = '';
      if (resumeField && profile.resumePath) {
        try { resume = { fieldId: resumeField.frameFieldId ?? resumeField.id, ...await getResumeAttachment(profile.resumePath) }; }
        catch (reason) { resumeError = reason instanceof Error ? reason.message : 'Could not download your resume.'; }
      }
      if (resume && resumeField) valuesByFrame.set(resumeField.frameId ?? 0, valuesByFrame.get(resumeField.frameId ?? 0) ?? {});
      const results = await Promise.all([...valuesByFrame].map(async ([frameId, frameValues]) =>
        await chrome.tabs.sendMessage(tab.id, {
          type: 'APPLYAI_FILL_FIELDS',
          values: frameValues,
          resume: resumeField && (resumeField.frameId ?? 0) === frameId ? resume : undefined,
        }, { frameId }) as { filled: number; failed?: string[] },
      ));
      const filledCount = results.reduce((total, result) => total + result.filled, 0);
      setFilled(filledCount > 0);
      const failedCount = results.reduce((total, result) => total + (result.failed?.length ?? 0), 0);
      if (failedCount || resumeError) setError([resumeError, failedCount ? `${failedCount} field(s) could not be filled, including any unmatched location option. Review the page and complete them manually.` : ''].filter(Boolean).join(' '));
      setNotice(filledCount ? `Filled ${filledCount} field${filledCount === 1 ? '' : 's'}. Check the application before continuing.` : 'Nothing was filled. Add or edit answers with values, then try again.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not fill this page. Try scanning it again.'); }
    finally { setBusy(false); }
  };

  const reanalyze = async () => {
    if (!scan) return;
    setBusy(true); setError('');
    try {
      const [latestProfile, latestPreferences] = await Promise.all([loadProfile(user.uid), loadPreferences(user.uid).catch(() => null)]);
      const currentProfile = latestProfile ?? emptyProfile(); const currentPreferences = latestPreferences ?? emptyPreferences();
      setProfile(currentProfile); setPreferences(currentPreferences);
      await analyze({ ...scan, company, role }, currentProfile, currentPreferences, resumeText);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not analyze the application. Saved answers are still available.'); }
    finally { setBusy(false); }
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
    <div className="ai-settings"><label className="cloud-consent"><input type="checkbox" checked={cloudConsent} disabled={busy || !firebaseAppCheckReady} onChange={(event) => setCloudConsent(event.target.checked)} /> Allow cloud fallback for this application. This sends question labels, options, job context, and reviewed profile facts (including contact and location details) to Firebase AI Logic. Standing-answer values stay on this device.</label>
    <p className="field-hint">On-device AI runs first. Cloud AI is used only for unresolved questions when you approve it.{!firebaseAppCheckReady && ' Cloud fallback needs Firebase App Check configured.'}</p></div>
    {plan && <section className="notice info compact-notice" aria-label="AI analysis results">
      <strong>Analysis complete</strong>
      <p className="field-hint">{plan.attempts.length ? `Attempted: ${plan.attempts.map((source) => source === 'ON_DEVICE' ? 'on-device' : 'cloud').join(' → ')}` : 'No AI needed for these controls.'}</p>
      {plan.warnings.map((warning) => <p className="field-hint" key={warning}>{warning}</p>)}
    </section>}
    <button className="button primary wide scan-button" onClick={scanPage} disabled={loading || busy || !profile.updatedAt}>{busy ? 'Working…' : scan ? 'Scan and analyze again' : 'Scan and analyze with AI'}</button>
    {siteAccessRequest && <section className="panel-section site-access-card"><p className="field-hint">ApplyAI needs permission to read this application page on <strong>{siteAccessRequest.hostname}</strong>.</p><button className="button secondary wide" onClick={grantSiteAccess} disabled={busy}>Allow access to {siteAccessRequest.hostname}</button><p className="field-hint">Chrome will ask you to approve access to this site only.</p></section>}
    {suggestions.length > 0 && <section className="panel-section"><div className="panel-section-heading"><h2>Review answers</h2><span>{suggestions.length} fields</span></div>{inferenceSource && <div className="inference-badge">✦ {inferenceSource}</div>}<div className="answer-list">{suggestions.map(({ field, suggested }) => {
      const planned = plan?.entries.find((entry) => entry.fieldId === field.id);
      const sensitive = isSensitiveField(field.label) || planned?.requiresConfirmation;
      const unsupported = ['file', 'password', 'select-multiple'].includes(field.type);
      return <div className="answer-row" key={field.id}><label className="answer-label" htmlFor={`answer-${field.id}`}>{field.label || 'Unlabeled field'}{field.required && <i>Required</i>}</label>
        {['radio', 'select', 'choice'].includes(field.type) && field.options.length > 0 ? <select id={`answer-${field.id}`} value={values[field.id] ?? ''} onChange={(event) => editAnswer(field.id, event.target.value)}><option value="">Choose an option</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
          : field.type === 'checkbox' ? <select id={`answer-${field.id}`} value={values[field.id] ?? ''} onChange={(event) => editAnswer(field.id, event.target.value)}><option value="">Leave unchanged</option><option value="true">Check this box</option></select>
          : field.type === 'textarea' ? <textarea id={`answer-${field.id}`} rows={4} value={values[field.id] ?? ''} disabled={unsupported} onChange={(event) => editAnswer(field.id, event.target.value)} placeholder={unsupported ? 'Review on the page' : suggested ? 'Suggested from your profile' : 'No saved answer'} />
          : <input id={`answer-${field.id}`} value={values[field.id] ?? ''} disabled={unsupported} onChange={(event) => editAnswer(field.id, event.target.value)} placeholder={unsupported ? 'Review on the page' : suggested ? 'Suggested from your profile' : 'No saved answer'} />}
        {planned && <p className="field-hint">{editedFields.current.has(field.id) ? 'Edited by you.' : planned.reason}{planned.evidence.length > 0 && !editedFields.current.has(field.id) ? ` Source: ${planned.evidence.map(evidenceLabel).join(', ')}` : ''}</p>}
        {sensitive && <label className="confirm-sensitive"><input type="checkbox" checked={Boolean(confirmed[field.id])} onChange={(event) => setConfirmed((current) => ({ ...current, [field.id]: event.target.checked }))} /> I reviewed and approve this answer.</label>}
        {unsupported && <span className="field-hint">{field.type === 'file'
          ? /\b(resume|cv|curriculum)\b/i.test(field.label) ? profile.resumePath ? 'ApplyAI will try to attach your saved resume when you fill.' : 'Upload a resume in your profile to attach it automatically.' : 'Attach this file manually on the application page.'
          : 'This field type needs your attention on the page.'}</span>}
        {!suggested && !values[field.id] && !unsupported && <span className="field-hint">Add a missing fact in your <a href="dashboard.html" target="_blank">profile or standing answers ↗</a>, or type an answer here.</span>}
      </div>;
    })}</div><button className="button secondary wide ai-button" onClick={reanalyze} disabled={busy}>Analyze answers again</button><button className="button primary wide fill-button" onClick={fillPage} disabled={busy}>{busy ? 'Working…' : 'Fill reviewed answers'}</button><p className="fine-print center">ApplyAI never submits the application for you.</p></section>}
    {scan && <section className="confirm-card"><p className="eyebrow">{filled ? 'AFTER YOU SUBMIT' : 'APPLICATION TRACKING'}</p><h2>{filled ? 'Applied? Save it here.' : 'Submitted this application?'}</h2><label className="form-field"><span>Company</span><input value={company} onChange={(event) => setCompany(event.target.value)} /></label><label className="form-field"><span>Role</span><input value={role} onChange={(event) => setRole(event.target.value)} /></label><button className="button secondary wide" onClick={confirmSubmitted} disabled={busy || trackedApplication?.status === 'submitted'}>{trackedApplication?.status === 'submitted' ? 'Already saved as submitted' : trackedApplication ? 'Mark this application submitted' : 'I submitted this application'}</button></section>}
    <section className="panel-section recent-applications"><div className="panel-section-heading"><h2>Recent applications</h2><a href="dashboard.html" target="_blank">View all</a></div>{applications.length === 0 ? <p className="empty-state">Your confirmed applications will appear here.</p> : applications.slice(0, 3).map((application) => <div className="mini-application" key={application.id}><span>{application.role || application.company || 'Application'}</span><i>{application.status.replace('_', ' ')}</i></div>)}</section>
  </main>;
}
