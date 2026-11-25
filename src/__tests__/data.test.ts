import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { emptyPreferences, preferencesSchema } from '../preferences';
import { loadPreferences, savePreferences } from '../data';

const mocks = vi.hoisted(() => ({ setDoc: vi.fn(), getDoc: vi.fn(), doc: vi.fn() }));
vi.mock('../firebase', () => ({ getFirebaseServices: async () => ({ db: {} }) }));
vi.mock('firebase/firestore', () => ({ doc: mocks.doc, getDoc: mocks.getDoc, setDoc: mocks.setDoc }));

const documents = new Map<string, Record<string, unknown>>();
beforeEach(() => {
  vi.clearAllMocks(); documents.clear();
  mocks.doc.mockImplementation((_db, ...segments: string[]) => segments.join('/'));
  mocks.setDoc.mockImplementation(async (path: string, value: Record<string, unknown>) => { documents.set(path, structuredClone(value)); });
  mocks.getDoc.mockImplementation(async (path: string) => ({ exists: () => documents.has(path), data: () => structuredClone(documents.get(path)) }));
});

describe('Equal Employment persistence', () => {
  it('keeps old answers after a denied write and explains the deployment problem', async () => {
    const saved = await savePreferences({ ...emptyPreferences(), workCountries: 'Canada' }, 'owner');
    mocks.setDoc.mockRejectedValueOnce({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });
    await expect(savePreferences({ ...emptyPreferences(), workCountries: 'United States' }, 'owner')).rejects.toThrow('Equal Employment answers were not saved');
    expect(await loadPreferences('owner')).toEqual(saved);
  });
  it('does not acknowledge a save before Firestore acknowledges the write', async () => {
    let acknowledge!: () => void;
    mocks.setDoc.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    let completed = false;
    const saving = savePreferences(emptyPreferences(), 'owner').then(() => { completed = true; });
    await vi.waitFor(() => expect(mocks.setDoc).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    acknowledge(); await saving;
    expect(completed).toBe(true);
  });
  it('reads back every saved answer from the same per-user document', async () => {
    const answers = { ...emptyPreferences(), workCountries: 'United States, Canada', usCitizen: 'no' as const, workAuthorized: 'yes' as const, sponsorshipNowOrFuture: 'yes' as const, lgbtqIdentity: 'decline' as const, eeoOptIn: false };
    const saved = await savePreferences(answers, 'owner');
    expect(mocks.setDoc).toHaveBeenCalledWith('users/owner/preferences/current', expect.objectContaining(answers));
    expect(await loadPreferences('owner')).toEqual(saved);
    expect(saved.updatedAt).toEqual(expect.any(Number));
    expect(await loadPreferences('another-account')).toBeNull();
  });
});
