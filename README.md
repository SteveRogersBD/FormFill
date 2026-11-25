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
4. Open the demo form at `https://<project-id>.web.app/test-form.html` or from the Vite server. Click the extension icon to open the side panel, then **Scan and analyze with AI**. The extension loads your latest saved profile, scans the current form, runs its on-device planner, and shows answers and their supporting facts. Optionally enable **Allow cloud fallback** before scanning to retry unresolved questions in the cloud. Edit answers, approve sensitive answers and written drafts, then choose **Fill reviewed answers**. The extension never submits the form. Cover-letter tailoring is deferred; complete those fields manually.
5. After manually submitting a real application, use **I submitted this application** to save it. The dashboard lets you change status or delete the record.

Under **Standing answers → Right to work**, save work authorization and the separate **now or in the future** employer-sponsorship answer. The combined answer maps directly to the Illumio/Ashby immigration-case question; current-only and future-only sponsorship remain separate. Existing profiles leave the combined answer unset until you choose it. After updating from an older build, deploy the updated `firestore.rules` (`npx firebase-tools deploy --only firestore:rules`) so Firestore accepts the new preference, reload the extension, and save standing answers. Rescan the application and approve these consequential answers in the panel before filling.

## Site access

Open ApplyAI from its toolbar icon while the job page is active. On the first scan for a site, ApplyAI shows an **Allow access to [site]** button in its side panel. Click it, approve Chrome's permission prompt, and ApplyAI scans the page. If the application is embedded from another ATS site, ApplyAI asks separately for that site too. Permissions remain until revoked in `chrome://extensions` → **ApplyAI** → **Details** → **Site access**. ApplyAI does not request access to every site.

## AI behavior

The extension runs a LangGraph workflow: **saved facts → on-device planning → approved cloud fallback for unresolved fields → validation and review**. LangChain Core runnables wrap the Firebase model calls and structured JSON parsing. This graph runs inside the side panel; the separate Python session API is not involved in this flow and no Python server is required.

The model sees the current form's labels, instructions, required flags, options, job context, and reviewed profile facts. It maps unfamiliar questions to saved fact keys rather than generating contact or location values. Standing-answer **values** remain local; the model receives their field catalog, and the extension resolves the selected keys after inference. Unknown facts stay unanswered. Recognized open-ended career questions can receive drafts with evidence references, but those require explicit review. Evidence references do not prove a draft's truthfulness; users must check every claim.

Local inference uses Firebase AI Logic `ONLY_ON_DEVICE`. If it is unavailable, saved-answer filling continues. When the cloud consent checkbox is enabled, unresolved fields can use `ONLY_IN_CLOUD`. This explicit graph routing avoids unapproved SDK fallback. Both providers use constrained structured output and the same Zod validator. Cloud consent includes contact and location details in the reviewed profile and the current form's context. There is no remote graph checkpoint or LangSmith tracing configured.

Enable Firebase AI Logic for your project and configure/enforce Firebase App Check before using cloud fallback. `VITE_FIREBASE_AI_MODEL` optionally overrides the cloud model (default `gemini-3.5-flash-lite`); choose a model enabled for your project. On-device inference requires a compatible desktop Chrome installation and its downloaded model. Unit tests use mocked inference providers; they do not establish that a particular Chrome installation or Firebase project can run live inference.

Use **Analyze answers again** after allowing cloud fallback or saving new profile facts. It reloads your profile and preserves answers you manually edited in the panel. A fresh **Scan and analyze again** starts a new review and resets edits and confirmations. Newly revealed or subsequent application steps need another scan. Resume and cover-letter tailoring are outside this phase; existing saved-resume attachment remains available.

## Checks

```sh
npm run typecheck
npm run build
```

The scanner supports accessible native controls and Ashby question containers, Yes/No button choices and location autocomplete. Greenhouse hosted forms are also recognized. This does not guarantee every custom widget is supported. Embedded ATS frames require their own site access. Saved resume PDFs can be attached to a detected native resume file control; other uploads need manual handling. A semantic AI match does not guarantee that an ATS widget will accept the answer; check any fill failure in the panel and on the page.

For cloud AI, register the web app with Firebase App Check and configure its reCAPTCHA v3 site key as `VITE_FIREBASE_APPCHECK_SITE_KEY`. For local development only, set `VITE_FIREBASE_APPCHECK_DEBUG=true`, run the extension, and register the generated debug token in Firebase App Check. Never ship the debug setting or token.

Unpacked extension development uses an App Check custom provider while debug mode is enabled. Firebase still exchanges the registered debug token with its App Check service; the custom provider prevents reCAPTCHA's remote script from loading inside the extension, where Manifest V3 blocks it. If the console reports a rejected debug token, register that extension's token under **Firebase Console → App Check → your web app → Manage debug tokens**, then reload. Keep the token private. Turning debug mode off for a public extension release requires an extension-compatible production attestation flow; direct reCAPTCHA initialization is for hosted web pages.


Run the automated unit tests with `npm test`.
