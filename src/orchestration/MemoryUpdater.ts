import type {
  MemoryUpdateResult,
  OrchestrationContext,
  OrchestrationDecision,
} from './Orchestrator.js';
import { validateCriteria } from './WorkflowDefinitions.js';
import { expectedFieldForConversation } from './ConversationAnalyzer.js';
import { supportedMemoryCandidates, supportedWorkflowFields } from './MutationAuthority.js';
import type { MemoryCandidate } from './TravellerMemory.js';
import { PostgresTravellerMemoryRepository, type TravellerMemoryRepository } from '../storage/travellerMemoryRepository.js';

export class MemoryUpdater {
  constructor(private readonly travellerMemories: TravellerMemoryRepository = new PostgresTravellerMemoryRepository()) {}

  async persistContextMemories(context: OrchestrationContext, update: MemoryUpdateResult): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const grounded = supportedMemoryCandidates(update.memoryCandidates ?? [], context.message.text);
    if (!grounded.length) return { status: 'durable', reason: 'No traveller-supported context proposed' };
    try {
      await this.travellerMemories.saveCandidates(context.userId, context.message.messageId, grounded, 'trip:current');
      return { status: 'durable', reason: 'Validated traveller context persisted' };
    } catch { return { status: 'failed', reason: 'Traveller context could not be persisted' }; }
  }
  async persistUpdate(context: OrchestrationContext, update: MemoryUpdateResult): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    if (update.profilePatch) return { status: 'failed', reason: 'Profile corrections require the approved profile form' };
    if (!update.shouldPersist || !update.session) return { status: 'durable', reason: 'No mutation proposed' };
    if (!context.activeSession || update.session.flow !== context.activeSession.flow) {
      return { status: 'degraded', reason: 'Initialization and flow switches are owned by the existing executor' };
    }
    const { flow } = update.session;
    const factories = {
      hotel: async () => (await import('../services/hotelSearchSessionService.js')).getHotelSearchSessionService(),
      restaurant: async () => (await import('../services/restaurantSearchSessionService.js')).getRestaurantSearchSessionService(),
      excursion: async () => (await import('../services/excursionSearchSessionService.js')).getExcursionSearchSessionService(),
      logistics: async () => (await import('../services/logisticsSearchSessionService.js')).getLogisticsSearchSessionService(),
      itinerary: async () => (await import('../services/itinerarySessionService.js')).getItinerarySessionService(),
    };
    if (!(flow in factories)) return { status: 'failed', reason: 'Unapproved memory target' };
    const service = await factories[flow as keyof typeof factories]();
    if (typeof service.applyCriteriaPatch !== 'function') {
      return { status: 'degraded', reason: 'The active workflow executor owns this state transition' };
    }
    const proposed = validateCriteria(flow, update.session.collectedFields, false);
    const changed = Object.fromEntries(Object.entries(proposed).filter(([field, value]) =>
      JSON.stringify(context.activeSession?.collectedFields[field]) !== JSON.stringify(value)));
    const grounded = supportedWorkflowFields(flow, changed, context.message.text, {
      existingFields: context.activeSession.collectedFields,
      pendingField: expectedFieldForConversation(flow, context.pendingQuestion?.expectedAnswerType),
      confirmedLocation: context.activeSession.pendingDecisions?.locationConfirmation,
    });
    if (Object.keys(grounded).length !== Object.keys(changed).length)
      return { status: 'failed', reason: 'The proposed field change lacks traveller evidence' };
    return service.applyCriteriaPatch(context.userId, context.activeSession.revision ?? 0, proposed);
  }
  prepareUpdate(
    context: OrchestrationContext,
    decision: OrchestrationDecision,
    memoryCandidates: MemoryCandidate[] = []
  ): MemoryUpdateResult {
    memoryCandidates = supportedMemoryCandidates(memoryCandidates, context.message.text);
    if (decision.action === 'require_profile' || decision.action === 'answer_smalltalk' || decision.action === 'answer_general_question') {
      return {
        shouldPersist: memoryCandidates.length > 0,
        memoryCandidates,
        reason: 'Decision does not change durable or session memory.',
      };
    }

    if (decision.sessionPatch) {
      return {
        shouldPersist: true,
        session: {
          ...decision.sessionPatch,
          collectedFields: { ...decision.sessionPatch.collectedFields },
          requiredFields: [...decision.sessionPatch.requiredFields],
          missingFields: [...decision.sessionPatch.missingFields],
        },
        profilePatch: buildProfilePatch(decision.entities),
        memoryCandidates,
        reason: `Prepared memory update for ${decision.targetFlow} flow.`,
      };
    }

    if (decision.action === 'handle_command' && decision.entities.selection) {
      return {
        shouldPersist: false,
        reason: 'Selection command should be persisted by the flow-specific executor.',
      };
    }

    return {
      shouldPersist: memoryCandidates.length > 0,
      memoryCandidates,
      reason: `No memory update needed for action ${decision.action}.`,
    };
  }
}

function buildProfilePatch(
  entities: Record<string, unknown>
): MemoryUpdateResult['profilePatch'] {
  const profilePatch: MemoryUpdateResult['profilePatch'] = {};

  if (typeof entities.dietaryPreferences === 'string') {
    profilePatch.dietaryRestrictions = entities.dietaryPreferences;
  }

  if (typeof entities.accessibilityNeeds === 'string') {
    profilePatch.accessibilityNeeds = entities.accessibilityNeeds;
  }

  return Object.keys(profilePatch).length > 0 ? profilePatch : undefined;
}
