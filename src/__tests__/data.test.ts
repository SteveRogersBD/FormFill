import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { emptyPreferences, preferencesSchema } from '../preferences';
import { loadPreferences, savePreferences, saveProfile, saveResume } from '../data';
import { emptyProfile } from '../profile';

const mocks = vi.hoisted(() => ({ setDoc: vi.fn(), getDoc: vi.fn(), doc: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock('../firebase', () => ({ getFirebaseServices: async () => ({ db: {}, storage: {} }) }));
vi.mock('firebase/firestore', () => ({ doc: mocks.doc, getDoc: mocks.getDoc, setDoc: mocks.setDoc }));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => path, uploadBytes: mocks.upload, deleteObject: mocks.remove }));

const documents = new Map<string, Record<string, unknown>>();
beforeEach(() => {
  vi.clearAllMocks(); documents.clear();
  mocks.doc.mockImplementation((_db, ...segments: string[]) => segments.join('/'));
  mocks.setDoc.mockImplementation(async (path: string, value: Record<string, unknown>) => { documents.set(path, structuredClone(value)); });
  mocks.getDoc.mockImplementation(async (path: string) => ({ exists: () => documents.has(path), data: () => structuredClone(documents.get(path)) }));
});

describe('Equal Employment persistence', () => {
  it('explains missing PDF buckets and can save the reviewed profile independently', async () => {
    mocks.upload.mockRejectedValueOnce({ code: 'storage/unknown', serverResponse: '{"error":{"code":404}}' });
    const profile = { ...emptyProfile(), fullName: 'Riley Example' };
    await expect(saveResume(new File(['pdf'], 'resume.pdf', { type: 'application/pdf' }), profile, 'owner')).rejects.toThrow('Storage bucket is unavailable');
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    const saved = await saveProfile(profile, 'owner');
    expect(saved).toMatchObject({ fullName: 'Riley Example', resumePath: '', updatedAt: expect.any(Number) });
    expect(mocks.setDoc).toHaveBeenCalledWith('users/owner/profile/current', saved);
  });

  it('requires Firestore rules to allow every serialized preference field', async () => {
    const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const preferencesRule = rules.split('match /users/{userId}/preferences/{preferenceId}')[1].split('match /users/{userId}/applications')[0];
    const allowedList = preferencesRule.split('hasOnly([')[1].split('])')[0];
    const allowedKeys = [...allowedList.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(new Set(allowedKeys)).toEqual(new Set(Object.keys(preferencesSchema.shape)));
  });
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
