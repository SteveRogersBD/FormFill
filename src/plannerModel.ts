import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource, Schema } from 'firebase/ai';
import { getApp } from 'firebase/app';
import { firebaseAppCheckReady } from './firebase';
import { runPlanner } from './plannerGraph';
import type { PlannerInput } from './planner';

const responseSchema = Schema.object({ properties: {
  answers: Schema.array({ items: Schema.object({ properties: {
    fieldId: Schema.string(), kind: Schema.enumString({ enum: ['profile', 'preference', 'draft', 'unknown'] }),
    keys: Schema.array({ items: Schema.string() }), draft: Schema.string(), reason: Schema.string(),
  } }) }),
} });

function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('AI request timed out.')), ms); })]).finally(() => clearTimeout(timer));
}

export function planApplication(input: PlannerInput, progress?: (message: string) => void) {
  return runPlanner(input, {
    device: async (prompt) => {
      const model = getGenerativeModel(getAI(getApp(), { backend: new GoogleAIBackend() }), {
        mode: InferenceMode.ONLY_ON_DEVICE,
        onDeviceParams: { promptOptions: { responseConstraint: responseSchema } },
      });
      await deadline(model.initializeDeviceModel(), 25_000);
      const result = await deadline(model.generateContent(prompt), 60_000);
      if (result.response.inferenceSource && result.response.inferenceSource !== InferenceSource.ON_DEVICE) throw new Error('Unexpected inference source.');
      return result.response.text();
    },
    cloud: async (prompt) => {
      if (!input.allowCloud || !firebaseAppCheckReady) throw new Error('Cloud inference needs consent and Firebase App Check.');
      const model = getGenerativeModel(getAI(getApp(), { backend: new GoogleAIBackend() }), {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: { model: import.meta.env.VITE_FIREBASE_AI_MODEL || 'gemini-3.5-flash-lite', generationConfig: { responseMimeType: 'application/json', responseSchema } },
      });
      const result = await deadline(model.generateContent(prompt), 60_000);
      return result.response.text();
    },
  }, progress);
}
