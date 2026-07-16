import type {
  ConversationAnalysis,
  LLMInterpretation,
  OrchestrationContext,
  OrchestrationDecision,
  OrchestrationFlow,
  OrchestrationIntent,
  OrchestrationSessionSnapshot,
} from './Orchestrator.js';
import { recalculateMissingFields } from './Orchestrator.js';

export interface DecisionEngineInput {
  context: OrchestrationContext;
  analysis: ConversationAnalysis;
  interpretation?: LLMInterpretation;
}

export class DecisionEngine {
  decide(input: DecisionEngineInput): OrchestrationDecision {
    const signal = mergeSignals(input.analysis, input.interpretation);
    const targetFlow = resolveTargetFlow(signal.intent, input.context.activeSession?.flow);
    const entities = {
      ...input.analysis.entities,
      ...(input.interpretation?.entities ?? {}),
    };

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
    ...removeUndefinedValues(entities),
  };

  return {
    flow: targetFlow,
    state: current?.flow === targetFlow ? current.state : 'collecting_required_details',
    activeSchema: schemaForFlow(targetFlow),
    collectedFields,
    requiredFields: [...requiredFields],
    missingFields: recalculateMissingFields(requiredFields, collectedFields),
    updatedAt: current?.updatedAt,
  };
}

function resolveTargetFlow(
  intent: OrchestrationIntent,
  activeFlow?: OrchestrationFlow
): OrchestrationFlow {
  if (intent === 'hotel_search') return 'hotel';
  if (intent === 'restaurant_search') return 'restaurant';
  if (intent === 'logistics_request') return 'logistics';
  if (intent === 'profile_update') return 'profile';
  if (intent === 'smalltalk' || intent === 'command' || intent === 'unclear') {
    return activeFlow ?? 'none';
  }
  return 'none';
}

function requiresProfile(intent: OrchestrationIntent): boolean {
  return intent === 'hotel_search' || intent === 'restaurant_search' || intent === 'logistics_request';
}

function defaultRequiredFields(flow: OrchestrationFlow): string[] {
  if (flow === 'hotel') return ['location', 'checkinDate', 'checkoutDate', 'guests', 'rooms'];
  if (flow === 'restaurant') return ['location', 'guests'];
  if (flow === 'logistics') return ['pickupLocation', 'dropOffLocation', 'date', 'passengers'];
  return [];
}

function schemaForFlow(flow: OrchestrationFlow): string | undefined {
  if (flow === 'hotel') return 'search_hotels';
  if (flow === 'restaurant') return 'search_restaurants';
  if (flow === 'logistics') return 'logistics_request';
  return undefined;
}

function removeUndefinedValues(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}
