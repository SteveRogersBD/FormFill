# ApplyAI — User Stories

## Product vision

ApplyAI is a privacy-first Chrome extension that helps job seekers complete job applications faster. It uses the applicant's saved profile, resume, and approved answers to understand and fill application forms, primarily using on-device AI.

## Target user

A job seeker who repeatedly enters the same personal information, education, work history, skills, and written responses across different job application websites.

## Main user story

As a job seeker, I want an AI assistant that understands my background and fills job application forms for me, so that I can apply faster without repeatedly entering the same information or unnecessarily sharing my personal data with cloud AI services.

## MVP user stories and acceptance criteria

### US-01 — Create my profile

As a job seeker, I want to upload my resume and save additional information once, so that I can reuse it across applications.

- I can upload a PDF resume and enter or edit my profile details.
- Extracted information can be reviewed and corrected before saving.
- My profile is stored locally by default and persists across browser sessions.

### US-02 — Detect application fields

As a job seeker, I want the extension to understand the job application page, so that I do not have to identify each field manually.

- When I activate the extension, it detects accessible form fields, labels, options, and required fields on a supported page.
- It understands common text inputs, text areas, select menus, radio buttons, and checkboxes.
- Unsupported or ambiguous fields are flagged instead of guessed.

### US-03 — Fill in my information

As a job seeker, I want the extension to fill out the application using my saved information, so that I can avoid repetitive work.

- Known facts are filled directly from my approved profile.
- On-device AI matches unfamiliar field labels to relevant profile information.
- Open-ended questions use relevant resume details and approved answers to draft truthful responses.
- Unknown facts, work authorization, sponsorship, salary, and other sensitive or consequential answers require my confirmation unless explicitly saved by me.
- I can review and edit every answer. The extension never submits an application automatically.

### US-04 — Use hybrid AI

As a privacy-conscious job seeker, I want personal information processed locally whenever possible, so that I control what leaves my device.

- The extension checks on-device model availability and displays the inference mode.
- Supported local inference works without an AI cloud request once the required model is available; the job website itself may still require internet.
- If local inference is unavailable or insufficient, the extension offers a cloud option and explains what information would be sent before requesting approval.
- A failed or unavailable model does not prevent deterministic autofill.

### US-05 — Track applications

As a job seeker, I want a record of my applications, so that I can track progress and avoid duplicate applications.

- I can view the company, role, URL, date, and application status.
- An application is marked submitted only after I confirm submission or the extension identifies a supported, reliable confirmation page.
- I can update the status and delete records.
- Cloud synchronization is optional and stores only approved application metadata.

## MVP scope

- Chrome desktop extension with an onboarding/profile screen and a side panel or popup.
- One supported ATS platform plus a controlled test form for the hackathon demo.
- Local profile storage, form detection, grounded autofill, review, and application history.
- Firebase AI Logic on-device and consent-based cloud inference.

## Out of scope for MVP

- Automatic submission, mass applications, or CAPTCHA bypass.
- Support for every job website or every iframe/custom widget.
- Automatic resume rewriting or cover letter generation.
- External email/calendar integrations and advanced cloud analytics.

## Definition of done

A user can upload and verify a resume, open a supported application, activate ApplyAI, see a locally grounded set of answers, review and edit the filled fields, submit manually, and save a confirmed application record. The demo also shows the difference between on-device and approved cloud inference.
