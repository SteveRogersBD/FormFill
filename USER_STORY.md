# ApplyAI — User Stories

## Product vision

ApplyAI is a privacy-conscious Chrome extension that helps job seekers complete application forms faster. Users upload a resume, review and edit extracted profile information in a dashboard, then use that profile to fill supported job applications. AI is used where helpful, with clear control over cloud processing.

## Target user

A job seeker who repeatedly enters the same personal information, education, work history, skills, and written responses across different job application websites.

## Main user story

As a job seeker, I want an AI assistant that understands my background and fills job application forms for me, so that I can apply faster without repeatedly entering the same information or unnecessarily sharing my personal data with cloud AI services.

## MVP user stories and acceptance criteria

### US-01 — Upload resume and manage my profile

As a job seeker, I want to upload my resume and save additional information once, so that I can reuse it across applications.

- I can upload a PDF resume after signing in.
- The app extracts skills, university, name, LinkedIn URL, portfolio URL, email, phone number, graduation date, work experience, projects, and achievements when present.
- Extracted information is shown in a profile dashboard and can be edited before and after saving.
- Missing or unclear information is left blank or marked for review; it is not guessed.
- The original PDF is stored in Google Cloud Storage and the structured profile metadata is stored in Firestore, associated with the signed-in user.

### US-02 — Autofill an open job application

As a job seeker, I want to activate ApplyAI while a supported job application is open in Chrome, so that it can fill fields using my reviewed profile.

- I can open the extension on a supported job application page and explicitly start autofill.
- It detects accessible form fields, labels, options, and required fields.
- It supports common text inputs, text areas, select menus, radio buttons, and checkboxes where the page permits interaction.
- It shows proposed values for review and lets me edit them before or after filling.
- Unsupported or ambiguous fields are flagged instead of guessed.
- It never submits an application automatically.

### US-03 — Match profile information to application fields

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

- Chrome desktop extension with sign-in, resume upload, editable profile dashboard, and a side panel or popup for application autofill.
- Google Authentication, Cloud Storage for original resume PDFs, and Firestore for user profile metadata.
- One supported ATS platform plus a controlled test form for the hackathon demo.
- Resume parsing and editable profile dashboard, supported-page form detection, grounded autofill, review, and application history.
- Firebase AI Logic on-device and consent-based cloud inference.

## Out of scope for MVP

- Automatic submission, mass applications, or CAPTCHA bypass.
- Support for every job website or every iframe/custom widget.
- Automatic resume rewriting or cover letter generation (future features; all generated content would require user review).
- External email/calendar integrations and advanced cloud analytics.

## Definition of done

A user can sign in, upload a PDF, review and edit extracted profile fields in the dashboard, open a supported application in Chrome, activate autofill, review and edit proposed answers, fill the form, submit manually, and save a confirmed application record.
