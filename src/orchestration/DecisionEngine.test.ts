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
  it('uses a fresh confirmed current location for a nearby dining request', () => {
    const analysis: ConversationAnalysis = {
      role: 'new_intent', intent: 'restaurant_search', targetFlow: 'restaurant',
      entities: {}, confidence: 0.95, rawText: 'Find dinner near me', shouldUseLLM: false,
    };
    const decision = new DecisionEngine().decide({
      context: {
        ...context(), activeSession: undefined,
        message: { ...context().message, text: 'Find dinner near me' },
        travellerMemories: [{ id: 'fact-1', userId: 'whatsapp:+15550000000', key: 'current_location', value: 'Galle',
          scope: 'trip', confidence: 1, explicit: true, status: 'confirmed', sensitive: false,
          sourceMessageId: 'SM0', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString() }],
      }, analysis,
    });
    expect(decision.entities.location).toBe('Galle');
  });

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
        confidence: 0.92,
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

  it('answers a general question without activating a transactional schema', () => {
    const decision = new DecisionEngine().decide({
      context: { ...context(), activeSession: undefined },
      analysis: { role: 'question_or_faq', intent: 'unclear', targetFlow: 'none', entities: {},
        confidence: 0.4, rawText: 'Why is Galle Fort famous?', shouldUseLLM: true },
      interpretation: { role: 'question_or_faq', intent: 'general_inquiry', entities: {}, confidence: 0.93,
        responseText: 'Galle Fort is known for its preserved colonial-era ramparts and old town.' },
    });

    expect(decision).toMatchObject({ action: 'answer_general_question', targetFlow: 'none', entities: {} });
  });

  it('clarifies an ambiguous task switch without mutating the active task', () => {
    const decision = new DecisionEngine().decide({
      context: context(),
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'restaurant', entities: {},
        confidence: 0.35, rawText: 'Find somewhere nice instead', shouldUseLLM: true },
      interpretation: { role: 'unclear', intent: 'unclear', entities: {}, confidence: 0.6,
        clarificationRequired: true, question: 'Do you mean a restaurant, hotel, or activity?', suggestedAction: 'clarify' },
    });

    expect(decision.action).toBe('ask_clarifying_question');
    expect(decision.targetFlow).toBe('restaurant');
    expect(decision.sessionPatch).toBeUndefined();
  });

  it('maps a confident LLM pause interpretation to a backend-controlled pause action', () => {
    const decision = new DecisionEngine().decide({
      context: { ...context(), message: { ...context().message, text: 'I might come back to this tomorrow' } },
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'restaurant', entities: {},
        confidence: 0.4, rawText: 'I might come back to this tomorrow', shouldUseLLM: true },
      interpretation: { role: 'unclear', intent: 'general_inquiry', entities: {}, confidence: 0.94,
        taskTransition: 'pause', suggestedAction: 'clarify', responseText: 'Of course, I will keep this for later.' },
    });

    expect(decision).toMatchObject({ action: 'pause_flow', targetFlow: 'restaurant', entities: {} });
    expect(decision.sessionPatch).toBeUndefined();
  });

  it('does not let a conflicting model interpretation keep the old schema on an explicit switch', () => {
    const current = context();
    current.activeSession = { flow: 'hotel', state: 'results', activeSchema: 'search_hotels',
      collectedFields: { location: 'Hikkaduwa' }, requiredFields: ['location'], missingFields: [] };
    current.message.text = 'What activity can I do in Hikkaduwa?';
    const decision = new DecisionEngine().decide({
      context: current,
      analysis: { role: 'new_intent', intent: 'excursion_search', targetFlow: 'excursion', entities: { location: 'Hikkaduwa' },
        confidence: .88, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'answer_to_current_question', intent: 'hotel_search', entities: {}, confidence: .95,
        responseText: 'Here are the same hotels.' },
    });
    expect(decision).toMatchObject({ action: 'switch_flow', targetFlow: 'excursion', entities: { location: 'Hikkaduwa' } });
    expect(decision.sessionPatch?.collectedFields).toEqual({ destination: 'Hikkaduwa' });
  });

  it('clarifies before switching when the interpreted target is not an explicit switch', () => {
    const current = context();
    const decision = new DecisionEngine().decide({
      context: current,
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'restaurant', entities: {},
        confidence: 0.45, rawText: 'Maybe something to do instead', shouldUseLLM: true },
      interpretation: { role: 'new_intent', intent: 'excursion_search', entities: { destination: 'Galle' }, confidence: 0.92 },
    });
    expect(decision).toMatchObject({ action: 'ask_clarifying_question', targetFlow: 'restaurant', entities: {} });
    expect(decision.sessionPatch).toBeUndefined();
  });

  it('does not execute a proposed search while required fields are incomplete', () => {
    const decision = new DecisionEngine().decide({
      context: context(),
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'restaurant', entities: {},
        confidence: 0.4, rawText: 'Find restaurants', shouldUseLLM: true },
      interpretation: { role: 'extra_preference', intent: 'restaurant_search', entities: {}, confidence: 0.94,
        proposedAction: { name: 'search', arguments: { schemaId: 'search_restaurants' } } },
    });
    expect(decision.action).toBe('continue_flow');
    expect(decision.missingFields).toContain('guests');
  });
});
