// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeJobContext, hostPermissionPattern, inferApplicationContext, isGreenhouseHost } from '../applicationPage';

afterEach(() => vi.unstubAllGlobals());
describe('full job context', () => {
  const scan = { fields: [], title: 'Engineer', url: 'https://jobs.example.com/job/application', jobUrl: 'https://jobs.example.com/job', platform: 'standard' as const, company: 'Example', role: 'Engineer' };
  it('retrieves the entire associated posting without sending cookies', async () => {
    const text = 'Full responsibilities '.repeat(1000) + 'FINAL REQUIREMENT';
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => `<div data-job-description>${text}</div>` });
    vi.stubGlobal('fetch', fetch);
    expect((await completeJobContext(scan)).description).toBe(text);
    expect(fetch).toHaveBeenCalledWith(scan.jobUrl, expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
  });
  it('reads structured JobPosting descriptions and explains missing context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","description":"<p>Full JD</p>"}]}</script>' }));
    expect((await completeJobContext(scan)).description).toBe('Full JD');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('blocked')));
    expect((await completeJobContext(scan)).contextWarning).toContain('Paste it below');
  });
  it('does not fetch unrelated origins or fetch again when context is present', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await completeJobContext({ ...scan, jobUrl: 'https://other.example.com/job' })).contextWarning).toBeTruthy();
    expect(await completeJobContext({ ...scan, description: 'Already collected' })).toMatchObject({ description: 'Already collected' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('hostPermissionPattern', () => {
  it('requests only the current site origin', () => {
    expect(hostPermissionPattern('https://jobs.ashbyhq.com/company/job/apply')).toBe('https://jobs.ashbyhq.com/*');
  });

  it('rejects browser-internal pages', () => {
    expect(() => hostPermissionPattern('chrome://extensions')).toThrow('Only HTTP and HTTPS pages can be scanned.');
  });
});

describe('Greenhouse application context', () => {
  it.each(['boards.greenhouse.io', 'job-boards.greenhouse.io', 'careers.boards.greenhouse.io'])('recognizes %s', (hostname) => {
    expect(isGreenhouseHost(hostname)).toBe(true);
  });

  it('extracts the role and company from a Greenhouse application title', () => {
    expect(inferApplicationContext('boards.greenhouse.io', 'Job Application for Product Designer at Northstar Studio | Greenhouse')).toEqual({
      platform: 'greenhouse',
      company: 'Northstar Studio',
      role: 'Product Designer',
    });
  });

  it('leaves the company blank when Greenhouse page context is unclear', () => {
    expect(inferApplicationContext('job-boards.greenhouse.io', 'Apply now', 'Senior Designer')).toEqual({
      platform: 'greenhouse',
      company: '',
      role: 'Senior Designer',
    });
  });

  it('keeps other forms in generic mode', () => {
    expect(inferApplicationContext('careers.example.com', 'Designer', 'Product Designer')).toEqual({
      platform: 'standard',
      company: '',
      role: 'Product Designer',
    });
  });
});
