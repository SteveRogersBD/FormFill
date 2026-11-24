import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { RunnableLambda } from '@langchain/core/runnables';
import { canPlan, makePlannerPrompt, parseProposals, savedPlan, validateProposal, type InferenceSource, type PlanEntry, type PlannerInput, type PlannerResult } from './planner';

export interface PlannerModels {
  device: (prompt: string) => Promise<string>;
  cloud: (prompt: string) => Promise<string>;
}
const State = Annotation.Root({
  input: Annotation<PlannerInput>(),
  entries: Annotation<PlanEntry[]>(),
  warnings: Annotation<string[]>(),
  attempts: Annotation<InferenceSource[]>(),
});

export async function runPlanner(input: PlannerInput, models: PlannerModels, progress: (message: string) => void = () => {}): Promise<PlannerResult> {
  const chains = {
    ON_DEVICE: RunnableLambda.from(models.device).pipe(RunnableLambda.from(parseProposals)),
    IN_CLOUD: RunnableLambda.from(models.cloud).pipe(RunnableLambda.from(parseProposals)),
  };
  const infer = (source: InferenceSource) => async (state: typeof State.State) => {
    progress(source === 'ON_DEVICE' ? 'Analyzing this application on your device…' : 'Analyzing unresolved questions in the approved cloud model…');
    const targets = state.entries.filter((entry) => source === 'ON_DEVICE' ? canPlan(input.fields.find((field) => field.id === entry.fieldId)!) : entry.status === 'needs_user').map((entry) => entry.fieldId);
    if (!targets.length) return {};
    const attempts = [...state.attempts, source];
    try {
      const proposals = await chains[source].invoke(makePlannerPrompt(input, targets), { runName: `ApplyAI ${source} plan` });
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
      return { entries: [...entries.values()], attempts };
    } catch {
      // Preserve deterministic and already validated local answers if either provider fails.
      return { attempts, warnings: [...state.warnings, source === 'ON_DEVICE' ? 'On-device AI was unavailable, timed out, or returned an invalid plan. Saved answers remain available.' : 'Cloud AI could not produce a valid plan. Saved and on-device answers remain available.'] };
    }
  };
  const graph = new StateGraph(State)
    .addNode('saved_facts', () => {
      progress('Loading reviewed facts and checking the form…');
      return { entries: savedPlan(input), attempts: [], warnings: [] };
    })
    .addNode('on_device', infer('ON_DEVICE'))
    .addNode('cloud', infer('IN_CLOUD'))
    .addNode('review', (state) => {
      progress('Checking evidence and preparing answers for review…');
      const warnings = [...state.warnings];
      if (!input.allowCloud && state.entries.some((entry) => entry.status === 'needs_user')) warnings.push('Cloud fallback is off. Approve it to try unresolved questions with cloud AI.');
      return { warnings };
    })
    .addEdge(START, 'saved_facts')
    .addEdge('saved_facts', 'on_device')
    .addConditionalEdges('on_device', (state) => input.allowCloud && state.entries.some((entry) => entry.status === 'needs_user') ? 'cloud' : 'review', ['cloud', 'review'])
    .addEdge('cloud', 'review')
    .addEdge('review', END)
    .compile();
  // No remote checkpointer or tracing service: graph state stays in this panel session.
  const result = await graph.invoke({ input, entries: [], warnings: [], attempts: [] }, { recursionLimit: 8 });
  return { entries: result.entries, warnings: result.warnings, attempts: result.attempts };
}
