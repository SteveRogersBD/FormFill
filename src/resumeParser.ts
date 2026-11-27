import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { emptyProfile, resumeProfileSchema, type ResumeProfile } from './profile';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const sections: Record<string, keyof Pick<ResumeProfile, 'skills' | 'workExperience' | 'projects' | 'achievements'>> = {
  skills: 'skills', technologies: 'skills', 'technical skills': 'skills', 'core competencies': 'skills', 'skills and tools': 'skills',
  experience: 'workExperience', employment: 'workExperience', 'work experience': 'workExperience', 'professional experience': 'workExperience', 'work history': 'workExperience', 'career experience': 'workExperience',
  projects: 'projects', 'personal projects': 'projects', 'selected projects': 'projects', achievements: 'achievements', 'key achievements': 'achievements', awards: 'achievements', honors: 'achievements', 'awards and honors': 'achievements', 'honors and awards': 'achievements',
};

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const STATE_CODES = new Set(Object.keys(US_STATES));
const STATE_NAMES = new Set(Object.values(US_STATES).map((name) => name.toLowerCase()));

const COUNTRIES: Record<string, string> = {
  'united states': 'United States', 'united states of america': 'United States', usa: 'United States', us: 'United States',
  canada: 'Canada', 'united kingdom': 'United Kingdom', uk: 'United Kingdom', 'great britain': 'United Kingdom', ireland: 'Ireland',
  germany: 'Germany', france: 'France', netherlands: 'Netherlands', spain: 'Spain', portugal: 'Portugal', italy: 'Italy', sweden: 'Sweden',
  norway: 'Norway', denmark: 'Denmark', finland: 'Finland', poland: 'Poland', switzerland: 'Switzerland', austria: 'Austria', belgium: 'Belgium',
  australia: 'Australia', 'new zealand': 'New Zealand', india: 'India', singapore: 'Singapore', japan: 'Japan', china: 'China', 'south korea': 'South Korea',
  brazil: 'Brazil', mexico: 'Mexico', argentina: 'Argentina', 'south africa': 'South Africa', israel: 'Israel', 'united arab emirates': 'United Arab Emirates', uae: 'United Arab Emirates',
};

const DEGREE_PATTERN = /\b(bachelor|master|doctor|ph\.?d|associate|mba|b\.?s\.?c?|m\.?s\.?c?|b\.?a\.?|m\.?a\.?)\b/i;


function cleanLines(text: string) {
  return text.split(/\n+/).map((line) => line.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
}

function parseResumeLocation(lines: string[]) {
  for (const line of lines.slice(0, 8).flatMap((line) => line.split(/\s*[|•]\s*/))) {
    const match = line.match(/^([A-Z][A-Za-z .'-]{1,40}),\s*([A-Za-z][A-Za-z .'-]{1,30}?)(?:\s+(\d{5}(?:-\d{4})?))?$/);
    if (!match) continue;
    const city = match[1].trim();
    const region = match[2].trim();
    const postalCode = match[3] ?? '';
    const state = region.length === 2 && STATE_CODES.has(region.toUpperCase())
      ? region.toUpperCase()
      : STATE_NAMES.has(region.toLowerCase()) ? region : '';
    const country = state ? '' : COUNTRIES[region.toLowerCase()] ?? '';
    if (!state && !country && !postalCode) continue;
    return { city, state, postalCode, country };
  }
  return { city: '', state: '', postalCode: '', country: '' };
}

function parseEducation(lines: string[]) {
  const line = lines.find((candidate) => DEGREE_PATTERN.test(candidate) && !/\b(university|college|institute|polytechnic)\b/i.test(candidate));
  if (!line) return { degree: '', major: '' };
  const parts = line.split(/\s*[,–—]\s*/).map((part) => part.trim())
    .filter((part) => part && !/^(?:(?:[A-Za-z]{3,9}\.?\s+)?\d{4})$/.test(part));
  const degreeIndex = parts.findIndex((part) => DEGREE_PATTERN.test(part));
  if (degreeIndex === -1) return { degree: '', major: '' };
  return { degree: parts[degreeIndex], major: parts.filter((_, index) => index !== degreeIndex).join(', ') };
}

function groupProjects(lines: string[]) {
  const projects: string[] = [];
  for (const line of lines) {
    const heading = line.length <= 180 && !/[.,;:]$/.test(line) && !/^(built|created|developed|designed|engineered|implemented|integrated|deployed|led|using|with|and)\b/i.test(line)
      && (/\s\|\s/.test(line) || (line.split(/\s+/).length <= 8 && line.split(/\s+/).every((word) => /^[A-Z0-9]/.test(word) || /^(of|and|for|the|a|in|with)$/i.test(word))));
    if (heading || !projects.length) projects.push(line);
    else projects[projects.length - 1] += `\n${line}`;
  }
  return projects;
}

export function extractProfileFromText(text: string): ResumeProfile {
  if (!text.trim()) throw new Error('This PDF has no selectable text. It may be scanned; OCR is not included yet. Your file is still selected, so you can enter details manually and save it.');
  const lines = cleanLines(text);
  const profile = emptyProfile();
  profile.fullName = lines.find((line) => !/^(resume|curriculum vitae|cv)$/i.test(line) && !line.includes('@') && !/https?:\/\//i.test(line)) ?? '';
  profile.email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? '';
  profile.phone = (text.match(/(?:\+?\d[\d\s().-]{5,}\d)/g) ?? []).find((candidate) => {
    const digits = candidate.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15 && !/\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b/.test(candidate);
  })?.trim() ?? '';
  profile.linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|pub)\/[\w-]+/i)?.[0] ?? '';
  const urls = [...text.matchAll(/(?:https?:\/\/|www\.|(?:github\.com|gitlab\.com)\/)[^\s)>,]+/g)].map((match) => match[0].replace(/[.,;]+$/, ''));
  profile.portfolio = urls.find((url) => !/linkedin\.com/i.test(url)) ?? '';
  profile.university = lines.find((line) => /\b(university|college|institute|polytechnic)\b/i.test(line)) ?? '';

  let activeSection: keyof Pick<ResumeProfile, 'skills' | 'workExperience' | 'projects' | 'achievements'> | undefined;
  let inEducation = false;
  const educationLines: string[] = [];
  const experienceLines: string[] = [];
  for (const line of lines) {
    const heading = line.toLowerCase().replace(/&/g, 'and').replace(/[:\s]+$/, '').replace(/\s+/g, ' ');
    const section = sections[heading];
    if (section) {
      activeSection = section;
      inEducation = false;
      continue;
    }
    if (heading === 'education') {
      activeSection = undefined;
      inEducation = true;
      continue;
    }
    if (/^(summary|objective|certifications?)$/i.test(heading)) {
      activeSection = undefined;
      inEducation = false;
      continue;
    }
    if (activeSection === 'workExperience') experienceLines.push(line);
    else if (activeSection) profile[activeSection].push(line);
    if (inEducation) educationLines.push(line);
  }
  profile.university = educationLines.find((line) => /\b(university|college|institute|polytechnic)\b/i.test(line)) ?? profile.university;
  profile.graduationDate = educationLines.join('\n').match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[,\s]+20\d{2}\b|\b20\d{2}\b/g)?.at(-1) ?? '';
  profile.skills = [...new Set(profile.skills.flatMap((line) => line.split(/[,|•;]/).map((skill) => skill.trim()).filter(Boolean)))];
  profile.projects = groupProjects(profile.projects);

  const location = parseResumeLocation(lines);
  profile.city = location.city;
  profile.state = location.state;
  profile.postalCode = location.postalCode;
  profile.country = location.country;
  const education = parseEducation(educationLines);
  profile.degree = education.degree;
  profile.major = education.major;
  profile.workExperience = resumeProfileSchema.shape.workExperience.parse(experienceLines);
  const currentRole = profile.workExperience.find((entry) => entry.jobTitle);
  profile.currentTitle = currentRole?.jobTitle ?? '';
  profile.currentCompany = currentRole?.company ?? '';
  return profile;
}

export async function extractResumeText(bytes: ArrayBuffer): Promise<string> {
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => 'str' in item ? `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}` : '').join(''));
    }
    const text = pages.join('\n').trim();
    if (!text) throw new Error('The saved resume has no selectable text. Paste its text into the application workspace.');
    return text;
  } finally { await document.destroy(); }
}

export async function extractProfile(file: File): Promise<ResumeProfile> {
  const bytes = await file.arrayBuffer();
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    const pageTexts: string[] = [];
    const links: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map((item) => 'str' in item ? `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}` : '').join(''));
      // Many PDFs show "LinkedIn" or "Portfolio" while keeping the URL only in a link annotation.
      for (const annotation of await page.getAnnotations()) {
        if (typeof annotation.url === 'string' && /^https?:\/\//i.test(annotation.url)) links.push(annotation.url);
      }
    }
    const profile = extractProfileFromText(pageTexts.join('\n'));
    if (!profile.linkedin) profile.linkedin = links.find((url) => /^(?:https?:\/\/)(?:www\.)?linkedin\.com\/(in|pub)\//i.test(url)) ?? '';
    if (!profile.portfolio) profile.portfolio = links.find((url) => !/linkedin\.com/i.test(url)) ?? '';
    return profile;
  } finally { await document.destroy(); }
}
