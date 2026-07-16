import { describe, expect, it } from 'vitest';
import { DecisionEngine } from './DecisionEngine.js';
import type { ConversationAnalysis, OrchestrationContext } from './Orchestrator.js';

function context(): OrchestrationContext {
  return {
    userId: 'whatsapp:+15550000000',
    profileComplete: true,
    message: {
      messageId: 'SM1',
      from: 'whatsapp:+15550000000',
      inputType: 'text',
      text: 'Colombo for 2',
    },
    activeSession: {
      flow: 'restaurant',
      state: 'collecting_required_details',
      activeSchema: 'search_restaurants',
      collectedFields: { location: 'Colombo' },
      requiredFields: ['location', 'guests'],
      missingFields: ['guests'],
    },
    metadata: {},
  };
}

describe('DecisionEngine', () => {
  it('requires profile before service orchestration', () => {
    const decision = new DecisionEngine().decide({
      context: { ...context(), profileComplete: false, activeSession: undefined },
      analysis: {
        role: 'new_intent',
        intent: 'hotel_search',
        targetFlow: 'hotel',
        entities: { location: 'Kandy' },
        confidence: 0.9,
        rawText: 'find a hotel in Kandy',
        shouldUseLLM: false,
      },
    });

    expect(decision.action).toBe('require_profile');
    expect(decision.confidence).toBe(0.9);
  });

  it('recalculates missing fields after merging entities', () => {
    const analysis: ConversationAnalysis = {
      role: 'extra_preference',
      intent: 'unclear',
      targetFlow: 'restaurant',
      entities: {},
      confidence: 0.55,
      rawText: 'for 2',
      shouldUseLLM: true,
    };

    const decision = new DecisionEngine().decide({
      context: context(),
      analysis,
      interpretation: {
        role: 'change_existing_criteria',
        intent: 'restaurant_search',
        entities: { guests: 2 },
        confidence: 0.82,
      },
    });

    expect(decision.action).toBe('execute_search');
    expect(decision.missingFields).toEqual([]);
    expect(decision.sessionPatch?.collectedFields).toEqual({
      location: 'Colombo',
      guests: 2,
    });
  });

  it('does not mutate the active session while patching', () => {
    const originalContext = context();
    const decision = new DecisionEngine().decide({
      context: originalContext,
      analysis: {
        role: 'extra_preference',
        intent: 'unclear',
        targetFlow: 'restaurant',
        entities: { guests: 2 },
        confidence: 0.7,
        rawText: 'for 2',
        shouldUseLLM: false,
      },
    });

    expect(decision.sessionPatch?.collectedFields).toEqual({
      location: 'Colombo',
      guests: 2,
    });
    expect(originalContext.activeSession?.collectedFields).toEqual({ location: 'Colombo' });
    expect(originalContext.activeSession?.missingFields).toEqual(['guests']);
  });

  it('keeps LLM interpretation as input but lets code decide the action', () => {
    const decision = new DecisionEngine().decide({
      context: context(),
      analysis: {
        role: 'extra_preference',
        intent: 'unclear',
        targetFlow: 'restaurant',
        entities: {},
        confidence: 0.4,
        rawText: 'rooftop',
        shouldUseLLM: true,
      },
      interpretation: {
        role: 'extra_preference',
        intent: 'restaurant_search',
        entities: { seatingPreference: 'Rooftop' },
        confidence: 0.91,
      },
    });

    expect(decision.action).toBe('continue_flow');
    expect(decision.missingFields).toEqual(['guests']);
    expect(decision.entities).toEqual({ seatingPreference: 'Rooftop' });
  });
});
