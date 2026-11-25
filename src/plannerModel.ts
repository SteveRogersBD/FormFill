import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from 'firebase/ai';
import { z } from 'zod';
import { getApp } from 'firebase/app';
import { firebaseAppCheckReady } from './firebase';
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

interface DeviceSession {
  contextWindow?: number;
  inputQuota?: number;
  measureContextUsage?: (prompt: string, options: object) => Promise<number>;
  measureInputUsage?: (prompt: string, options: object) => Promise<number>;
  prompt: (prompt: string, options: object) => Promise<string>;
  destroy: () => void;
}
interface DeviceProvider {
  availability: (options?: object) => Promise<string>;
  create: (options?: object) => Promise<DeviceSession>;
}

export async function planApplication(input: PlannerInput, progress?: (message: string) => void) {
  let session: DeviceSession | undefined;
  const constraint = z.toJSONSchema(proposalSchema);
  try { return await runPlanner(input, {
    prepareDevice: async (prompt) => {
      const provider = (globalThis as typeof globalThis & { LanguageModel?: DeviceProvider }).LanguageModel;
      const options = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
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
      const controller = new AbortController();
      try { return await deadline(session.prompt(prompt, { responseConstraint: constraint, signal: controller.signal }), 60_000); }
      finally { controller.abort(); }
    },
    cloud: async (prompt) => {
      if (!input.allowCloud || !firebaseAppCheckReady) throw new Error('Cloud inference needs consent and Firebase App Check.');
      const model = getGenerativeModel(getAI(getApp(), { backend: new GoogleAIBackend() }), {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: { model: import.meta.env.VITE_FIREBASE_AI_MODEL || 'gemini-3.5-flash-lite', generationConfig: { responseMimeType: 'application/json', responseSchema, maxOutputTokens: 32768 } },
      });
      const result = await deadline(model.generateContent(prompt), 60_000);
      return result.response.text();
    },
  }, progress); } finally { session?.destroy(); }
}
