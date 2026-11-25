import type { DetectedField } from './fields';

export type ApplicationPlatform = 'greenhouse' | 'standard';

export interface ApplicationScan {
  fields: DetectedField[];
  title: string;
  url: string;
  platform: ApplicationPlatform;
  company: string;
  role: string;
  applicationFrameOrigins?: string[];
  description?: string;
  jobUrl?: string;
  contextWarning?: string;
  tabId?: number;
}

export async function completeJobContext(scan: ApplicationScan): Promise<ApplicationScan> {
  if (scan.description?.trim()) return scan;
  const missing = { ...scan, contextWarning: 'The full job description was not found. Paste it below before preparing AI answers.' };
  if (!scan.jobUrl) return missing;
  const url = new URL(scan.jobUrl, scan.url);
  // Site access is already granted for the application. Never follow a link to
  // an unrelated origin or include user cookies in the extension request.
  if (url.origin !== new URL(scan.url).origin || !/^https?:$/.test(url.protocol)) return missing;
  try {
    const response = await fetch(url.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return missing;
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    let description = doc.querySelector('.ashby-job-posting-description, #content .content, [data-job-description], .posting-description, [itemprop="description"]')?.textContent?.trim() ?? '';
    if (!description) {
      const queue: unknown[] = [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap((script) => { try { return [JSON.parse(script.textContent ?? '')]; } catch { return []; } });
      while (queue.length) {
        const item = queue.shift();
        if (Array.isArray(item)) { queue.push(...item); continue; }
        if (!item || typeof item !== 'object') continue;
        const object = item as Record<string, unknown>;
        if ([object['@type']].flat().includes('JobPosting') && typeof object.description === 'string') {
          description = new DOMParser().parseFromString(object.description, 'text/html').body.textContent?.trim() ?? '';
          break;
        }
        if (object['@graph']) queue.push(object['@graph']);
      }
    }
    return description ? { ...scan, description, contextWarning: undefined } : missing;
  } catch { return missing; }
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
