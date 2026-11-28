import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationReadiness, clearWorkspace, loadWorkspace, prepareFill, saveWorkspace, type ApplicationWorkspace } from '../applicationWorkspace';

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
  it('keeps contact answers fillable when another dropdown changes its options', () => {
    const scan = { ...workspace.scan, fields: [...workspace.scan.fields, { id: 'choice', label: 'Preferred arrangement', type: 'select', required: true, selector: '', options: ['Remote', 'Hybrid'] }] };
    const current = { ...scan, fields: scan.fields.map((field) => field.id === 'choice' ? { ...field, options: ['Onsite'] } : field) };
    const result = prepareFill(scan, current, null, { name: 'Jordan', choice: 'Remote' }, {});
    expect(result.targets.map((target) => target.originalId)).toEqual(['name']);
    expect(result.skipped).toEqual([{ fieldId: 'choice', reason: expect.stringContaining('changed') }]);
  });

  it('remaps a unique unchanged question after a framework replaces generated IDs', () => {
    const current = { ...workspace.scan, fields: workspace.scan.fields.map((field) => field.id === 'name' ? { ...field, id: 'new-react-id' } : field) };
    expect(prepareFill(workspace.scan, current, null, workspace.values, {}).targets).toEqual([{ originalId: 'name', value: 'Jordan', field: expect.objectContaining({ id: 'new-react-id' }) }]);
    const ambiguous = { ...current, fields: [...current.fields, { ...current.fields[0], id: 'another-name' }] };
    expect(prepareFill(workspace.scan, ambiguous, null, workspace.values, {}).targets).toHaveLength(0);
  });

  it('does not transfer an answer to another frame or a question with changed instructions', () => {
    const field = { ...workspace.scan.fields[0], frameId: 1, description: 'Applicant name' };
    const scan = { ...workspace.scan, fields: [field] };
    expect(prepareFill(scan, { ...scan, fields: [{ ...field, frameId: 2 }] }, null, workspace.values, {}).targets).toHaveLength(0);
    expect(prepareFill(scan, { ...scan, fields: [{ ...field, description: 'Name of your reference' }] }, null, workspace.values, {}).targets).toHaveLength(0);
  });
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

  it('allows optional blanks while blocking missing or invalid required answers', () => {
    expect(applicationReadiness(workspace.scan, null, workspace.values, {}, {}).some((item) => item.blocking)).toBe(false);
    expect(applicationReadiness(workspace.scan, null, {}, {}, {})[0].blocking).toBe(true);
    const scan = { ...workspace.scan, fields: [{ ...workspace.scan.fields[0], label: 'Gender', type: 'select', options: ['Man', 'Woman'] }] };
    expect(applicationReadiness(scan, null, { name: 'Man' }, {}, {})[0].status).toBe('Prepared');
    expect(applicationReadiness(scan, null, { name: 'Man' }, {}, {})[0].ready).toBe(true);
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
