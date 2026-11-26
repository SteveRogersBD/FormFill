import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { RunnableLambda } from '@langchain/core/runnables';
import { canPlan, makePlannerPrompt, parseProposals, savedPlan, validateProposal, type InferenceSource, type PlanEntry, type PlannerInput, type PlannerResult } from './planner';

export interface PlannerModels {
  prepareDevice: (prompt: string) => Promise<boolean>;
  device: (prompt: string) => Promise<string>;
  cloud: (prompt: string) => Promise<string>;
}
const State = Annotation.Root({
  input: Annotation<PlannerInput>(),
  entries: Annotation<PlanEntry[]>(),
  warnings: Annotation<string[]>(),
  attempts: Annotation<InferenceSource[]>(),
  source: Annotation<InferenceSource | null>(),
  prompt: Annotation<string>(),
});

export async function runPlanner(input: PlannerInput, models: PlannerModels, progress: (message: string) => void = () => {}): Promise<PlannerResult> {
  const chains = {
    ON_DEVICE: RunnableLambda.from(models.device).pipe(RunnableLambda.from(parseProposals)),
    IN_CLOUD: RunnableLambda.from(models.cloud).pipe(RunnableLambda.from(parseProposals)),
  };
  const infer = (source: InferenceSource) => async (state: typeof State.State) => {
    progress(source === 'ON_DEVICE' ? 'Analyzing this application on your device…' : 'Analyzing unresolved questions in the approved cloud model…');
    const targets = state.entries.filter((entry) => !entry.value && canPlan(input.fields.find((field) => field.id === entry.fieldId)!)).map((entry) => entry.fieldId);
    if (!targets.length) return {};
    const attempts = [...state.attempts, source];
    try {
      const proposals = await chains[source].invoke(state.prompt, { runName: `ApplyAI ${source} plan` });
      const entries = new Map(state.entries.map((entry) => [entry.fieldId, entry]));
      const seen = new Set<string>();
      for (const proposal of proposals) {
        if (!targets.includes(proposal.fieldId) || seen.has(proposal.fieldId)) continue;
        seen.add(proposal.fieldId);
        const field = input.fields.find((item) => item.id === proposal.fieldId)!;
        const accepted = validateProposal(proposal, field, input, source);
        if (accepted) entries.set(proposal.fieldId, accepted);
        else if (entries.get(proposal.fieldId)?.status === 'needs_user') {
          entries.set(proposal.fieldId, { ...entries.get(proposal.fieldId)!, reason: proposal.kind === 'unknown' ? proposal.reason || 'Add the missing fact or answer this question yourself.' : 'The proposed answer could not be verified against your saved facts. Please answer or edit your profile.' });
        }
      }
      for (const id of targets.filter((id) => !seen.has(id))) {
        entries.set(id, { ...entries.get(id)!, reason: 'AI did not return an answer for this question. Enter the missing answer here.' });
      }
      return { entries: [...entries.values()], attempts };
    } catch (reason) {
      const setup = reason instanceof Error && reason.name === 'AISetupError' ? `${reason.message} ` : '';
      return { attempts, warnings: [...state.warnings, `${setup}${source === 'ON_DEVICE' ? 'On-device' : 'Cloud'} AI failed or returned an invalid plan. Saved answers remain available. No second generation was attempted. Use “Analyze answers again” to explicitly make another request.`] };
    }
  };
  const graph = new StateGraph(State)
    .addNode('saved_facts', () => {
      progress('Loading reviewed facts and checking the form…');
      return { entries: savedPlan(input), attempts: [], warnings: [] };
    })
    .addNode('select_provider', async (state) => {
      const targets = state.entries.filter((entry) => !entry.value && canPlan(input.fields.find((field) => field.id === entry.fieldId)!)).map((entry) => entry.fieldId);
      if (!targets.length) return { source: null };
      const prompt = makePlannerPrompt(input, targets, state.entries);
      progress('Checking whether the complete application fits the on-device model…');
      let ready = false;
      try { ready = await models.prepareDevice(prompt); } catch { /* Choose before any generation. */ }
      if (ready) return { source: 'ON_DEVICE' as const, prompt };
      if (input.allowCloud) return { source: 'IN_CLOUD' as const, prompt };
      return { source: null, warnings: ['The on-device model is unavailable or cannot fit the complete application. Allow cloud AI and analyze again, or enter the missing answers yourself. No AI generation was made.'] };
    })
    .addNode('on_device', infer('ON_DEVICE'))
    .addNode('cloud', infer('IN_CLOUD'))
    .addNode('review', (state) => {
      progress('Checking evidence and preparing answers for review…');
      const warnings = [...state.warnings];
      return { warnings };
    })
    .addEdge(START, 'saved_facts')
    .addEdge('saved_facts', 'select_provider')
    .addConditionalEdges('select_provider', (state) => state.source === 'ON_DEVICE' ? 'on_device' : state.source === 'IN_CLOUD' ? 'cloud' : 'review', ['on_device', 'cloud', 'review'])
    .addEdge('on_device', 'review')
    .addEdge('cloud', 'review')
    .addEdge('review', END)
    .compile();
  // No remote checkpointer or tracing service: graph state stays in this panel session.
  const result = await graph.invoke({ input, entries: [], warnings: [], attempts: [], source: null, prompt: '' }, { recursionLimit: 8 });
  return { entries: result.entries, warnings: result.warnings, attempts: result.attempts };
}
