import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canPlan, needsConfirmation, savedPlan, type PlannerResult } from './planner';
import type { User } from 'firebase/auth';
import { findProfileValue } from './fields';
import { getResumeAttachment, getResumeText, listApplications, loadPreferences, loadProfile, saveApplication, updateApplication, type ApplicationRecord } from './data';
import { emptyProfile, PROFILE_FIELDS, type ResumeProfile } from './profile';
import { emptyPreferences, PREFERENCE_FIELDS, type Preferences } from './preferences';
import { matchQuestion, questionAnswer } from './questions';
import { firebaseAppCheckReady } from './firebase';
import { completeJobContext, hostPermissionPattern, type ApplicationScan } from './applicationPage';
import { applicationFingerprint, applicationReadiness, clearWorkspace, loadWorkspace, prepareFill, saveWorkspace } from './applicationWorkspace';
import type { AppCheckDebugDetails } from './appCheckDebug';

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
  if (section === 'resume') return 'Full resume text';
  if (section === 'user') return 'Your edited answer';
  if (section === 'application') return 'Existing application answer';
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

async function rescanApplicationFrames(tabId: number, previous: ApplicationScan): Promise<ApplicationScan> {
  const frameIds = [...new Set(previous.fields.map((field) => field.frameId ?? 0))];
  const results = await Promise.allSettled(frameIds.map(async (frameId) => ({ frameId, scan: await scanFrame(tabId, frameId) })));
  const frames = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (!frames.length) throw new Error('Could not reach the scanned application frames. Refresh the application page and scan again.');
  return { ...previous, fields: frames.flatMap(({ frameId, scan }) => scan.fields.map((field) => ({ ...field, id: `frame-${frameId}-${field.id}`, frameId, frameFieldId: field.id }))) };
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
  const [submissionRequested, setSubmissionRequested] = useState(false);
  const [cloudConsent, setCloudConsent] = useState(false);
  const [inferenceSource, setInferenceSource] = useState('');
  const [plan, setPlan] = useState<PlannerResult | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [manualDone, setManualDone] = useState<Record<string, boolean>>({});
  const [outcomes, setOutcomes] = useState<Record<string, 'verified' | 'failed' | 'skipped'>>({});
  const [restored, setRestored] = useState(false);
  const [stale, setStale] = useState(false);
  const [debugSetup, setDebugSetup] = useState<Omit<AppCheckDebugDetails, 'token'> | null>(null);
  const [debugTokenFallback, setDebugTokenFallback] = useState('');
  const editedFields = useRef(new Set<string>());
  const resumeSource = useRef('');
  const operation = useRef(0);
  const owner = useRef(user.uid);
  owner.current = user.uid;

  const editAnswer = (id: string, value: string) => {
    setFilled(false);
    editedFields.current.add(id);
    setValues((current) => ({ ...current, [id]: value }));
    setConfirmed((current) => ({ ...current, [id]: false }));
    setOutcomes((current) => { const next = { ...current }; delete next[id]; return next; });
  };

  const changeContext = (key: 'description' | 'resumeText', text: string) => {
    if (!scan) return;
    setFilled(false);
    if (key === 'description') setScan({ ...scan, description: text, contextWarning: undefined });
    else { setResumeText(text); resumeSource.current = profile.resumePath; }
    setConfirmed({}); setOutcomes({});
    setValues((current) => Object.fromEntries(Object.entries(current).filter(([id]) => editedFields.current.has(id) || !plan?.entries.some((entry) => entry.fieldId === id && ['ON_DEVICE', 'IN_CLOUD'].includes(entry.source)))));
    setPlan((current) => current ? { ...current, warnings: ['Context changed. Analyze again to prepare new AI answers. Your edited answers remain fixed.'], entries: current.entries.map((entry) => ['ON_DEVICE', 'IN_CLOUD'].includes(entry.source) && !editedFields.current.has(entry.fieldId) ? { ...entry, value: '', status: 'needs_user', reason: 'Context changed. Analyze again or enter an answer.' } : entry) } : null);
  };

  const analyze = async (application: ApplicationScan, currentProfile: ResumeProfile, currentPreferences: Preferences, fullResumeText: string) => {
    setFilled(false);
    const token = operation.current;
    const uid = user.uid;
    const input = {
      fields: application.fields, profile: currentProfile, preferences: currentPreferences,
      job: { company: application.company, role: application.role, description: application.description },
      resumeText: fullResumeText,
      draftsAllowed: Boolean(application.description?.trim() && (!currentProfile.resumePath || fullResumeText.trim())),
      fixedAnswers: Object.fromEntries([...editedFields.current].map((id) => [id, values[id] ?? ''])),
      allowCloud: cloudConsent && firebaseAppCheckReady,
    };
    const { planApplication } = await import('./plannerModel');
    if (token !== operation.current || owner.current !== uid) return;
    const result = await planApplication(input, (message) => { if (token === operation.current && owner.current === uid) setNotice(message); });
    if (token !== operation.current || owner.current !== uid) return;
    if (!input.draftsAllowed) result.warnings.push('Saved facts and AI field matching are available. Add the full job description and resume text before drafting written answers.');
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
      const [savedProfile, records, savedPreferences] = await Promise.allSettled([loadProfile(user.uid), listApplications(user.uid), loadPreferences(user.uid)]);
      if (savedProfile.status === 'rejected') throw savedProfile.reason;
      setProfile(savedProfile.value ?? emptyProfile());
      setApplications(records.status === 'fulfilled' ? records.value : []);
      setPreferences(savedPreferences.status === 'fulfilled' ? savedPreferences.value ?? emptyPreferences() : emptyPreferences());
      if (savedPreferences.status === 'rejected') setError('Saved standing answers could not be loaded. Your name and contact details are available; reload standing answers or enter those answers manually.');
      else if (records.status === 'rejected') setError('Application history could not be loaded. Profile filling is still available.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load your profile.'); }
    finally { setLoading(false); }
  }, [user.uid]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    let cancelled = false;
    operation.current += 1;
    setRestored(false); setScan(null); setPlan(null); setValues({}); setConfirmed({}); setManualDone({}); setOutcomes({}); setResumeText(''); setCloudConsent(false); setBusy(false); setStale(false); setSubmissionRequested(false); setFilled(false); editedFields.current.clear(); resumeSource.current = '';
    void loadWorkspace(user.uid).then((workspace) => {
      if (cancelled || !workspace) return;
      setScan(workspace.scan); setPlan(workspace.plan); setValues(workspace.values); setConfirmed(workspace.confirmed); setManualDone(workspace.manualDone); setResumeText(workspace.resumeText); setOutcomes(workspace.outcomes); setCompany(workspace.company); setRole(workspace.role);
      setSubmissionRequested(Boolean(workspace.submissionRequested));
      editedFields.current = new Set(workspace.edited);
      resumeSource.current = workspace.resumePath ?? '';
      setNotice('Restored your temporary application workspace. Review it before filling.');
    }).catch(() => { if (!cancelled) setError('Could not restore the temporary workspace. You can scan the application again.'); }).finally(() => { if (!cancelled) setRestored(true); });
    return () => { cancelled = true; operation.current += 1; };
  }, [user.uid]);

  useEffect(() => {
    if (!restored || !scan || scan.tabId === undefined || busy) return;
    let cancelled = false;
    void saveWorkspace({ version: 1, uid: user.uid, tabId: scan.tabId, scan, plan, values, confirmed, manualDone, edited: [...editedFields.current], company, role, resumeText, resumePath: resumeSource.current, outcomes, submissionRequested, updatedAt: Date.now() }).catch(() => { if (!cancelled) setError('The workspace could not be saved for this session. Keep this panel open to retain your answers.'); });
    return () => { cancelled = true; };
  }, [restored, scan, plan, values, confirmed, manualDone, company, role, resumeText, outcomes, submissionRequested, busy, user.uid]);

  const discard = async () => {
    operation.current += 1;
    setScan(null); setPlan(null); setValues({}); setConfirmed({}); setManualDone({}); setResumeText(''); setOutcomes({}); setInferenceSource(''); setStale(false); editedFields.current.clear();
    setSubmissionRequested(false); setFilled(false);
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
      const [latestProfile, latestPreferences] = await Promise.all([loadProfile(user.uid).catch(() => { setError('Saved profile details could not be loaded. You can still scan and enter answers manually.'); return null; }), loadPreferences(user.uid).catch(() => { setError('Saved standing answers could not be loaded. Profile details are still available; enter missing standing answers manually.'); return null; })]);
      const currentProfile = latestProfile ?? emptyProfile();
      const currentPreferences = latestPreferences ?? emptyPreferences();
      setProfile(currentProfile); setPreferences(currentPreferences);
      const result = await completeJobContext(attempt.scan);
      let fullResumeText = resumeSource.current === currentProfile.resumePath ? resumeText : '';
      if (currentProfile.resumePath && !fullResumeText) {
        try { fullResumeText = await getResumeText(currentProfile.resumePath); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read resume text. Paste it below.'); }
      }
      if (token !== operation.current || owner.current !== uid) return;
      // Keep edits only for stable questions on the same application tab.
      const sameApplication = scan?.url === result.url && scan?.tabId === result.tabId;
      if (!sameApplication) { editedFields.current.clear(); setSubmissionRequested(false); }
      setScan(result); setResumeText(fullResumeText); resumeSource.current = currentProfile.resumePath; setPlan(null); setManualDone({});
      setCompany(result.company || (result.platform === 'greenhouse' ? '' : new URL(result.url).hostname.replace(/^www\./, '').split('.')[0] ?? ''));
      setRole(result.role || result.title);
      setValues((current) => Object.fromEntries(result.fields.map((field) => [field.id, editedFields.current.has(field.id) ? current[field.id] ?? '' : field.currentValue || savedAnswer(field.label, currentProfile, currentPreferences)])));
      await saveWorkspace({ version: 1, uid, tabId: tab.id, scan: result, plan: null, values: Object.fromEntries(result.fields.map((field) => [field.id, editedFields.current.has(field.id) ? values[field.id] ?? '' : field.currentValue || savedAnswer(field.label, currentProfile, currentPreferences)])), confirmed: {}, manualDone: {}, edited: [...editedFields.current], company: result.company, role: result.role, resumeText: fullResumeText, resumePath: currentProfile.resumePath, outcomes: {}, submissionRequested: sameApplication && submissionRequested, updatedAt: Date.now() }).catch(() => setError('Could not save the temporary workspace. Keep this panel open.'));
      if (token !== operation.current || owner.current !== uid) return;
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

  const fillPage = async (allowPartial = false) => {
    if (!scan) return;
    setBusy(true); setError('');
    try {
      if (!allowPartial && applicationReadiness(scan, plan, values, confirmed, manualDone, Boolean(profile.resumePath)).some((item) => item.blocking)) throw new Error('Some required answers are not ready. Review them, or choose “Fill prepared answers” to enter only the answers that are ready.');
      const tab = await getActiveApplicationTab();
      if (tab.url !== scan.url || tab.id !== scan.tabId) throw new Error('The active application tab changed. Return to the scanned tab or scan again before filling.');
      const before = await rescanApplicationFrames(tab.id, scan);
      const prepared = prepareFill(scan, before, plan, values, confirmed);
      const valuesByFrame = new Map<number, Record<string, string>>();
      const originalIds = new Map<string, string>();
      for (const { field, originalId, value } of prepared.targets) {
        const frameValues = valuesByFrame.get(field.frameId ?? 0) ?? {};
        frameValues[field.frameFieldId ?? field.id] = value;
        valuesByFrame.set(field.frameId ?? 0, frameValues);
        originalIds.set(`frame-${field.frameId ?? 0}-${field.frameFieldId ?? field.id}`, originalId);
      }
      // Only the detected resume question receives the PDF; other uploads stay manual.
      const resumeField = before.fields.find((field) => field.type === 'file' && /\b(resume|cv|curriculum)\b/i.test(field.label));
      let resume: { fieldId: string; data: string; name: string } | undefined;
      let resumeError = '';
      if (resumeField && profile.resumePath) {
        try { resume = { fieldId: resumeField.frameFieldId ?? resumeField.id, ...await getResumeAttachment(profile.resumePath) }; }
        catch (reason) { resumeError = reason instanceof Error ? reason.message : 'Could not download your resume.'; }
      }
      if (resume && resumeField) valuesByFrame.set(resumeField.frameId ?? 0, valuesByFrame.get(resumeField.frameId ?? 0) ?? {});
      if (!valuesByFrame.size) throw new Error('No prepared answer matches a current control. Scan again and review the field explanations.');
      const results = await Promise.all([...valuesByFrame].map(async ([frameId, frameValues]) => {
        try {
          const result = await chrome.tabs.sendMessage(tab.id, {
            type: 'APPLYAI_FILL_FIELDS', values: frameValues,
            resume: resumeField && (resumeField.frameId ?? 0) === frameId ? resume : undefined,
          }, { frameId }) as { filled: number; failed?: string[]; outcomes?: Record<string, 'verified' | 'failed'> };
          if (!result || typeof result.filled !== 'number') throw new Error('The application script returned no fill result. Refresh the job page and scan again.');
          return { frameId, result, transportError: '' };
        } catch (reason) {
          return { frameId, result: { filled: 0, failed: Object.keys(frameValues), outcomes: Object.fromEntries(Object.keys(frameValues).map((id) => [id, 'failed' as const])) }, transportError: reason instanceof Error ? reason.message : 'Could not send answers to an application frame.' };
        }
      }));
      const filledCount = results.reduce((total, { result }) => total + result.filled, 0);
      setFilled(filledCount > 0);
      setOutcomes(Object.fromEntries([...prepared.skipped.map(({ fieldId }) => [fieldId, 'skipped'] as const), ...results.flatMap(({ frameId, result }) => Object.entries(result.outcomes ?? {}).map(([id, status]) => [originalIds.get(`frame-${frameId}-${id}`) ?? `frame-${frameId}-${id}`, status]))]));
      const failedCount = results.reduce((total, { result }) => total + (result.failed?.length ?? 0), 0);
      const transportErrors = results.map(({ transportError }) => transportError).filter(Boolean);
      if (failedCount || prepared.skipped.length || resumeError || transportErrors.length) setError([resumeError, ...transportErrors, failedCount ? `${failedCount} control(s) could not be verified. Review the field results below.` : '', prepared.skipped.length ? `${prepared.skipped.length} answer(s) were skipped because they need approval or their controls changed. Other prepared answers were still attempted.` : ''].filter(Boolean).join(' '));
      setNotice(filledCount ? `Verified ${filledCount} field${filledCount === 1 ? '' : 's'}. Check the application before continuing.` : 'No answers could be verified. Review the field results below.');
      const after = await rescanApplicationFrames(tab.id, before);
      if (applicationFingerprint(after) !== applicationFingerprint(before)) {
        setStale(true);
        setNotice('Filling revealed new or changed questions. Scan again to prepare the next application snapshot; your edits to matching questions will be kept.');
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not fill this page. Try scanning it again.'); }
    finally { setBusy(false); }
  };

  const submitPage = async () => {
    if (!scan || busy || submissionRequested || applications.some((application) => application.url === scan.url && application.status === 'submitted')) return;
    const uid = user.uid;
    const token = operation.current;
    setBusy(true); setError('');
    try {
      if (!filled || stale || applicationReadiness(scan, plan, values, confirmed, manualDone, Boolean(profile.resumePath)).some((item) => item.blocking)) throw new Error('Fill and review all required answers before submitting.');
      const tab = await getActiveApplicationTab();
      if (tab.id !== scan.tabId || tab.url !== scan.url) throw new Error('Return to the scanned application tab before submitting.');
      const current = await rescanApplicationFrames(tab.id, scan);
      if (applicationFingerprint(scan) !== applicationFingerprint(current)) { setStale(true); throw new Error('The application questions changed. Scan, review and fill again before submitting.'); }
      const prepared = prepareFill(scan, current, plan, values, confirmed);
      if (prepared.skipped.length || prepared.targets.some(({ field, value }) => (field.currentValue ?? '') !== (field.type === 'checkbox' && value === 'false' ? '' : value))) throw new Error('Some prepared answers are unapproved or no longer match the page. Review and fill again before submitting.');
      const frameIds = [...new Set(current.fields.map((field) => field.frameId ?? 0))];
      if (frameIds.length !== 1) throw new Error('This application spans multiple frames. Submit directly on the job site.');
      const workspace = await loadWorkspace(uid);
      if (!workspace) throw new Error('Could not save the submission request. Scan and fill again before submitting.');
      if (owner.current !== uid || token !== operation.current) return;
      await saveWorkspace({ ...workspace, submissionRequested: true, updatedAt: Date.now() });
      if (owner.current !== uid || token !== operation.current) return;
      setSubmissionRequested(true);
      let result: { requested: boolean; error?: string };
      try {
        result = await chrome.tabs.sendMessage(tab.id, { type: 'APPLYAI_SUBMIT_APPLICATION', fields: current.fields.map((field) => ({ ...field, id: field.frameFieldId ?? field.id })) }, { frameId: frameIds[0] });
      } catch { throw new Error('The submission request may have reached the job site. Check the site for confirmation before trying again.'); }
      if (result?.requested !== true) { setSubmissionRequested(false); throw new Error(result?.error || 'The job site could not submit this application.'); }
      setNotice('Submission requested. Check the job site for confirmation, then mark the application submitted below.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not submit this application.'); }
    finally { setBusy(false); }
  };

  const reanalyze = async () => {
    if (!scan) return;
    const uid = user.uid;
    const token = ++operation.current;
    setBusy(true); setError('');
    try {
      const [latestProfile, latestPreferences] = await Promise.all([loadProfile(user.uid), loadPreferences(user.uid)]);
      if (token !== operation.current || owner.current !== uid) return;
      const currentProfile = latestProfile ?? emptyProfile(); const currentPreferences = latestPreferences ?? emptyPreferences();
      setProfile(currentProfile); setPreferences(currentPreferences);
      let text = resumeText;
      if (currentProfile.resumePath !== resumeSource.current) {
        text = currentProfile.resumePath ? await getResumeText(currentProfile.resumePath) : '';
        setResumeText(text); resumeSource.current = currentProfile.resumePath;
      }
      if (token !== operation.current || owner.current !== uid) return;
      await analyze({ ...scan, company, role }, currentProfile, currentPreferences, text);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not analyze the application. Saved answers are still available.'); }
    finally { setBusy(false); }
  };

  const checkConnection = async () => {
    setBusy(true); setError(''); setNotice('Checking Firebase App Check and cloud AI with a test prompt…');
    try {
      const { checkAIConnection } = await import('./plannerModel');
      setNotice(await checkAIConnection());
    } catch (reason) { setNotice(''); setError(reason instanceof Error ? reason.message : 'Could not check the AI connection.'); }
    finally { setBusy(false); }
  };

  const copyDebugToken = async () => {
    setBusy(true); setError(''); setDebugTokenFallback('');
    try {
      const { getAppCheckDebugDetails } = await import('./appCheckDebug');
      const { token, ...details } = await getAppCheckDebugDetails();
      setDebugSetup(details);
      try {
        await navigator.clipboard.writeText(token);
        setNotice('Debug token copied. In Firebase, choose Add debug token, enter a name such as “ApplyAI Chrome”, and paste the copied value into the token field. Save it, then retry Check AI connection.');
      } catch {
        setDebugTokenFallback(token);
        setNotice('Clipboard access was unavailable. Copy the debug token shown below into Firebase’s Add debug token dialog, save, then retry Check AI connection.');
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not retrieve the extension debug token.'); }
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
  const readiness = scan ? applicationReadiness(scan, plan, values, confirmed, manualDone, Boolean(profile.resumePath)) : [];
  const blockers = readiness.filter((item) => item.blocking).length;
  const preparedCount = readiness.filter((item) => item.ready && scan?.fields.find((field) => field.id === item.fieldId && canPlan(field))).length;

  return <main className="panel-shell">
    <header className="panel-header"><a className="brand" href="dashboard.html" target="_blank"><span className="brand-mark small">A</span><span>apply<span className="brand-accent">ai</span></span></a><a className="button quiet compact" href="dashboard.html" target="_blank">{profile.updatedAt ? 'Edit profile' : 'Set up profile'}</a><button className="button quiet compact" onClick={async () => { await discard(); await onLogout(); }}>Sign out</button></header>
    <section className="panel-intro"><p className="eyebrow">APPLICATION ASSISTANT</p><h1>Let’s fill this out.</h1><p className="muted">Your profile stays yours. You choose what gets filled.</p></section>
    {error && <div className="notice error compact-notice" role="alert">{error}</div>}{notice && <div className="notice success compact-notice" role="status">{notice}</div>}
    {!loading && !profile.updatedAt && <div className="notice info compact-notice">You can scan questions without a resume or saved profile. Add or enter your details to answer missing questions. After saving a profile, <button className="text-button" onClick={refreshProfile}>refresh the profile here</button>.</div>}
    <div className="ai-settings"><label className="cloud-consent"><input type="checkbox" checked={cloudConsent} disabled={busy || !firebaseAppCheckReady} onChange={(event) => setCloudConsent(event.target.checked)} /> Allow cloud AI for this application. This sends all questions and options, the full job description, resume text, reviewed profile (including contact details), and saved answers allowed by your sharing settings to Firebase AI Logic.</label>
    <p className="field-hint">Saved answers first, then on-device AI, then approved cloud AI for questions still unanswered. Each model runs at most once per analysis. If the complete request does not fit locally, approved cloud AI handles the remaining questions.{!firebaseAppCheckReady && ' Cloud AI needs Firebase App Check configured.'}</p><button className="button secondary wide" disabled={busy} onClick={checkConnection}>Check AI connection</button><p className="field-hint">Uses a small test prompt; no application or profile data is sent. No Python server is needed.</p>{import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG === 'true' && <button className="button secondary wide" disabled={busy} onClick={copyDebugToken}>Copy App Check debug token</button>}{debugSetup && <div className="notice info compact-notice"><p className="field-hint">Register this token under project <strong>{debugSetup.projectId}</strong>, web app <strong>{debugSetup.appId}</strong>.</p><a href={debugSetup.consoleUrl} target="_blank" rel="noreferrer">Open this app’s App Check settings</a>{debugTokenFallback && <label className="form-field"><span>Extension debug token — paste into Firebase</span><input readOnly value={debugTokenFallback} onFocus={(event) => event.target.select()} /></label>}</div>}</div>
    {plan && <section className="notice info compact-notice" aria-label="AI analysis results">
      <strong>Analysis complete</strong>
      <p className="field-hint">{plan.attempts.length ? `Attempted: ${plan.attempts.map((source) => source === 'ON_DEVICE' ? 'on-device' : 'cloud').join(' → ')}` : plan.entries.some((entry) => entry.status === 'needs_user') ? 'No AI generation was made. Saved answers remain available.' : 'Answers prepared from saved facts.'}</p>
      {plan.warnings.map((warning) => <p className="field-hint" key={warning}>{warning}</p>)}
    </section>}
    <button className="button primary wide scan-button" onClick={scanPage} disabled={loading || !restored || busy}>{busy ? 'Working…' : scan ? 'Scan and analyze again' : 'Scan and analyze with AI'}</button>
    {scan && <section className="panel-section" aria-label="Temporary application workspace"><div className="panel-section-heading"><h2>Application workspace</h2><button className="text-button" disabled={busy} onClick={() => { void discard().catch(() => setError('Could not discard the saved workspace. Try again.')); }}>Discard</button></div><p className="field-hint">{scan.title} · Answers stay in this browser session until discarded or signed out. Closing the panel keeps your progress.</p><details open={!scan.description || Boolean(scan.contextWarning)}><summary>Job and resume context</summary>{scan.contextWarning && <p className="field-hint">{scan.contextWarning}</p>}<label className="form-field"><span>Full job description</span><textarea rows={8} disabled={busy} value={scan.description ?? ''} onChange={(event) => changeContext('description', event.target.value)} /></label><label className="form-field"><span>Full resume text</span><textarea rows={8} disabled={busy} value={resumeText} onChange={(event) => changeContext('resumeText', event.target.value)} /></label><p className="field-hint">Check extracted text before analysis. Reviewed profile facts take precedence over older resume text. If no PDF is saved, the structured profile supplies career evidence.</p></details><p role="status">{stale ? 'Questions changed — scan again.' : blockers ? `${blockers} required question${blockers === 1 ? '' : 's'} need an answer or approval.` : 'All required answers are prepared. Ready to fill.'}</p></section>}
    {siteAccessRequest && <section className="panel-section site-access-card"><p className="field-hint">ApplyAI needs permission to read this application page on <strong>{siteAccessRequest.hostname}</strong>.</p><button className="button secondary wide" onClick={grantSiteAccess} disabled={busy}>Allow access to {siteAccessRequest.hostname}</button><p className="field-hint">Chrome will ask you to approve access to this site only.</p></section>}
    {suggestions.length > 0 && <section className="panel-section"><div className="panel-section-heading"><h2>Review answers</h2><span>{suggestions.length} fields</span></div>{inferenceSource && <div className="inference-badge">✦ {inferenceSource}</div>}<div className="answer-list">{suggestions.map(({ field, suggested }) => {
      const planned = plan?.entries.find((entry) => entry.fieldId === field.id);
      const sensitive = needsConfirmation(field) || planned?.requiresConfirmation;
      const unsupported = !canPlan(field);
      return <div className="answer-row" key={field.id}><label className="answer-label" htmlFor={`answer-${field.id}`}>{field.label || 'Unlabeled field'}{field.required && <i>Required</i>}</label>
        {field.description && <p className="field-hint">{field.description}</p>}<p className="field-hint">{outcomes[field.id] === 'verified' ? 'Filled and verified' : outcomes[field.id] === 'skipped' ? 'Left unchanged: approval is needed or this control changed' : outcomes[field.id] === 'failed' ? 'Could not verify on the page — review this control' : readiness.find((item) => item.fieldId === field.id)?.status}</p>
        {['radio', 'select', 'select-one', 'choice'].includes(field.type) && field.options.length > 0 ? <select id={`answer-${field.id}`} disabled={busy} value={values[field.id] ?? ''} onChange={(event) => editAnswer(field.id, event.target.value)}><option value="">Choose an option</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
          : field.type === 'checkbox' ? <select id={`answer-${field.id}`} disabled={busy} value={values[field.id] ?? ''} onChange={(event) => editAnswer(field.id, event.target.value)}><option value="">Leave unchanged</option><option value="true">Check this box</option><option value="false">Leave unchecked</option></select>
          : field.type === 'textarea' ? <textarea id={`answer-${field.id}`} rows={4} value={values[field.id] ?? ''} disabled={unsupported || busy} onChange={(event) => editAnswer(field.id, event.target.value)} placeholder={unsupported ? 'Review on the page' : suggested ? 'Suggested from your profile' : 'No saved answer'} />
          : <input id={`answer-${field.id}`} value={values[field.id] ?? ''} disabled={unsupported || busy} onChange={(event) => editAnswer(field.id, event.target.value)} placeholder={unsupported ? 'Review on the page' : suggested ? 'Suggested from your profile' : 'No saved answer'} />}
        {planned && <p className="field-hint">{editedFields.current.has(field.id) ? 'Edited by you.' : planned.reason}{planned.evidence.length > 0 && !editedFields.current.has(field.id) ? ` Source: ${planned.evidence.map(evidenceLabel).join(', ')}` : ''}</p>}
        {sensitive && !unsupported && <label className="confirm-sensitive"><input type="checkbox" disabled={busy || !values[field.id]} checked={Boolean(confirmed[field.id])} onChange={(event) => setConfirmed((current) => ({ ...current, [field.id]: event.target.checked }))} /> I reviewed and approve this answer.</label>}
        {unsupported && <label className="confirm-sensitive"><input type="checkbox" disabled={busy} checked={Boolean(manualDone[field.id])} onChange={(event) => setManualDone((current) => ({ ...current, [field.id]: event.target.checked }))} /> I completed this control on the application page.</label>}
        {unsupported && <span className="field-hint">{field.type === 'file'
          ? /\b(resume|cv|curriculum)\b/i.test(field.label) ? profile.resumePath ? 'ApplyAI will try to attach your saved resume when you fill.' : 'Upload a resume in your profile to attach it automatically.' : 'Attach this file manually on the application page.'
          : 'This field type needs your attention on the page.'}</span>}
        {!suggested && !values[field.id] && !unsupported && <span className="field-hint">Add a missing fact in your <a href="dashboard.html" target="_blank">profile or standing answers ↗</a>, or type an answer here.</span>}
      </div>;
    })}</div><button className="button secondary wide ai-button" onClick={reanalyze} disabled={busy || stale}>Analyze answers again</button><p className="field-hint">Analyzing again checks saved answers, then local AI, then approved cloud AI for remaining questions. Your edited answers stay fixed.</p><button className="button primary wide fill-button" onClick={() => { void fillPage(); }} disabled={busy || stale || blockers > 0 || preparedCount === 0}>{busy ? 'Working…' : 'Fill reviewed answers'}</button>{blockers > 0 && <><p className="field-hint">{blockers} required question{blockers === 1 ? '' : 's'} still need attention. You can fill the {preparedCount} prepared answer{preparedCount === 1 ? '' : 's'} now; unanswered or unapproved questions will be left unchanged.</p><button className="button secondary wide" onClick={() => { void fillPage(true); }} disabled={busy || stale || preparedCount === 0}>Fill prepared answers</button></>}<p className="fine-print center">Filling does not submit. Use the separate Submit application button when you are ready.</p></section>}
    {scan && <section className="panel-section" aria-label="Submit reviewed application"><h2>Submit application</h2><p className="field-hint">Review the filled form on the job site. This button sends the application using that site’s final submit button.</p><button className="button primary wide" onClick={submitPage} disabled={busy || stale || !filled || blockers > 0 || submissionRequested || trackedApplication?.status === 'submitted'}>{submissionRequested ? 'Submission requested' : 'Submit application'}</button><p className="field-hint">Check the job site for confirmation before marking it submitted. Unsupported forms must be submitted directly on the site.</p></section>}
    {scan && <section className="confirm-card"><p className="eyebrow">{filled ? 'AFTER YOU SUBMIT' : 'APPLICATION TRACKING'}</p><h2>{filled ? 'Applied? Save it here.' : 'Submitted this application?'}</h2><label className="form-field"><span>Company</span><input value={company} onChange={(event) => setCompany(event.target.value)} /></label><label className="form-field"><span>Role</span><input value={role} onChange={(event) => setRole(event.target.value)} /></label><button className="button secondary wide" onClick={confirmSubmitted} disabled={busy || trackedApplication?.status === 'submitted'}>{trackedApplication?.status === 'submitted' ? 'Already saved as submitted' : trackedApplication ? 'Mark this application submitted' : 'I submitted this application'}</button></section>}
    <section className="panel-section recent-applications"><div className="panel-section-heading"><h2>Recent applications</h2><a href="dashboard.html" target="_blank">View all</a></div>{applications.length === 0 ? <p className="empty-state">Your confirmed applications will appear here.</p> : applications.slice(0, 3).map((application) => <div className="mini-application" key={application.id}><span>{application.role || application.company || 'Application'}</span><i>{application.status.replace('_', ' ')}</i></div>)}</section>
  </main>;
}
