import { getLLMService, LLMServiceError } from '../services/LLMService.js';
import type { LLMDecisionOutput } from '../types/core.js';
import { canonicalField, decisionOutputSchema, validateCriteria } from './WorkflowDefinitions.js';
import { modelContext } from './ContextBuilder.js';
import type {
  ConversationRole,
  LLMInterpretation,
  LLMInterpreter,
  OrchestrationContext,
  OrchestrationFlow,
  OrchestrationIntent,
} from './Orchestrator.js';
import { validateMemoryCandidates } from './TravellerMemory.js';

const ALLOWED_SCHEMAS = [
  'search_hotels',
  'search_restaurants',
  'search_excursions',
  'search_transport',
  'plan_itinerary',
  'general_inquiry',
] as const;

/** Adapts the existing structured LLM service to the bounded Orchestrator contract. */
export class LLMDecisionInterpreter implements LLMInterpreter {
  async interpret(prompt: string, context: OrchestrationContext): Promise<LLMInterpretation> {
    const decision = await getLLMService().decide({
      ...modelContext(context),
      availableSchemas: [...ALLOWED_SCHEMAS],
    }, prompt);

    try { return validateAndMapDecision(decision, context.activeSession?.flow); }
    catch { throw new LLMServiceError('Model proposal failed workflow validation', 'INVALID_WORKFLOW_OUTPUT', false); }
  }
}

export function validateAndMapDecision(
  decision: LLMDecisionOutput,
  activeFlow?: OrchestrationFlow
): LLMInterpretation {
  decision = decisionOutputSchema.parse(decision);
  const intent = mapIntent(decision.intent);
  const requiresClarification = Boolean(decision.clarificationRequired || decision.ambiguity?.isAmbiguous);
  if (intent === 'unclear') {
    return {
      role: decision.intent === 'general_inquiry' ? 'question_or_faq' : 'unclear',
      intent,
      entities: {},
      confidence: decision.intent === 'general_inquiry' ? decision.confidence : Math.min(decision.confidence, 0.49),
      missingFields: [],
      suggestedAction: decision.intent === 'general_inquiry' && !requiresClarification ? undefined : 'clarify',
      question: decision.clarificationQuestion,
      responseText: decision.responseText,
      clarificationRequired: requiresClarification,
      taskTransition: decision.taskTransition,
      recommendedSchema: decision.recommendedSchema,
      uiRecommendation: decision.uiRecommendation,
      proposedAction: decision.proposedAction,
      unresolvedQuestions: decision.unresolvedQuestions,
      reasoning: decision.reasoning,
      memoryCandidates: validateMemoryCandidates(decision.memoryCandidates),
    };
  }

  const targetFlow = flowForIntent(intent);
  const parameters = sanitizeEntities(decision.parameters, targetFlow);
  const updates = sanitizeEntities(decision.fieldUpdates ?? {}, targetFlow);
  for (const [field, value] of Object.entries(updates)) {
    if (field in parameters && JSON.stringify(parameters[field]) !== JSON.stringify(value)) {
      throw new Error('Conflicting model field updates');
    }
  }
  const entities = { ...parameters, ...updates };
  return {
    role: roleForDecision(decision, targetFlow, activeFlow),
    intent,
    entities,
    confidence: decision.confidence,
    missingFields: decision.missingFields.map((field) => canonicalField(targetFlow, field)).filter((field): field is string => Boolean(field)),
    suggestedAction: requiresClarification ? 'clarify' : decision.suggestedAction,
    question: decision.clarificationQuestion,
    responseText: decision.responseText,
    clarificationRequired: requiresClarification,
    taskTransition: decision.taskTransition,
    recommendedSchema: decision.recommendedSchema,
    uiRecommendation: decision.uiRecommendation,
    proposedAction: decision.proposedAction,
    unresolvedQuestions: decision.unresolvedQuestions,
    reasoning: decision.reasoning,
    memoryCandidates: validateMemoryCandidates(decision.memoryCandidates),
  };
}

function mapIntent(intent: string): OrchestrationIntent {
  const aliases: Record<string, OrchestrationIntent> = {
    search_hotels: 'hotel_search', hotel_search: 'hotel_search',
    search_restaurants: 'restaurant_search', restaurant_search: 'restaurant_search',
    search_excursions: 'excursion_search', excursion_search: 'excursion_search',
    search_transport: 'logistics_request', logistics_request: 'logistics_request',
    plan_itinerary: 'itinerary_plan', itinerary_plan: 'itinerary_plan',
    profile_update: 'profile_update', greeting: 'smalltalk', smalltalk: 'smalltalk',
    general_inquiry: 'general_inquiry',
  };
  return aliases[intent] ?? 'unclear';
}

function flowForIntent(intent: OrchestrationIntent): OrchestrationFlow {
  if (intent === 'hotel_search') return 'hotel';
  if (intent === 'restaurant_search') return 'restaurant';
  if (intent === 'excursion_search') return 'excursion';
  if (intent === 'logistics_request') return 'logistics';
  if (intent === 'itinerary_plan') return 'itinerary';
  if (intent === 'profile_update') return 'profile';
  return 'none';
}

function roleForDecision(
  decision: LLMDecisionOutput,
  targetFlow: OrchestrationFlow,
  activeFlow?: OrchestrationFlow
): ConversationRole {
  if (decision.intent === 'general_inquiry') return 'question_or_faq';
  if (targetFlow === 'none') return 'unclear';
  if (activeFlow && activeFlow !== targetFlow) return 'new_intent';
  if (activeFlow === targetFlow) {
    if (Object.keys(decision.fieldUpdates ?? {}).length > 0) return 'change_existing_criteria';
    return decision.suggestedAction === 'ask_missing'
      ? 'answer_to_current_question'
      : 'extra_preference';
  }
  return 'new_intent';
}

function sanitizeEntities(
  parameters: Record<string, unknown>,
  flow: OrchestrationFlow
): Record<string, unknown> {
  return validateCriteria(flow, Object.fromEntries(
    Object.entries(parameters).filter(([field]) => Boolean(canonicalField(flow, field)))
  ));
}
