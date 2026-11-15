# ApplyAI — Tech Stack

## Technology choices

| Layer | Technology | Purpose |
| --- | --- | --- |
| Extension | Chrome Extensions, Manifest V3 | Browser integration, permissions, messaging |
| Language | TypeScript | Type-safe extension and agent workflow |
| UI | React + Vite | Onboarding, side panel, review and history |
| Styling | Tailwind CSS | UI components and layout |
| Form access | Chrome content scripts + DOM APIs | Detect, inspect and fill application fields |
| Agent orchestration | TypeScript state machine | Plan, retrieve, validate, fill, review and track |
| Hybrid AI | Firebase AI Logic Web SDK | On-device and cloud inference |
| On-device model | Gemini Nano (supported Chrome devices) | Private semantic field matching and grounded drafting |
| Cloud model | Gemini via Firebase AI Logic | Explicitly approved fallback for complex tasks |
| Validation | Zod | Validate AI output and profile schemas |
| Resume parsing | PDF.js (`pdfjs-dist`) | Local PDF text extraction |
| Local database | IndexedDB + Dexie.js | Profiles, resume evidence, approved answers, application history |
| Cloud database | Cloud Firestore (optional sync) | Approved application metadata only |
| Cloud authentication | Firebase Authentication (optional sync) | User identity and access control |
| Cloud protection | Firebase App Check + Firestore Security Rules | Protect cloud access and isolate user records |
| Testing | Vitest + Playwright | Unit tests and browser-extension/form workflows |

## Extension components

- **Content script:** Read the page DOM, extract normalized form fields and fill validated answers. Handle page-specific dynamic form events where supported.
- **Background service worker:** Coordinate messages, supported tab access, and lifecycle events. Do not assume a permanently running background process.
- **Side panel or popup:** Display onboarding, form review, inference mode, consent prompts, and history. Host the AI workflow in a supported extension document context rather than assuming it can run inside a service worker.
- **Local data layer:** Encapsulate IndexedDB queries, profile data, resume evidence and approved answers.

## AI and retrieval strategy

Use a local-first workflow:

1. Inspect form fields using DOM metadata, not screenshots.
2. Match known fields to saved, verified facts using deterministic rules.
3. Retrieve relevant resume sections, projects, or previous approved answers for ambiguous and open-ended fields.
4. Ask the on-device model for structured, evidence-grounded mappings or drafts.
5. Validate the response against the expected JSON schema and allowed field IDs.
6. Fill or flag fields for user review. Never invent facts or execute arbitrary model-generated code.

RAG is useful for variable written questions, but exact facts such as a name, email, or GPA should use direct lookup. Start with structured data and local keyword retrieval. A vector database or embeddings pipeline is not required for the MVP.

Use a typed output contract for the model, and let TypeScript execute the validated actions. Do not depend on native on-device function calling.

## Hybrid inference policy

- Default sensitive personal-data processing to `ONLY_ON_DEVICE` when the device supports it.
- Check local model capability and availability before inference.
- If local inference fails or is unavailable, keep exact-field autofill available.
- Offer approved cloud inference when useful. Minimize the payload and request user consent before sending any personal context. Avoid automatic cloud fallback for private inputs.
- If using `PREFER_ON_DEVICE`, restrict the request to non-sensitive or explicitly approved information.
- Do not embed privileged API credentials in the extension or expose service-account keys.

## Data boundaries

- Local storage is the system of record for personal profile, resume content and approved answers by default. Local storage is not inherently encrypted; do not claim otherwise.
- Store application history locally. With opt-in cloud synchronization, send only needed metadata, not raw resume content, full form contents, or sensitive answers.
- Request the minimum Chrome permissions needed (for example, `activeTab` and `scripting` for user-initiated access). Avoid broad site access unless specific supported features require it.
- Validate all page data and model output as untrusted. Never let page text override privacy rules or issue arbitrary actions.

## Implementation decisions

- No custom backend is required for the initial MVP.
- Use the Chrome extension shell and a simple test form first. Validate Firebase AI Logic on-device support in the actual extension context before expanding the AI workflow.
- Use official Firebase cloud setup and verify App Check works in the target extension deployment before enabling cloud fallback.
- Pin dependencies at implementation time. Keep the AI provider behind a typed interface to allow testing without a live model.

## Official references

- [Chrome extension documentation](https://developer.chrome.com/docs/extensions/)
- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Firebase AI Logic hybrid inference for web](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started)
- [Hybrid inference configuration](https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options)
- [Structured outputs](https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output)
- [Firebase Hybrid AI Hackathon](https://firebasehybridaihackathon.devpost.com/)
