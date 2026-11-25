import { z } from 'zod';
import type { ApplicationScan } from './applicationPage';
import { canPlan, fitsControl, needsConfirmation, type PlannerResult } from './planner';

export interface ApplicationWorkspace {
  version: 1;
  uid: string;
  tabId: number;
  scan: ApplicationScan;
  plan: PlannerResult | null;
  values: Record<string, string>;
  confirmed: Record<string, boolean>;
  manualDone: Record<string, boolean>;
  edited: string[];
  company: string;
  role: string;
  resumeText: string;
  outcomes: Record<string, 'verified' | 'failed'>;
  updatedAt: number;
}

const fieldSchema = z.object({ id: z.string(), label: z.string(), type: z.string(), required: z.boolean(), options: z.array(z.string()), selector: z.string(), frameId: z.number().optional(), frameFieldId: z.string().optional(), description: z.string().optional(), section: z.string().optional(), currentValue: z.string().optional(), maxLength: z.number().optional(), min: z.string().optional(), max: z.string().optional(), pattern: z.string().optional() });
const workspaceSchema = z.object({
  version: z.literal(1), uid: z.string(), tabId: z.number(), updatedAt: z.number(),
  scan: z.object({ fields: z.array(fieldSchema).max(200), title: z.string(), url: z.string().url(), platform: z.enum(['standard', 'greenhouse']), company: z.string(), role: z.string(), description: z.string().optional(), jobUrl: z.string().optional(), contextWarning: z.string().optional(), tabId: z.number().optional(), applicationFrameOrigins: z.array(z.string()).optional() }),
  plan: z.object({ entries: z.array(z.object({ fieldId: z.string(), value: z.string(), status: z.enum(['ready', 'needs_review', 'needs_user', 'manual']), source: z.enum(['saved', 'user', 'ON_DEVICE', 'IN_CLOUD']), evidence: z.array(z.string()), reason: z.string(), requiresConfirmation: z.boolean() })), warnings: z.array(z.string()), attempts: z.array(z.enum(['ON_DEVICE', 'IN_CLOUD'])) }).nullable(),
  values: z.record(z.string(), z.string()), confirmed: z.record(z.string(), z.boolean()), manualDone: z.record(z.string(), z.boolean()), edited: z.array(z.string()), company: z.string(), role: z.string(), resumeText: z.string(), outcomes: z.record(z.string(), z.enum(['verified', 'failed'])),
});
let writes: Promise<unknown> = Promise.resolve();

export function saveWorkspace(workspace: ApplicationWorkspace): Promise<void> {
  const snapshot = workspaceSchema.parse(workspace);
  const saving = writes.catch(() => undefined).then(async () => {
    await chrome.storage.session.set({ [`applyAiWorkspace:${snapshot.uid}`]: snapshot });
  });
  writes = saving;
  return saving;
}

export async function loadWorkspace(uid: string): Promise<ApplicationWorkspace | null> {
  await writes.catch(() => undefined);
  const key = `applyAiWorkspace:${uid}`;
  const data = await chrome.storage.session.get(key);
  const parsed = workspaceSchema.safeParse(data[key]);
  if (!parsed.success || parsed.data.uid !== uid) return null;
  return parsed.data;
}

export function clearWorkspace(uid: string): Promise<void> {
  const clearing = writes.catch(() => undefined).then(async () => {
    await chrome.storage.session.remove(`applyAiWorkspace:${uid}`);
  });
  writes = clearing;
  return clearing;
}

export function applicationReadiness(scan: ApplicationScan, plan: PlannerResult | null, values: Record<string, string>, confirmed: Record<string, boolean>, manualDone: Record<string, boolean>, hasResume = false) {
  return scan.fields.map((field) => {
    const entry = plan?.entries.find((item) => item.fieldId === field.id);
    const manual = !canPlan(field);
    const valid = manual
      ? Boolean(manualDone[field.id] || field.currentValue || (hasResume && field.type === 'file' && /\b(resume|cv|curriculum)\b/i.test(field.label)))
      : Boolean(fitsControl(field, values[field.id] ?? ''));
    const approved = manual || !(needsConfirmation(field) || entry?.requiresConfirmation) || Boolean(confirmed[field.id]);
    return { fieldId: field.id, ready: valid && approved, blocking: field.required && (!valid || !approved), status: !valid ? manual ? 'Complete on page' : 'Missing or invalid answer' : !approved ? 'Awaiting your approval' : 'Prepared' };
  });
}
