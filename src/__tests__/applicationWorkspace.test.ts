import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationReadiness, clearWorkspace, loadWorkspace, saveWorkspace, type ApplicationWorkspace } from '../applicationWorkspace';

const documents = new Map<string, unknown>();
const workspace: ApplicationWorkspace = {
  version: 1, uid: 'owner', tabId: 7, updatedAt: 1,
  scan: { fields: [{ id: 'name', label: 'Name', type: 'text', required: true, selector: '', options: [] }, { id: 'optional', label: 'Website', type: 'url', required: false, selector: '', options: [] }], title: 'Engineer', url: 'https://jobs.example.com/apply', platform: 'standard', company: 'Example', role: 'Engineer', description: 'Entire job description', tabId: 7 },
  values: { name: 'Jordan' }, confirmed: {}, manualDone: {}, edited: ['name'], company: 'Example', role: 'Engineer', resumeText: 'Complete resume', plan: null, outcomes: { name: 'verified' },
};
beforeEach(() => {
  documents.clear();
  vi.stubGlobal('chrome', { storage: { session: {
    get: async (key: string) => ({ [key]: documents.get(key) }),
    set: async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) documents.set(key, structuredClone(value)); },
    remove: async (key: string) => { documents.delete(key); },
  } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('application staging workspace', () => {
  it('restores full context, manual edits, approval state and field outcomes', async () => {
    await saveWorkspace({ ...workspace, confirmed: { name: true } });
    expect(await loadWorkspace('owner')).toEqual({ ...workspace, confirmed: { name: true } });
    expect(await loadWorkspace('another-user')).toBeNull();
  });

  it('discards after pending saves without resurrecting the snapshot', async () => {
    const saving = saveWorkspace(workspace);
    const clearing = clearWorkspace('owner');
    await Promise.all([saving, clearing]);
    expect(await loadWorkspace('owner')).toBeNull();
  });

  it('rejects corrupt and cross-account session records', async () => {
    documents.set('applyAiWorkspace:owner', { ...workspace, uid: 'someone-else' });
    expect(await loadWorkspace('owner')).toBeNull();
    documents.set('applyAiWorkspace:owner', { ...workspace, scan: { fields: [] } });
    expect(await loadWorkspace('owner')).toBeNull();
  });

  it('allows optional blanks while blocking missing, invalid or unapproved required answers', () => {
    expect(applicationReadiness(workspace.scan, null, workspace.values, {}, {}).some((item) => item.blocking)).toBe(false);
    expect(applicationReadiness(workspace.scan, null, {}, {}, {})[0].blocking).toBe(true);
    const scan = { ...workspace.scan, fields: [{ ...workspace.scan.fields[0], label: 'Gender', type: 'select', options: ['Man', 'Woman'] }] };
    expect(applicationReadiness(scan, null, { name: 'Man' }, {}, {})[0].status).toBe('Awaiting your approval');
    expect(applicationReadiness(scan, null, { name: 'Man' }, { name: true }, {})[0].ready).toBe(true);
    expect(applicationReadiness(scan, null, { name: 'not-an-option' }, { name: true }, {})[0].blocking).toBe(true);
  });

  it('requires manual controls to be completed and respects input limits', () => {
    const scan = { ...workspace.scan, fields: [{ ...workspace.scan.fields[0], type: 'file', label: 'Transcript' }] };
    expect(applicationReadiness(scan, null, {}, {}, {})[0].blocking).toBe(true);
    expect(applicationReadiness(scan, null, {}, {}, { name: true })[0].ready).toBe(true);
    const text = { ...workspace.scan, fields: [{ ...workspace.scan.fields[0], maxLength: 3 }] };
    expect(applicationReadiness(text, null, { name: 'Jordan' }, {}, {})[0].blocking).toBe(true);
  });
});
