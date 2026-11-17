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
2. Upload a text-based PDF resume. The browser extracts a first pass for name, email, phone, links, education, skills, experience, projects, and achievements. Add your target role in the dashboard as a guided profile detail. Scanned image-only PDFs need OCR, which is not included. You can still edit or enter details manually.
3. Review and edit all fields, then save. The PDF is uploaded to `resumes/<uid>/...`; profile JSON is saved under `users/<uid>/profile/current`.
4. Open the demo form at `https://<project-id>.web.app/test-form.html` or from the Vite server. Click the extension icon to open the side panel, scan, edit suggestions, and fill. Sensitive fields stay blank until you enter and confirm them. The extension never submits the form.
5. After manually submitting a real application, use **I submitted this application** to save it. The dashboard lets you change status or delete the record.

## AI behavior

Exact profile matches work without AI. The side panel also offers a local-only AI suggestion action; it requires a supported desktop Chrome version and an available on-device model. If it is unavailable, ApplyAI reports that and deterministic autofill continues to work. Cloud suggestions require the separate consent checkbox and send the form labels plus relevant profile snippets to Firebase AI Logic. Enable AI Logic and configure/enforce Firebase App Check in the Firebase console before using this option. ApplyAI does not switch to cloud automatically.

## Checks

```sh
npm run typecheck
npm run build
```

Greenhouse hosted job applications on `boards.greenhouse.io` and `job-boards.greenhouse.io` are the first ATS target. ApplyAI reads accessible native form controls there, as it does in the controlled test form. Complex widgets, cross-origin iframes, and resume file uploads require manual handling.

For cloud AI, register the web app with Firebase App Check and configure its reCAPTCHA v3 site key as `VITE_FIREBASE_APPCHECK_SITE_KEY`. For local development only, set `VITE_FIREBASE_APPCHECK_DEBUG=true`, run the extension, and register the generated debug token in Firebase App Check. Never ship the debug setting or token.


Run the automated unit tests with `npm test`.
