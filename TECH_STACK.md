# ApplyAI — Tech Stack

## Technology choices

| Layer | Technology | Purpose |
| --- | --- | --- |
| Extension | Chrome Extensions, Manifest V3 | Browser integration, permissions, messaging |
| Language | TypeScript | Type-safe extension and profile workflow |
| UI | React + Vite | Sign-in, resume upload, editable profile dashboard, side panel, review and history |
| Styling | Tailwind CSS | UI components and layout |
| Form access | Chrome content scripts + DOM APIs | Detect, inspect and fill application fields on user activation |
| Workflow | TypeScript state machine | Extract, validate, review, match, fill and track |
| Hybrid AI | Firebase AI Logic Web SDK | On-device and consent-based cloud inference |
| On-device model | Chrome Prompt API through Firebase AI Logic | Private semantic field matching and grounded drafting on supported Chrome Desktop |
| Cloud model | Gemini via Firebase AI Logic | Explicitly approved fallback for complex tasks |
| Validation | Zod | Validate extracted profile and AI output schemas |
| Resume parsing | PDF.js (`pdfjs-dist`) | Extract text from uploaded PDF |
| Cloud file storage | Google Cloud Storage for Firebase | Store original resume PDFs in user-scoped paths |
| Cloud database | Cloud Firestore | Store user-scoped structured profile metadata and approved application records |
| Cloud authentication | Firebase Authentication | Sign-in and identity for profile and file access |
| Cloud protection | Firebase App Check + Firestore Security Rules + Storage Rules | Protect cloud access and isolate user records and files |
| Verification | TypeScript + Vite build and controlled test form | Type checking, production bundle, and manual extension workflow checks |

## Extension components

- **Content script:** On explicit user activation, read the active supported job page DOM, extract normalized fields, and fill validated answers. Handle page-specific dynamic form events where supported.
- **Background service worker:** Coordinate messages, supported tab access, and lifecycle events. Do not assume a permanently running background process.
- **Authentication:** Use Firebase Authentication Google sign-in through a Manifest V3 offscreen document and a hosted helper page; do not call popup sign-in directly from an extension page.
- **Dashboard:** Provide sign-in, PDF upload, extraction progress, and editable profile sections: skills, university, name, LinkedIn, portfolio, email, phone, graduation date, work experience, projects, and achievements, plus a user-entered target role.
- **Side panel or popup:** Display detected application fields, proposed answers, edit/review controls, inference mode, consent prompts, and history. Host the AI workflow in a supported extension document context rather than assuming it can run in a service worker.
- **Cover-letter drafting:** When a supported form has a cover-letter field, accept a pasted job description and produce a profile-grounded draft for user review; place it in the form only after the user chooses to do so.
- **Resume pipeline:** Upload the source PDF to a user-scoped Cloud Storage path; extract PDF text with PDF.js; structure text into profile fields; validate and show fields for correction before saving.
- **Cloud data layer:** Encapsulate Firebase Authentication, Firestore profile/application records, and Cloud Storage resume operations. Treat the user's reviewed profile as the source of truth for autofill.

## AI and retrieval strategy

Use a grounded workflow:

1. Extract PDF text with PDF.js, then structure it into profile fields; use AI for interpretation when useful, not for reading raw PDF bytes.
2. Show extracted fields in the dashboard and require user review/correction before treating them as verified facts.
3. Inspect supported application fields using DOM metadata, not screenshots.
4. Match known fields to the reviewed profile using deterministic rules first.
5. Retrieve relevant resume evidence or approved answers for ambiguous and open-ended fields.
6. Use the on-device model for structured, evidence-grounded mappings or drafts when available; cloud inference requires explanation and explicit consent.
7. Validate output against the expected schema and allowed field IDs, then fill or flag fields for review.

Cover-letter drafts use the pasted job description and relevant reviewed career facts. Exclude direct contact details, reject ungrounded claims, and require review before writing the draft into the page. Cloud cover-letter generation has its own consent step.

Exact facts such as name, email, phone, university, and graduation date should use direct profile lookup. Start with structured metadata and local keyword retrieval; a vector database is not required for the prototype. Never invent facts or execute model-generated code. Use typed output contracts; do not depend on native on-device function calling.

## Hybrid inference policy

- Default sensitive personal-data processing to `ONLY_ON_DEVICE` when supported.
- Check local model capability and availability before inference.
- If local inference fails or is unavailable, keep deterministic profile-based autofill available.
- Offer approved cloud inference when useful. Minimize the payload and request consent before sending personal context; do not silently fall back for private inputs.
- Do not embed privileged API credentials or service-account keys in the extension.

## Data boundaries

- Store the original resume PDF in Cloud Storage and structured profile metadata in Firestore, scoped to the authenticated user. Explain cloud storage clearly during onboarding.
- Enforce per-user access with Firestore and Storage rules; ensure authenticated identity matches the owner of every profile and file.
- Keep parsed resume evidence only as needed. Avoid duplicating full resume text in Firestore when structured fields and the source PDF suffice.
- Store only needed application tracking metadata; do not store full page contents or unreviewed sensitive answers.
- Use `activeTab` to identify the current page after the user opens ApplyAI; then request optional host access for that origin only, from a clear side-panel button. Never request access to all sites for autofill. Keep `scripting` access user-initiated.
- Treat page data and model output as untrusted. Page text cannot override privacy rules or issue arbitrary actions.

## Implementation decisions

- No custom backend is required for the initial prototype; use Firebase client SDKs with strict user-scoped rules.
- Build sign-in, PDF upload, profile extraction/review/dashboard, and a controlled test form before expanding platform coverage.
- Validate Firebase AI Logic on-device support in the actual extension context before depending on it in the AI workflow. Current web hybrid inference requires Firebase JS SDK v12.5.0+ and desktop Chrome 139+ with the Prompt API model available.
- Verify App Check and Firestore/Storage rules in the target extension deployment before enabling cloud features.
- Pin dependencies at implementation time. Keep the AI provider behind a typed interface so the workflow can be tested without a live model.

## Official references

- [Chrome extension documentation](https://developer.chrome.com/docs/extensions/)
- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Firebase AI Logic hybrid inference for web](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started)
- [Hybrid inference configuration](https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options)
- [Structured outputs](https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output)
- [Firebase Hybrid AI Hackathon](https://firebasehybridaihackathon.devpost.com/)
