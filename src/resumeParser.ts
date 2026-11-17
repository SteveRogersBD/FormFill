import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { emptyProfile, type ResumeProfile } from './profile';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const sections: Record<string, keyof Pick<ResumeProfile, 'skills' | 'workExperience' | 'projects' | 'achievements'>> = {
  skills: 'skills', technologies: 'skills', 'technical skills': 'skills',
  experience: 'workExperience', employment: 'workExperience', 'work experience': 'workExperience',
  projects: 'projects', achievements: 'achievements', awards: 'achievements', honors: 'achievements',
};

function cleanLines(text: string) {
  return text.split(/\n+/).map((line) => line.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
}

export function extractProfileFromText(text: string): ResumeProfile {
  if (!text.trim()) throw new Error('This PDF has no selectable text. It may be scanned; OCR is not included yet. Your file is still selected, so you can enter details manually and save it.');
  const lines = cleanLines(text);
  const profile = emptyProfile();
  profile.fullName = lines.find((line) => !/^(resume|curriculum vitae|cv)$/i.test(line) && !line.includes('@') && !/https?:\/\//i.test(line)) ?? '';
  profile.email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? '';
  profile.phone = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() ?? '';
  profile.linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|pub)\/[\w-]+/i)?.[0] ?? '';
  const urls = [...text.matchAll(/https?:\/\/[^\s)>,]+/g)].map((match) => match[0].replace(/[.,;]+$/, ''));
  profile.portfolio = urls.find((url) => !/linkedin\.com/i.test(url)) ?? '';
  profile.university = lines.find((line) => /\b(university|college|institute|polytechnic)\b/i.test(line)) ?? '';

  let activeSection: keyof Pick<ResumeProfile, 'skills' | 'workExperience' | 'projects' | 'achievements'> | undefined;
  let inEducation = false;
  const educationLines: string[] = [];
  for (const line of lines) {
    const heading = line.toLowerCase().replace(/[:\s]+$/, '');
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
    if (activeSection) profile[activeSection].push(line);
    if (inEducation) educationLines.push(line);
  }
  profile.university = educationLines.find((line) => /\b(university|college|institute|polytechnic)\b/i.test(line)) ?? profile.university;
  profile.graduationDate = educationLines.join('\n').match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[,\s]+20\d{2}\b|\b20\d{2}\b/g)?.at(-1) ?? '';
  profile.skills = [...new Set(profile.skills.flatMap((line) => line.split(/[,|•;]/).map((skill) => skill.trim()).filter(Boolean)))];
  return profile;
}

export async function extractProfile(file: File): Promise<ResumeProfile> {
  const bytes = await file.arrayBuffer();
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => 'str' in item ? `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}` : '').join(''));
  }
  return extractProfileFromText(pageTexts.join('\n'));
}
