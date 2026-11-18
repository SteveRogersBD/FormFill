import { describe, expect, it } from 'vitest';
import { hostPermissionPattern, inferApplicationContext, isGreenhouseHost } from '../applicationPage';

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
