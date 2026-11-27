import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { extractProfile, extractProfileFromText, extractResumeText } from '../resumeParser';

const resumeText = `
Jane Doe
jane.doe@example.com
+1 (555) 212-5555
https://linkedin.com/in/jane-doe
https://janedoe.dev

EDUCATION
State University
Bachelor of Science, Computer Science
Expected graduation: May 2026

SKILLS
TypeScript, React, Accessibility

WORK EXPERIENCE
Product Designer at Northstar Studio
Led user research and prototyping.

PROJECTS
Application Tracker
Built a job search dashboard.

ACHIEVEMENTS
Design Challenge Winner
Recognized for inclusive product design.
`;

describe('extractProfileFromText', () => {
  it('separates three company-first positions and three projects with wrapped descriptions', () => {
    const profile = extractProfileFromText(`Riley Example
WORK EXPERIENCE
First Studio | Co-Founder and Full-Stack Developer   Remote | June 2025–Present
Built a streaming platform supporting
thousands of users.
Second Lab | Forward Deployed Engineer   California | June 2026– Aug 2026
Engineered retrieval tools.
Third Company | Backend Engineer   Remote | Jan 2026–May 2026
Built APIs.
Projects
Project Alpha | Code Oct 2026–Present
Engineered a planning tool with
interactive editing.
Project Beta | Code | Demo Mar 2026
Developed an educational assistant.
Project Gamma | Code | Demo Jan 2026–Feb 2026
Deployed a recipe service.`);
    expect(profile.workExperience.map(({ company, jobTitle, location }) => [company, jobTitle, location])).toEqual([
      ['First Studio', 'Co-Founder and Full-Stack Developer', 'Remote'], ['Second Lab', 'Forward Deployed Engineer', 'California'], ['Third Company', 'Backend Engineer', 'Remote'],
    ]);
    expect(profile.workExperience[1].description).toEqual(['Engineered retrieval tools.']);
    expect(profile.projects).toHaveLength(3);
    expect(profile.projects[0]).toBe('Project Alpha | Code Oct 2026–Present\nEngineered a planning tool with\ninteractive editing.');
    expect(profile.projects[1]).not.toContain('Project Gamma');
  });

  it('retains unstructured source evidence when extracting the full saved PDF text', async () => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
    const bytes = await readFile(new URL('./fixtures/sample-resume.pdf', import.meta.url));
    const text = await extractResumeText(Uint8Array.from(bytes).buffer);
    expect(text).toContain('Riley Example');
    expect(text).toContain('Led user research and prototyping.');
    expect(text).toContain('Design Fellowship');
  });
  it('reads inline contact locations and links without a URL scheme', () => {
    expect(extractProfileFromText('Jane Doe\njane@example.com | Chicago, IL 60601 | +1 555 212 5555\nwww.janedoe.dev\nlinkedin.com/in/jane-doe')).toMatchObject({
      city: 'Chicago', state: 'IL', postalCode: '60601', portfolio: 'www.janedoe.dev', linkedin: 'linkedin.com/in/jane-doe',
    });
  });
  it('extracts the resume profile details for review', () => {
    expect(extractProfileFromText(resumeText)).toMatchObject({
      fullName: 'Jane Doe',
      email: 'jane.doe@example.com',
      phone: '+1 (555) 212-5555',
      linkedin: 'https://linkedin.com/in/jane-doe',
      portfolio: 'https://janedoe.dev',
      university: 'State University',
      graduationDate: 'May 2026',
      skills: ['TypeScript', 'React', 'Accessibility'],
      workExperience: [{ jobTitle: 'Product Designer', company: 'Northstar Studio', description: ['Led user research and prototyping.'] }],
      projects: ['Application Tracker\nBuilt a job search dashboard.'],
      achievements: ['Design Challenge Winner', 'Recognized for inclusive product design.'],
    });
  });

  it('extracts the location, degree, major, and current role', () => {
    expect(extractProfileFromText(resumeText)).toMatchObject({
      degree: 'Bachelor of Science',
      major: 'Computer Science',
      currentTitle: 'Product Designer',
      currentCompany: 'Northstar Studio',
    });

    const located = extractProfileFromText(`
      Alex Kim
      alex@example.com
      San Francisco, CA 94103
      EDUCATION
      City Institute
      B.S. in Computer Science
      WORK EXPERIENCE
      Product Designer at Northstar Studio
      Led research studies.
    `);
    expect(located).toMatchObject({
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94103',
      degree: 'B.S. in Computer Science',
      currentTitle: 'Product Designer',
      currentCompany: 'Northstar Studio',
    });
  });

  it('extracts profile details from an actual PDF file', async () => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
    const bytes = await readFile(new URL('./fixtures/sample-resume.pdf', import.meta.url));
    const file = new File([new Uint8Array(bytes)], 'sample-resume.pdf', { type: 'application/pdf' });

    await expect(extractProfile(file)).resolves.toMatchObject({
      fullName: 'Riley Example',
      email: 'riley@example.test',
      phone: '+1 555 010 1234',
      linkedin: 'https://linkedin.com/in/riley-example',
      portfolio: 'https://riley.example.test',
      university: 'Example University',
      graduationDate: 'May 2027',
      skills: ['TypeScript', 'React', 'Accessibility'],
      workExperience: [{ jobTitle: 'Designer', company: 'Example Studio', description: ['Led user research and prototyping.'] }],
      projects: ['Application Assistant\nBuilt a form autofill prototype.'],
      achievements: ['Design Fellowship'],
    });
  });

  it('rejects textless resumes so missing facts are not guessed', () => {
    expect(() => extractProfileFromText('  ')).toThrow('no selectable text');
  });

  it('does not treat a graduation year range as a phone number', () => {
    const profile = extractProfileFromText('Jane Doe\njane@example.com\nEDUCATION\nState University\n2020 - 2024');
    expect(profile.phone).toBe('');
  });

  it('recognizes common alternate section headings', () => {
    const profile = extractProfileFromText(`
      Alex Kim
      EDUCATION
      City Institute
      CORE COMPETENCIES
      TypeScript, React
      PROFESSIONAL EXPERIENCE
      Designer at Northstar
      WORK HISTORY
      Led research studies.
      PERSONAL PROJECTS
      Job Search Tracker
      AWARDS & HONORS
      Design Fellowship
    `);

    expect(profile).toMatchObject({
      skills: ['TypeScript', 'React'],
      workExperience: [{ jobTitle: 'Designer', company: 'Northstar', description: ['Led research studies.'] }],
      projects: ['Job Search Tracker'],
      achievements: ['Design Fellowship'],
    });
  });
});
