import { describe, expect, it } from 'vitest';
import { MemoryUpdater } from './MemoryUpdater.js';
import type { OrchestrationContext, OrchestrationDecision } from './Orchestrator.js';

const context: OrchestrationContext = {
  userId: 'whatsapp:+15550000000',
  profileComplete: true,
  message: {
    messageId: 'SM1',
    from: 'whatsapp:+15550000000',
    inputType: 'text',
    text: 'vegetarian',
  },
  metadata: {},
};

describe('MemoryUpdater', () => {
  it('prepares copied session updates and profile preference patches', () => {
    const decision: OrchestrationDecision = {
      action: 'continue_flow',
      intent: 'restaurant_search',
      targetFlow: 'restaurant',
      confidence: 0.86,
      entities: { dietaryPreferences: 'Vegetarian' },
      missingFields: [],
      reason: 'Patch restaurant preference.',
      sessionPatch: {
        flow: 'restaurant',
        state: 'collecting_extra_preferences',
        collectedFields: { location: 'Colombo', guests: 2, dietaryPreferences: 'Vegetarian' },
        requiredFields: ['location', 'guests'],
        missingFields: [],
      },
    };

    const update = new MemoryUpdater().prepareUpdate(context, decision);

    expect(update.shouldPersist).toBe(true);
    expect(update.profilePatch).toEqual({ dietaryRestrictions: 'Vegetarian' });
    expect(update.session?.collectedFields).toEqual(decision.sessionPatch?.collectedFields);

    decision.sessionPatch!.collectedFields.location = 'Kandy';
    expect(update.session?.collectedFields.location).toBe('Colombo');
  });

  it('does not persist smalltalk decisions', () => {
    const update = new MemoryUpdater().prepareUpdate(context, {
      action: 'answer_smalltalk',
      intent: 'smalltalk',
      targetFlow: 'none',
      confidence: 0.95,
      entities: {},
      missingFields: [],
      reason: 'Smalltalk.',
    });

    expect(update.shouldPersist).toBe(false);
  });
});
