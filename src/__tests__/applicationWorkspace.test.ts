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
