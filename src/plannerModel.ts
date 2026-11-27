import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from 'firebase/ai';
import { z } from 'zod';
import { getApp } from 'firebase/app';
import { firebaseAppCheckReady, getFirebaseServices, verifyAppCheck } from './firebase';
import { runPlanner } from './plannerGraph';
import { proposalSchema, type PlannerInput } from './planner';

const responseSchema = Schema.object({ properties: {
  answers: Schema.array({ items: Schema.object({ properties: {
    fieldId: Schema.string(), kind: Schema.enumString({ enum: ['profile', 'preference', 'draft', 'unknown'] }),
    keys: Schema.array({ items: Schema.string() }), draft: Schema.string(), option: Schema.string(), reason: Schema.string(),
  } }) }),
} });

function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('AI request timed out.')), ms); })]).finally(() => clearTimeout(timer));
}

export function aiSetupError(reason: unknown, phase?: 'appcheck'): Error {
  const code = reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : '';
  const message = reason instanceof Error ? reason.message : String(reason);
  const text = `${code} ${message}`;
  let guidance = 'Cloud AI could not connect. Check Firebase Console > AI Logic and App Check, then use Check AI connection.';
  if (/timed out|fetch-network-error|network|failed to fetch/i.test(text)) guidance = phase === 'appcheck' ? 'The App Check connection failed or timed out. This does not confirm a token-registration problem. Check network access, then retry Check AI connection.' : 'The AI connection failed or timed out. Check network access and retry Check AI connection.';
  else if (/appCheck\/storage-/i.test(text)) guidance = 'App Check could not access local browser storage. Its debug token may not persist. Check the extension’s Console for the SDK error before registering another token.';
  else if (phase === 'appcheck' || /app.?check|attestation|recaptcha|initial-throttle|throttled/i.test(text)) {
    const detail = /^appCheck\/[a-z-]+$/.test(code) ? ` Error: ${code}.` : '';
    const status = reason && typeof reason === 'object' && 'customData' in reason ? (reason.customData as { httpStatus?: unknown })?.httpStatus : undefined;
    const http = typeof status === 'number' ? ` HTTP ${status}.` : '';
    guidance = `App Check could not verify this extension.${detail}${http} In the debug build, use “Copy App Check debug token”, then register that value in Firebase Console > App Check > Apps > Manage debug tokens under the project and web app shown in the panel. The console list does not populate automatically.`;
  }
  else if (/not enabled|has not been used|service_disabled|api_key_service_blocked|permission.denied|403/i.test(text)) guidance = 'Firebase rejected the AI request. In Firebase Console > AI Logic, complete Get started for the Gemini Developer API; check API restrictions and App Check registration.';
  else if (/api.?key.*(invalid|missing)|api_key_invalid/i.test(text)) guidance = 'The Firebase web API key is missing or invalid. Check VITE_FIREBASE_API_KEY in .env.local and rebuild the extension. The service-account JSON does not replace the web key.';
  else if (/quota|resource.exhausted|429/i.test(text)) guidance = 'The AI project quota was exceeded. Check Firebase AI Logic quota and billing, then retry later.';
  else if (/model|not.found|404/i.test(text)) guidance = 'The configured AI model is unavailable. Check VITE_FIREBASE_AI_MODEL against models enabled in Firebase AI Logic, then rebuild.';
  else if (/timed out|network|fetch/i.test(text)) guidance = 'The AI connection failed or timed out. Check network access and retry Check AI connection.';
  const error = new Error(guidance);
  error.name = 'AISetupError';
  return error;
}

export async function checkAIConnection(): Promise<string> {
  if (!firebaseAppCheckReady) throw aiSetupError(new Error('App Check is not configured.'));
  await getFirebaseServices();
  try { await deadline(verifyAppCheck(true), 15_000); }
  catch (reason) { throw aiSetupError(reason, 'appcheck'); }
  try {
    const model = getGenerativeModel(getAI(getApp(), { backend: new GoogleAIBackend() }), {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: import.meta.env.VITE_FIREBASE_AI_MODEL || 'gemini-3.5-flash-lite', generationConfig: { responseMimeType: 'application/json', responseSchema: Schema.object({ properties: { status: Schema.string() } }), maxOutputTokens: 64 } },
    });
    const result = await deadline(model.generateContent('Connection test. Return only {"status":"ready"}.'), 25_000);
    if (JSON.parse(result.response.text()).status !== 'ready') throw new Error('The AI connection test returned an unexpected response.');
    return 'Cloud AI connected and answered successfully. No Python server is required.';
  } catch (reason) { throw aiSetupError(reason); }
}

interface DeviceSession {
  contextWindow?: number;
  inputQuota?: number;
  measureContextUsage?: (prompt: string, options: object) => Promise<number>;
  measureInputUsage?: (prompt: string, options: object) => Promise<number>;
  destroy: () => void;
}
interface DeviceProvider {
  availability: (options?: object) => Promise<string>;
  create: (options?: object) => Promise<DeviceSession>;
}

export async function planApplication(input: PlannerInput, progress?: (message: string) => void) {
  let session: DeviceSession | undefined;
  const constraint = z.toJSONSchema(proposalSchema);
  const options = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
  try { return await runPlanner(input, {
    prepareDevice: async (prompt) => {
      const provider = (globalThis as typeof globalThis & { LanguageModel?: DeviceProvider }).LanguageModel;
      if (!provider || await deadline(provider.availability(options), 5_000) !== 'available') return false;
      // This preflight measures the full request plus output schema without generating.
      // Never silently shorten the JD, resume or questions to fit a smaller model.
      const controller = new AbortController();
      try { session = await deadline(provider.create({ ...options, signal: controller.signal }), 25_000); }
      catch (error) { controller.abort(); throw error; }
      const measure = session.measureContextUsage ?? session.measureInputUsage;
      const quota = session.contextWindow ?? session.inputQuota;
      if (!measure || !quota) return false;
      const usage = await deadline(measure.call(session, prompt, { responseConstraint: constraint }), 10_000);
      const reserve = Math.max(2048, input.fields.length * 160);
      return usage + reserve <= quota;
    },
    device: async (prompt) => {
      if (!session) throw new Error('The on-device model was not prepared.');
      // Release the measurement session before Firebase creates its generation session.
      session.destroy(); session = undefined;
      const controller = new AbortController();
      try {
        await getFirebaseServices();
        const model = getGenerativeModel(getAI(getApp(), { backend: new GoogleAIBackend() }), {
          mode: InferenceMode.ONLY_ON_DEVICE,
          onDeviceParams: { createOptions: { ...options, signal: controller.signal }, promptOptions: { responseConstraint: constraint } },
        });
        await deadline(model.initializeDeviceModel(), 25_000);
        const result = await deadline(model.generateContent(prompt, { signal: controller.signal }), 60_000);
        return result.response.text();
      }
      finally { controller.abort(); }
    },
    cloud: async (prompt) => {
      if (!input.allowCloud || !firebaseAppCheckReady) throw new Error('Cloud inference needs consent and Firebase App Check.');
      try {
      await getFirebaseServices();
      const model = getGenerativeModel(getAI(getApp(), { backend: new GoogleAIBackend() }), {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: { model: import.meta.env.VITE_FIREBASE_AI_MODEL || 'gemini-3.5-flash-lite', generationConfig: { responseMimeType: 'application/json', responseSchema, maxOutputTokens: 32768 } },
      });
      const result = await deadline(model.generateContent(prompt), 60_000);
      return result.response.text();
      } catch (reason) { throw aiSetupError(reason); }
    },
  }, progress); } finally { session?.destroy(); }
}
