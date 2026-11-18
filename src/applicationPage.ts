import type { DetectedField } from './fields';

export type ApplicationPlatform = 'greenhouse' | 'standard';

export interface ApplicationScan {
  fields: DetectedField[];
  title: string;
  url: string;
  platform: ApplicationPlatform;
  company: string;
  role: string;
}

export function isGreenhouseHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'boards.greenhouse.io'
    || host.endsWith('.boards.greenhouse.io')
    || host === 'job-boards.greenhouse.io'
    || host.endsWith('.job-boards.greenhouse.io');
}

export function hostPermissionPattern(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS pages can be scanned.');
  return `${url.protocol}//${url.hostname}/*`;
}

export function inferApplicationContext(hostname: string, title: string, heading = '') {
  const greenhouse = isGreenhouseHost(hostname);
  const cleanTitle = title.trim().replace(/\s*[|–—-]\s*greenhouse\s*$/i, '');
  const jobTitle = cleanTitle.match(/^(?:job application|application|apply)(?: for)?\s+(.+?)\s+at\s+(.+)$/i);

  return {
    platform: greenhouse ? 'greenhouse' as const : 'standard' as const,
    company: greenhouse ? jobTitle?.[2]?.trim() ?? '' : '',
    role: jobTitle?.[1]?.trim() || heading.trim() || cleanTitle,
  };
}
