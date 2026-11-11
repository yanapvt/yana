import type {
  ConversationAnalysis,
  LLMInterpretation,
  OrchestrationContext,
  OrchestrationDecision,
  OrchestrationFlow,
  OrchestrationIntent,
  OrchestrationSessionSnapshot,
} from './Orchestrator.js';
import { env } from '../config/environment.js';
import { missingFields as computeMissing, validateCriteria, workflow } from './WorkflowDefinitions.js';

export interface DecisionEngineInput {
  context: OrchestrationContext;
  analysis: ConversationAnalysis;
  interpretation?: LLMInterpretation;
}

export class DecisionEngine {
  decide(input: DecisionEngineInput): OrchestrationDecision {
    const model = input.interpretation;
    if (model?.proposedAction?.name === 'open_form' &&
        !hasExplicitBookingRequest(input.context.message.text)) {
      return { action: 'answer_general_question', intent: 'general_inquiry',
        targetFlow: input.context.activeSession?.flow ?? 'none', confidence: model.confidence,
        entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'A booking form requires an explicit traveller request to proceed.' };
    }
    if (model && !input.context.profileComplete && requiresProfile(model.intent)) {
      return { action: 'require_profile', intent: model.intent, targetFlow: 'profile', confidence: model.confidence,
        entities: {}, missingFields: [], reason: 'Profile-first gate required before interpreting workflow proposals.' };
    }
    if (model?.taskTransition === 'pause' && input.context.activeSession &&
        !model.clarificationRequired && model.confidence >= env.llm.confidenceThreshold) {
      return {
        action: 'pause_flow', intent: model.intent, targetFlow: input.context.activeSession.flow,
        confidence: model.confidence, entities: {}, missingFields: input.context.activeSession.missingFields,
        reason: 'Validated model interpretation requested pausing the active workflow.',
      };
    }
    if (model?.clarificationRequired || model?.suggestedAction === 'handoff' || model?.suggestedAction === 'clarify' ||
        (model && model.confidence < env.llm.confidenceThreshold)) {
      const flow = resolveTargetFlow(model.intent);
      const collectSafely = !input.context.activeSession && flow !== 'none' && model.suggestedAction !== 'handoff' && model.suggestedAction !== 'clarify';
      return {
        action: collectSafely ? 'send_form' : model.suggestedAction === 'handoff' && model.confidence >= env.llm.confidenceThreshold ? 'handoff' : 'ask_clarifying_question',
        intent: model.intent, targetFlow: collectSafely ? flow : input.context.activeSession?.flow ?? 'none',
        confidence: model.confidence, entities: {}, missingFields: collectSafely ? defaultRequiredFields(flow) : input.context.activeSession?.missingFields ?? [],
        reason: 'Model proposal requires clarification or an authorized human handoff.',
      };
    }
    const signal = mergeSignals(input.analysis, input.interpretation);
    const targetFlow = resolveTargetFlow(signal.intent, input.context.activeSession?.flow);
    const interpretationMatchesAnalysis = !input.interpretation || input.analysis.intent === 'unclear' ||
      resolveTargetFlow(input.interpretation.intent) === resolveTargetFlow(input.analysis.intent);
    const entities = {
      ...input.analysis.entities,
      ...(input.interpretation && interpretationMatchesAnalysis && input.interpretation.confidence >= input.analysis.confidence
        ? input.interpretation.entities : {}),
    };
    const placeField = targetFlow === 'logistics' ? 'pickupLocation'
      : targetFlow === 'excursion' ? 'destination'
      : targetFlow === 'hotel' || targetFlow === 'restaurant' ? 'location' : undefined;
    if (placeField && entities[placeField] === undefined && !input.context.activeSession?.collectedFields[placeField]) {
      const location = input.context.travellerMemories?.find((fact) =>
        fact.status === 'confirmed' && fact.key === 'current_location' &&
        (!fact.expiresAt || Date.parse(fact.expiresAt) > Date.now()));
      if (location && !/\b(in|at|to|around|near)\s+[A-Z][\p{L}-]{2,}/u.test(input.context.message.text)) {
        entities[placeField] = location.value;
      }
    }
    const current = input.context.activeSession;
    if (input.interpretation && current?.flow === targetFlow &&
        !/\b(actually|instead|change|replace|correct|rather|not|make it)\b/i.test(input.context.message.text) &&
        Object.entries(input.interpretation.entities).some(([key, value]) => current.collectedFields[key] !== undefined && JSON.stringify(current.collectedFields[key]) !== JSON.stringify(value))) {
      return { action: 'ask_clarifying_question', intent: signal.intent, targetFlow,
        confidence: signal.confidence, entities: {}, missingFields: current.missingFields,
        reason: 'Confirm a proposed change to an existing traveller value.' };
    }

    if (!input.context.profileComplete && requiresProfile(signal.intent)) {
      return {
        action: 'require_profile',
        intent: signal.intent,
        targetFlow: 'profile',
        confidence: signal.confidence,
        entities,
        missingFields: [],
        reason: 'Profile-first gate required before service orchestration.',
      };
    }

    if (signal.intent === 'profile_update') {
      return { action: 'send_form', intent: signal.intent, targetFlow: 'profile', confidence: signal.confidence,
        entities: {}, missingFields: [], reason: 'Profile corrections require a validated profile form.' };
    }

    if (input.analysis.role === 'command') {
      return {
        action: 'handle_command',
        intent: 'command',
        targetFlow,
        confidence: input.analysis.confidence,
        entities,
        missingFields: [],
        reason: `Handle deterministic command${input.analysis.command ? `: ${input.analysis.command}` : ''}.`,
      };
    }

    if (signal.intent === 'smalltalk') {
      return {
        action: 'answer_smalltalk',
        intent: signal.intent,
        targetFlow,
        confidence: signal.confidence,
        entities,
        missingFields: [],
        reason: 'Smalltalk should not mutate service flow state.',
      };
    }

    if (signal.intent === 'general_inquiry') {
      return {
        action: 'answer_general_question', intent: signal.intent, targetFlow: input.context.activeSession?.flow ?? 'none',
        confidence: signal.confidence, entities: {}, missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'Answer the general question without activating a transactional workflow.',
      };
    }

    if (signal.role === 'question_or_faq') {
      return {
        action: 'continue_flow',
        intent: signal.intent,
        targetFlow,
        confidence: signal.confidence,
        entities,
        missingFields: input.context.activeSession?.missingFields ?? [],
        reason: 'Answer side question, then resume the current flow.',
      };
    }

    // A workflow change is a state transition, not an implicit consequence of
    // an uncertain classification. Require a confident explicit route or a
    // confident model switch proposal before replacing active journey state.
    if (current && targetFlow !== 'none' && targetFlow !== current.flow) {
      const explicitSwitch = input.analysis.role === 'new_intent' &&
        input.analysis.confidence >= env.llm.confidenceThreshold &&
        resolveTargetFlow(input.analysis.intent) === targetFlow;
      const modelSwitch = model?.taskTransition === 'switch' &&
        model.confidence >= env.llm.confidenceThreshold && resolveTargetFlow(model.intent) === targetFlow;
      if (!explicitSwitch && !modelSwitch) {
        return { action: 'ask_clarifying_question', intent: signal.intent, targetFlow: current.flow,
          confidence: signal.confidence, entities: {}, missingFields: current.missingFields,
          reason: `Confirm whether to switch from ${current.flow} to ${targetFlow}.` };
      }
    }

    const patchedSession = buildPatchedSession(input.context.activeSession, targetFlow, entities);
    const missingFields = patchedSession?.missingFields ?? [];

    if (
      input.context.activeSession &&
      targetFlow !== 'none' &&
      targetFlow !== input.context.activeSession.flow
    ) {
      return {
        action: 'switch_flow',
        intent: signal.intent,
        targetFlow,
        confidence: signal.confidence,
        entities,
        missingFields,
        sessionPatch: patchedSession,
        reason: `Switch from ${input.context.activeSession.flow} to ${targetFlow}.`,
      };
    }

    if (targetFlow !== 'none' && missingFields.length > 0) {
      return {
        action: input.context.activeSession ? 'continue_flow' : 'send_form',
        intent: signal.intent,
        targetFlow,
        confidence: signal.confidence,
        entities,
        missingFields,
        sessionPatch: patchedSession,
        reason: `Missing required fields: ${missingFields.join(', ')}.`,
      };
    }

    if (targetFlow !== 'none') {
      return {
        action: 'execute_search',
        intent: signal.intent,
        targetFlow,
        confidence: signal.confidence,
        entities,
        missingFields,
        sessionPatch: patchedSession,
        reason: 'Required criteria are complete after merging entities.',
      };
    }

    return {
      action: signal.confidence < 0.5 ? 'ask_clarifying_question' : 'no_op',
      intent: signal.intent,
      targetFlow: 'none',
      confidence: signal.confidence,
      entities,
      missingFields: [],
      reason: 'No executable service flow was identified.',
    };
  }
}

function hasExplicitBookingRequest(message: string): boolean {
  return /\b(?:book|reserve|purchase|pay)\b|\bconfirm\s+(?:the\s+|my\s+)?(?:booking|reservation|order)\b|\bproceed\s+with\s+(?:the\s+|my\s+)?(?:booking|reservation|order)\b|\bplace\s+(?:the\s+|an?\s+)?order\b/i.test(message);
}

function mergeSignals(
  analysis: ConversationAnalysis,
  interpretation?: LLMInterpretation
): {
  role: ConversationAnalysis['role'];
  intent: OrchestrationIntent;
  confidence: number;
} {
  if (!interpretation) {
    return {
      role: analysis.role,
      intent: analysis.intent,
      confidence: analysis.confidence,
    };
  }

  const explicitTarget = resolveTargetFlow(analysis.intent);
  const interpretedTarget = resolveTargetFlow(interpretation.intent);
  if (analysis.role === 'new_intent' && analysis.confidence >= 0.85 && explicitTarget !== 'none' &&
      explicitTarget !== interpretedTarget) {
    return { role: analysis.role, intent: analysis.intent, confidence: analysis.confidence };
  }

  const interpretationWins = interpretation.confidence >= analysis.confidence;
  return {
    role: interpretationWins ? interpretation.role : analysis.role,
    intent: interpretationWins ? interpretation.intent : analysis.intent,
    confidence: Math.max(analysis.confidence, interpretation.confidence),
  };
}

function buildPatchedSession(
  current: OrchestrationSessionSnapshot | undefined,
  targetFlow: OrchestrationFlow,
  entities: Record<string, unknown>
): OrchestrationSessionSnapshot | undefined {
  if (targetFlow === 'none' || targetFlow === 'profile') {
    return undefined;
  }

  const requiredFields = current?.flow === targetFlow
    ? current.requiredFields
    : defaultRequiredFields(targetFlow);
  const collectedFields = {
    ...(current?.flow === targetFlow ? current.collectedFields : {}),
    ...validateCriteria(targetFlow, entities, false),
  };

  return {
    id: current?.flow === targetFlow ? current.id : undefined,
    revision: current?.flow === targetFlow ? current.revision : undefined,
    flow: targetFlow,
    state: current?.flow === targetFlow ? current.state : 'collecting_required_details',
    activeSchema: schemaForFlow(targetFlow),
    collectedFields,
    requiredFields: [...requiredFields],
    missingFields: computeMissing(targetFlow, collectedFields, requiredFields),
    updatedAt: current?.updatedAt,
  };
}

function resolveTargetFlow(
  intent: OrchestrationIntent,
  activeFlow?: OrchestrationFlow
): OrchestrationFlow {
  if (intent === 'hotel_search') return 'hotel';
  if (intent === 'restaurant_search') return 'restaurant';
  if (intent === 'excursion_search') return 'excursion';
  if (intent === 'logistics_request') return 'logistics';
  if (intent === 'itinerary_plan') return 'itinerary';
  if (intent === 'profile_update') return 'profile';
  if (intent === 'smalltalk' || intent === 'command' || intent === 'unclear') {
    return activeFlow ?? 'none';
  }
  return 'none';
}

function requiresProfile(intent: OrchestrationIntent): boolean {
  return intent === 'hotel_search' ||
    intent === 'restaurant_search' ||
    intent === 'excursion_search' ||
    intent === 'logistics_request' ||
    intent === 'itinerary_plan';
}

function defaultRequiredFields(flow: OrchestrationFlow): string[] {
  return flow === 'hotel' ? ['location'] : [...(workflow(flow)?.required ?? [])];
}

function schemaForFlow(flow: OrchestrationFlow): string | undefined {
  return workflow(flow)?.schema;
}

function removeUndefinedValues(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}
