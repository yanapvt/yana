import type {
  MemoryUpdateResult,
  OrchestrationContext,
  OrchestrationDecision,
} from './Orchestrator.js';

export class MemoryUpdater {
  prepareUpdate(
    context: OrchestrationContext,
    decision: OrchestrationDecision
  ): MemoryUpdateResult {
    if (decision.action === 'require_profile' || decision.action === 'answer_smalltalk') {
      return {
        shouldPersist: false,
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
      shouldPersist: false,
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
