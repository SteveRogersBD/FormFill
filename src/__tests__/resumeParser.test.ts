import { describe, expect, it } from 'vitest';
import { extractProfileFromText } from '../resumeParser';

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
      workExperience: ['Product Designer at Northstar Studio', 'Led user research and prototyping.'],
      projects: ['Application Tracker', 'Built a job search dashboard.'],
      achievements: ['Design Challenge Winner', 'Recognized for inclusive product design.'],
    });
  });

  it('rejects textless resumes so missing facts are not guessed', () => {
    expect(() => extractProfileFromText('  ')).toThrow('no selectable text');
  });
});
