import { getLLMService } from '../services/LLMService.js';
import type { LLMDecisionOutput } from '../types/core.js';
import type {
  ConversationRole,
  LLMInterpretation,
  LLMInterpreter,
  OrchestrationContext,
  OrchestrationFlow,
  OrchestrationIntent,
} from './Orchestrator.js';

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
  async interpret(_prompt: string, context: OrchestrationContext): Promise<LLMInterpretation> {
    const decision = await getLLMService().decide({
      userMessage: context.message.text,
      userProfile: {
        preferredLanguage: context.profile?.preferredLanguage,
        nationality: context.profile?.nationality,
      },
      sessionState: context.activeSession
        ? {
            currentIntent: context.activeSession.flow,
            activeSchema: context.activeSession.activeSchema,
            collectedFields: context.activeSession.collectedFields,
            missingFields: context.activeSession.missingFields,
          }
        : undefined,
      availableSchemas: [...ALLOWED_SCHEMAS],
    });

    return validateAndMapDecision(decision, context.activeSession?.flow);
  }
}

export function validateAndMapDecision(
  decision: LLMDecisionOutput,
  activeFlow?: OrchestrationFlow
): LLMInterpretation {
  const intent = mapIntent(decision.intent);
  if (intent === 'unclear') {
    return {
      role: 'unclear',
      intent,
      entities: {},
      confidence: Math.min(decision.confidence, 0.49),
      missingFields: [],
      reasoning: decision.reasoning,
    };
  }

  const targetFlow = flowForIntent(intent);
  const entities = sanitizeEntities(decision.parameters, targetFlow);
  return {
    role: roleForDecision(decision, targetFlow, activeFlow),
    intent,
    entities,
    confidence: decision.confidence,
    missingFields: decision.missingFields.filter((field) => isAllowedField(field, targetFlow)),
    reasoning: decision.reasoning,
  };
}

function mapIntent(intent: string): OrchestrationIntent {
  const normalized = intent.toLowerCase();
  if (/hotel|accommodation|stay|room/.test(normalized)) return 'hotel_search';
  if (/restaurant|dining|food|meal|cafe/.test(normalized)) return 'restaurant_search';
  if (/excursion|activity|attraction|experience|things_to_do/.test(normalized)) return 'excursion_search';
  if (/transport|logistics|transfer|taxi|driver/.test(normalized)) return 'logistics_request';
  if (/itinerary|trip_plan|plan_trip/.test(normalized)) return 'itinerary_plan';
  if (/profile/.test(normalized)) return 'profile_update';
  if (/greeting|smalltalk/.test(normalized)) return 'smalltalk';
  return 'unclear';
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
  if (targetFlow === 'none') return 'unclear';
  if (activeFlow && activeFlow !== targetFlow) return 'new_intent';
  if (activeFlow === targetFlow) {
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
  return Object.fromEntries(
    Object.entries(parameters).filter(
      ([field, value]) => isAllowedField(field, flow) && isSafeScalarOrArray(value)
    )
  );
}

function isAllowedField(field: string, flow: OrchestrationFlow): boolean {
  const normalized = field.replace(/[_-]/g, '').toLowerCase();
  const common = ['location', 'destination', 'date', 'guests', 'adults', 'children', 'budget'];
  const byFlow: Partial<Record<OrchestrationFlow, string[]>> = {
    hotel: ['checkindate', 'checkoutdate', 'rooms', 'mealplan', 'preferences'],
    restaurant: ['cuisine', 'pricerange', 'diningstyle', 'dietaryrequirements', 'seatingpreference'],
    excursion: ['activitytype', 'experiencecategory', 'duration', 'fitnesslevel'],
    logistics: ['pickuplocation', 'dropofflocation', 'pickupdate', 'pickuptime', 'passengers', 'vehicletype'],
    itinerary: ['arrivaldate', 'departuredate', 'interests', 'travelstyle', 'preferredtransport'],
  };
  return [...common, ...(byFlow[flow] ?? [])].includes(normalized);
}

function isSafeScalarOrArray(value: unknown): boolean {
  if (typeof value === 'string') return value.length <= 500;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return Array.isArray(value) && value.length <= 20 && value.every((item) =>
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
  );
}
