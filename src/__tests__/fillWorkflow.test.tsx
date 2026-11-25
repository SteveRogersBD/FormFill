// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://jobs.ashbyhq.com/apex-technology-inc/692bb497-59ba-44df-bacf-fffd2f7c6344/application?jr_id=test"}
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { emptyProfile } from '../profile';
import { emptyPreferences } from '../preferences';
import { SidePanel } from '../SidePanel';

vi.mock('../firebase', () => ({ firebaseAppCheckReady: false }));
vi.mock('../data', () => ({
  loadProfile: async () => ({ ...emptyProfile(), updatedAt: 1, fullName: 'Riley Example', email: 'riley@example.test', phone: '+15550101234', postalCode: '60601', linkedin: 'https://linkedin.com/in/riley-example' }),
  loadPreferences: async () => ({ ...emptyPreferences() }), listApplications: async () => [], getResumeText: vi.fn(), getResumeAttachment: vi.fn(), saveApplication: vi.fn(), updateApplication: vi.fn(),
}));
vi.mock('../plannerModel', async () => {
  const { runPlanner } = await import('../plannerGraph');
  return { planApplication: (input: Parameters<typeof runPlanner>[0]) => runPlanner(input, { prepareDevice: async () => false, device: vi.fn(), cloud: vi.fn() }) };
});

const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach((root) => root.unmount()); });
  document.body.innerHTML = ''; vi.unstubAllGlobals();
  delete (globalThis as any).__applyAiPageListenerInstalled;
});
