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
