# ApplyAI prototype

ApplyAI is a Manifest V3 Chrome extension prototype. It stores the original PDF in Firebase Storage and the user-reviewed profile and application history in Firestore. PDF text extraction happens in the browser; extracted fields are suggestions until the user checks and saves them.

## 1. Configure Firebase

1. Create a Firebase project and add a Web app. Copy its web configuration into `.env.local` using `.env.example` as a guide. The Firebase web API key is a public client identifier; security comes from Firebase Authentication and rules, not keeping this value secret.
2. In Firebase Authentication, enable Google as a provider.
3. Create a Firestore database and a Cloud Storage bucket.
4. Deploy the included per-user rules:

   ```sh
   npx firebase-tools deploy --only firestore:rules,storage
   ```

5. Set `VITE_FIREBASE_AUTH_HELPER_URL` to `https://<project-id>.web.app/auth-helper.html`. The included helper page is needed because Google popup sign-in in a Manifest V3 extension uses an offscreen document and a hosted page.
6. Build and deploy the helper page to Firebase Hosting:

   ```sh
   npm run build
   npx firebase-tools deploy --only hosting
   ```

7. Install the extension from `dist` at `chrome://extensions` with Developer mode and **Load unpacked**. Copy its extension ID. In Firebase Authentication’s authorized domains, add `chrome-extension://<extension-id>` and the Hosting domain. Reload the extension after changing configuration.

The Firebase project's Hosting domain must be on `web.app` (or you must add the alternate origin to the manifest's frame and host allowlists). Enable Google sign-in for that domain in Firebase Authentication.

## 2. Run locally

Use Node.js 24.12 or newer and install dependencies:

```sh
npm install
npm run dev
```

The Vite server gives you the dashboard for UI work. For the extension, run `npm run build` and load `dist` as an unpacked extension. The controlled form is served at `/test-form.html` by the Vite server and is also copied into `dist` for preview hosting.

## 3. Try the prototype

1. Open ApplyAI and sign in with Google.
2. Upload a text-based PDF resume. The browser extracts a first pass for name, email, phone, links, location, education (degree and major), current role, skills, experience, projects, and achievements. Add your target role in the dashboard as a guided profile detail. Scanned image-only PDFs need OCR, which is not included. You can still edit or enter details manually.
3. Review and edit all fields, then save. The PDF is uploaded to `resumes/<uid>/...`; profile JSON is saved under `users/<uid>/profile/current`.
4. Open the demo form at `https://<project-id>.web.app/test-form.html` or from the Vite server. Click the extension icon, then **Scan and analyze with AI**. The extension stages the application, loads your saved facts and full context, selects one ready provider, and shows prepared answers. Optionally enable **Allow cloud AI** before scanning. If job context is missing, paste the full JD in the workspace and choose **Analyze answers again**. Edit answers, approve sensitive answers and written drafts, then choose **Fill reviewed answers** once required questions are ready. The extension never submits the form. Cover-letter tailoring is deferred; complete those fields manually.
5. After manually submitting a real application, use **I submitted this application** to save it. The dashboard lets you change status or delete the record.

Under **Equal Employment → Edit → Right to work**, save work authorization and the separate **now or in the future** employer-sponsorship answer, then choose **Update**. The combined answer maps directly to the Illumio/Ashby immigration-case question; current-only and future-only sponsorship remain separate. Existing profiles leave the combined answer unset until you choose it. After updating from an older build, deploy the updated `firestore.rules` (`npx firebase-tools deploy --only firestore:rules`) so Firestore accepts the new preferences, reload the extension, and update your answers. Rescan the application and approve these consequential answers in the panel before filling.

## Profile dashboard

The dashboard is an overview with Personal, Education, Work Experience, Skills, and Equal Employment section tabs. Each section's edit button opens a drawer. **Update** saves that drawer's reviewed changes; **Cancel**, the close button, or Escape discards the draft. Network or validation errors keep the draft available for correction and retry. Application history and resume upload remain available from the dashboard navigation and tools.

Work Experience supports separate entries for job title, company, job type, location, start month, end month, current employment, summary, and description bullets. Add or remove roles and bullets inside the drawer. A current role has no end date; an end month cannot precede its start month. Existing plain-text experience is converted on read into structured entries, retaining unstructured notes for review. Explicit `Job title at Company` headings are grouped into roles; missing employer, date, location, or job type is not invented. The next profile save persists the structured version. Autofill and AI prompts format these entries as readable career evidence.

Equal Employment includes the reference's common questions: desired work countries, U.S. citizenship, work authorization, combined sponsorship, authorization basis, disability, LGBTQ+ identification, gender, veteran status, race/ethnicity, Hispanic/Latino identification, and sexual orientation. Other standing questions remain in the same drawer. Missing answers display **Not provided**; demographic sharing defaults to off and still requires your opt-in. New answers require the current Firestore rules to be deployed before saving.

## Site access

Open ApplyAI from its toolbar icon while the job page is active. On the first scan for a site, ApplyAI shows an **Allow access to [site]** button in its side panel. Click it, approve Chrome's permission prompt, and ApplyAI scans the page. If the application is embedded from another ATS site, ApplyAI asks separately for that site too. Permissions remain until revoked in `chrome://extensions` → **ApplyAI** → **Details** → **Site access**. ApplyAI does not request access to every site.

## AI behavior

The extension runs a LangGraph workflow: **saved facts → provider readiness and capacity → one batch generation → validation → review → fill and verify**. LangChain Core runnables wrap generation and structured JSON parsing. The graph runs inside the side panel; no Python server is required.

The model sees every question, instruction, required flag and offered option, the **entire extracted job description**, the **complete extracted resume text**, reviewed structured profile, permitted standing answers and fixed answers. No JD, resume or profile-array truncation is performed. Previously resolved or manually edited answers stay fixed; only unresolved supported questions are AI targets. Facts resolve from saved keys. Equivalent option wording is held for review with the original saved fact shown. Career questions such as “Why hire you?” and “Why are you interested?” receive drafts supported by career evidence and job requirements. Unknown facts remain unanswered; users must review every drafted claim.

On-device generation uses Chrome's Prompt API directly to measure the full prompt plus JSON schema against actual session capacity, with output reserve, before generating. Only an already downloaded, available model with measurable capacity is selected. Otherwise, approved cloud generation uses Firebase AI Logic `ONLY_IN_CLOUD` with structured output and App Check. Generation errors, invalid JSON and incomplete answers never trigger another generation automatically. Saved facts covering the form require zero AI calls. See [Chrome Prompt API capacity and structured output](https://developer.chrome.com/docs/ai/prompt-api) and [Firebase structured output](https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output).

Cloud consent covers questions/options, full JD, resume text, reviewed profile (including contact/location), and standing answers allowed by sharing settings. Saved EEO values are excluded unless EEO sharing is enabled. Sensitive answers, narrative drafts and semantic option mappings require approval before filling. Storage paths never enter model prompts. There is no remote graph checkpoint or LangSmith tracing configured.

The scanner extracts JD content or JobPosting structured data and attempts to read an associated posting with existing site access. If JD or saved PDF text extraction fails, paste the missing context in **Job and resume context** before analyzing. When no PDF is saved, the structured profile supplies career evidence. Resume text is extracted locally; reviewed profile facts take precedence over older source text.

The application, plan, edits, approvals, full context and field results persist in account-scoped `chrome.storage.session`. Reopening the panel restores them without another AI call. **Discard**, signing out, or ending the browser session clears temporary data. Cloud consent is not restored. **Fill reviewed answers** requires all required answers to be ready. When gaps remain, **Fill prepared answers** explicitly enters only valid, approved answers and leaves the rest unchanged. A missing essay or unapproved sensitive answer does not prevent this action from filling contact details. Before filling, the extension checks the application tab and validates each target against its current control, then reads accepted state back after page handlers run. Changed or inaccessible controls are skipped individually. Newly revealed questions require another scan. ATS server acceptance and file-upload processing still need manual review.

Enable Firebase AI Logic and configure/enforce App Check for cloud AI. `VITE_FIREBASE_AI_MODEL` optionally overrides the default `gemini-3.5-flash-lite`. On-device inference requires compatible desktop Chrome and a downloaded Prompt API model; the panel does not automatically download one. Tests use mocked model adapters, DOM fixtures, actual PDF extraction and session persistence. They do not establish live inference availability on a particular installation.

Use **Analyze answers again** to explicitly start another batch after enabling cloud AI, changing context or saving profile facts. It reloads your profile and keeps manual edits fixed. **Scan and analyze again** preserves edits for matching stable questions on the same application and resets approvals. Different applications start fresh. Newly revealed or subsequent application steps need another scan. Resume and cover-letter tailoring remain deferred; saved-resume attachment is retained.

## Checks

```sh
npm run typecheck
npm run build
```

The scanner supports accessible native controls and Ashby question containers, Yes/No button choices and location autocomplete. Greenhouse hosted forms are also recognized. This does not guarantee every custom widget is supported. Embedded ATS frames require their own site access. Saved resume PDFs can be attached to a detected native resume file control; other uploads need manual handling. A semantic AI match does not guarantee that an ATS widget will accept the answer; check any fill failure in the panel and on the page.

For cloud AI, register the web app with Firebase App Check and configure its reCAPTCHA v3 site key as `VITE_FIREBASE_APPCHECK_SITE_KEY`. For local development only, set `VITE_FIREBASE_APPCHECK_DEBUG=true`, run the extension, and register the generated debug token in Firebase App Check. Never ship the debug setting or token.

Unpacked extension development uses an App Check custom provider while debug mode is enabled. Firebase still exchanges the registered debug token with its App Check service; the custom provider prevents reCAPTCHA's remote script from loading inside the extension, where Manifest V3 blocks it. If the console reports a rejected debug token, register that extension's token under **Firebase Console → App Check → your web app → Manage debug tokens**, then reload. Keep the token private. Turning debug mode off for a public extension release requires an extension-compatible production attestation flow; direct reCAPTCHA initialization is for hosted web pages.


Run the automated unit tests with `npm test`.
