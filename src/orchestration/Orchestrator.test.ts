import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '../types/index.js';
import { Orchestrator, type LLMInterpreter } from './Orchestrator.js';

function inbound(text: string): InboundMessage {
  return {
    messageId: 'SM1',
    from: 'whatsapp:+15550000000',
    to: 'whatsapp:+14155238886',
    timestamp: new Date('2026-06-22T00:00:00.000Z'),
    type: 'text',
    inputType: 'text',
    content: { type: 'text', body: text },
  };
}

describe('Orchestrator', () => {
  it('validates a conversational activities question without activating a transactional workflow', async () => {
    const result = await new Orchestrator({ llmInterpreter: { interpret: async () => ({
      role: 'new_intent', intent: 'excursion_search', entities: {}, confidence: 0.9,
      suggestedAction: 'none', responseText: 'Which area would you like to explore?',
      followUpQuestion: { text: 'Which area would you like to explore?', expectedAnswerType: 'location' },
    }) } }).plan({ inboundMessage: inbound('Activities'), text: 'Activities', profileComplete: true });
    expect(result.decision).toMatchObject({ action: 'answer_general_question', targetFlow: 'excursion' });
    expect(result.interpretation?.followUpQuestion).toMatchObject({ expectedAnswerType: 'location' });
  });

  it('keeps the activities question when Colombo is a short answer before a workflow exists', async () => {
    const interpreter: LLMInterpreter = { interpret: vi.fn().mockResolvedValue({
      role: 'question_or_faq', intent: 'general_inquiry', entities: {}, confidence: 0.88,
      responseText: 'How can I help with your trip?', suggestedAction: 'none',
    }) };
    const result = await new Orchestrator({ llmInterpreter: interpreter }).plan({
      inboundMessage: inbound('Colombo.'), text: 'Colombo.', profileComplete: true,
      continuation: { topic: 'excursion', pendingQuestion: {
        text: 'Which area would you like to explore', expectedAnswerType: 'location' },
        revision: 1, generation: 0, eventId: 'prior' },
      conversationHistory: [{ role: 'user', content: 'What activities can we do?' },
        { role: 'assistant', content: 'Which area would you like to explore' }],
    });
    expect(result.analysis).toMatchObject({ role: 'answer_to_current_question',
      intent: 'excursion_search', entities: { destination: 'Colombo' } });
    expect(result.decision).toMatchObject({ action: 'continue_flow', targetFlow: 'excursion',
      entities: { destination: 'Colombo' } });
    expect(result.decision.sessionPatch?.collectedFields).toMatchObject({ destination: 'Colombo' });
    expect(result.interpretation?.responseText).toContain('Colombo');
    expect(result.interpretation?.responseText).not.toContain('How can I help');
    expect(result.interpretation?.followUpQuestion).toMatchObject({ expectedAnswerType: 'preference' });
    expect(interpreter.interpret).toHaveBeenCalledOnce();
  });

  it('treats Hotels as a topic change rather than a location answer', async () => {
    const interpreter: LLMInterpreter = { interpret: vi.fn().mockResolvedValue({
      role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.9,
      responseText: 'I can help you explore stays.', suggestedAction: 'none',
      taskTransition: 'switch',
    }) };
    const result = await new Orchestrator({ llmInterpreter: interpreter }).plan({
      inboundMessage: inbound('Hotels'), text: 'Hotels', profileComplete: true,
      continuation: { topic: 'excursion', pendingQuestion: {
        text: 'Which area would you like to explore', expectedAnswerType: 'location' },
        revision: 1, generation: 0, eventId: 'prior' },
    });
    expect(result.analysis).toMatchObject({ intent: 'hotel_search', role: 'new_intent' });
    expect(result.analysis.entities).not.toHaveProperty('destination');
    expect(result.analysis.entities).not.toHaveProperty('location');
    expect(interpreter.interpret).toHaveBeenCalledOnce();
  });

  it('does not treat Hotels as the answer to an active activities location field', async () => {
    const interpreter: LLMInterpreter = { interpret: vi.fn().mockResolvedValue({
      role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.9,
      responseText: 'Let us look at stays.', taskTransition: 'switch', suggestedAction: 'none',
    }) };
    const result = await new Orchestrator({ llmInterpreter: interpreter }).plan({
      inboundMessage: inbound('Hotels'), text: 'Hotels', profileComplete: true,
      activeSession: { flow: 'excursion', state: 'collecting_required_details',
        awaitedField: 'destination', collectedFields: {}, requiredFields: ['destination'],
        missingFields: ['destination'] },
      continuation: { topic: 'excursion', pendingQuestion: {
        text: 'Which area would you like to explore', expectedAnswerType: 'location' },
        revision: 2, generation: 0, eventId: 'prior' },
    });
    expect(result.analysis.intent).toBe('hotel_search');
    expect(result.analysis.entities).not.toHaveProperty('destination');
    expect(result.decision.entities).not.toHaveProperty('destination');
  });

  it('validates a clear activities-to-hotels switch without optional model transition metadata', async () => {
    const result = await new Orchestrator({ llmInterpreter: { interpret: async () => ({
      role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
      responseText: 'Which area would you prefer for your hotel?', suggestedAction: 'none',
    }) } }).plan({
      inboundMessage: inbound("Let's look at hotels instead."),
      text: "Let's look at hotels instead.", profileComplete: true,
      activeSession: { flow: 'excursion', state: 'awaiting_preferences',
        collectedFields: { destination: 'Kandy' }, requiredFields: ['destination'], missingFields: [] },
      continuation: { topic: 'excursion', pendingQuestion: null,
        revision: 1, generation: 0, eventId: 'prior' },
    });
    expect(result.decision).toMatchObject({ action: 'switch_flow', targetFlow: 'hotel' });
    expect(result.interpretation?.responseText).toContain('hotel');
  });

  it('keeps a question mentioning hotels inside the activities conversation', async () => {
    const result = await new Orchestrator({ llmInterpreter: { interpret: async () => ({
      role: 'question_or_faq', intent: 'general_inquiry', entities: {}, confidence: 0.95,
      responseText: 'I can help you compare nearby stays after the activity.', suggestedAction: 'none',
    }) } }).plan({
      inboundMessage: inbound('Are there hotels near the activity?'),
      text: 'Are there hotels near the activity?', profileComplete: true,
      activeSession: { flow: 'excursion', state: 'awaiting_preferences',
        collectedFields: { destination: 'Kandy' }, requiredFields: ['destination'], missingFields: [] },
    });
    expect(result.decision).toMatchObject({ action: 'answer_general_question', targetFlow: 'excursion' });
    expect(result.decision.sessionPatch).toBeUndefined();
  });

  it('rejects a model switch proposal for an informational hotel question', async () => {
    const result = await new Orchestrator({ llmInterpreter: { interpret: async () => ({
      role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
      taskTransition: 'switch', responseText: 'Which hotel area would you prefer?',
      suggestedAction: 'none',
    }) } }).plan({
      inboundMessage: inbound('Are there hotels near the activity?'),
      text: 'Are there hotels near the activity?', profileComplete: true,
      activeSession: { flow: 'excursion', state: 'awaiting_preferences',
        collectedFields: { destination: 'Kandy' }, requiredFields: ['destination'], missingFields: [] },
    });
    expect(result.decision).toMatchObject({ action: 'ask_clarifying_question', targetFlow: 'excursion' });
    expect(result.decision.sessionPatch).toBeUndefined();
  });

  it('allows a direct hotel search without a preliminary form', async () => {
    const result = await new Orchestrator({ llmInterpreter: { interpret: async () => ({
      role: 'new_intent', intent: 'hotel_search', confidence: 0.95,
      entities: { location: 'Colombo', durationNights: 2 },
      proposedAction: { name: 'search', arguments: { schemaId: 'search_hotels' } },
      responseText: 'I will look for stays in Colombo.',
    }) } }).plan({
      inboundMessage: inbound('Find me a hotel in Colombo for two nights.'),
      text: 'Find me a hotel in Colombo for two nights.', profileComplete: true,
    });
    expect(result.decision).toMatchObject({ action: 'execute_search', targetFlow: 'hotel',
      entities: { location: 'Colombo', durationNights: 2 } });
  });

  it('keeps an ambiguous airport question open while recognizing a hotel request', async () => {
    const interpreter: LLMInterpreter = { interpret: vi.fn().mockResolvedValue({
      role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.9,
      responseText: 'Which airport do you mean?', suggestedAction: 'clarify',
      clarificationRequired: true, question: 'Which airport do you mean?',
    }) };
    const result = await new Orchestrator({ llmInterpreter: interpreter }).plan({
      inboundMessage: inbound('Hotels'), text: 'Hotels', profileComplete: true,
      continuation: { topic: 'hotel', pendingQuestion: {
        text: 'Which airport do you mean?', expectedAnswerType: 'airport' },
        revision: 1, generation: 0, eventId: 'prior' },
    });
    expect(result.analysis.intent).toBe('hotel_search');
    expect(result.analysis.entities).not.toHaveProperty('location');
    expect(result.decision.action).toBe('ask_clarifying_question');
  });
  it('grounds an airport answer in the hotel journey and retains the beachfront preference', async () => {
    const interpreter: LLMInterpreter = { interpret: vi.fn().mockResolvedValue({
      role: 'answer_to_current_question', intent: 'hotel_search', confidence: 0.9,
      entities: { location: 'Colombo Airport', additionalPreferences: 'beachfront view' },
      responseText: 'I can look for beachfront stays near Colombo Airport.',
      suggestedAction: 'none',
    }) };
    const result = await new Orchestrator({ llmInterpreter: interpreter }).plan({
      inboundMessage: inbound('Colombo Airport'), text: 'Colombo Airport', profileComplete: true,
      activeSession: { flow: 'hotel', collectedFields: { additionalPreferences: 'beachfront view' },
        requiredFields: ['location'], missingFields: ['location'] },
      continuation: { topic: 'hotel', pendingQuestion: {
        text: 'Which airport do you mean?', expectedAnswerType: 'airport' },
        revision: 1, generation: 0, eventId: 'prior' },
      conversationHistory: [{ role: 'user', content: 'A place near the airport with a beach view' },
        { role: 'assistant', content: 'Which airport do you mean?' }],
    });
    expect(result.analysis).toMatchObject({ role: 'answer_to_current_question',
      intent: 'hotel_search', entities: { location: 'Colombo Airport' } });
    expect(result.decision).toMatchObject({ action: 'continue_flow', targetFlow: 'hotel',
      entities: { location: 'Colombo Airport' } });
    expect(result.decision.entities).not.toHaveProperty('additionalPreferences');
    expect(result.decision.sessionPatch?.collectedFields).toMatchObject({
      location: 'Colombo Airport', additionalPreferences: 'beachfront view',
    });
  });

  it('keeps an explicit transport request distinct from an airport answer', async () => {
    const interpreter: LLMInterpreter = { interpret: vi.fn().mockResolvedValue({
      role: 'new_intent', intent: 'logistics_request', confidence: 0.9,
      entities: {}, responseText: 'I can help with a transfer.', taskTransition: 'switch',
      suggestedAction: 'none',
    }) };
    const result = await new Orchestrator({ llmInterpreter: interpreter }).plan({
      inboundMessage: inbound('Find an airport transfer'), text: 'Find an airport transfer',
      profileComplete: true,
      continuation: { topic: 'hotel', pendingQuestion: {
        text: 'Which airport do you mean?', expectedAnswerType: 'airport' },
        revision: 1, generation: 0, eventId: 'prior' },
    });
    expect(result.analysis.intent).toBe('logistics_request');
    expect(result.analysis.entities).not.toHaveProperty('location');
    expect(result.analysis.entities).not.toHaveProperty('pickupLocation');
  });
  it('takes a short guest count as an answer rather than a numbered booking command', async () => {
    const interpreter: LLMInterpreter = { interpret: vi.fn().mockResolvedValue({
      role: 'answer_to_current_question', intent: 'hotel_search', confidence: 0.9,
      entities: { guests: 2 }, suggestedAction: 'none', responseText: 'Two guests noted.',
    }) };
    const result = await new Orchestrator({ llmInterpreter: interpreter }).plan({
      inboundMessage: inbound('2'), text: '2', profileComplete: true,
      continuation: { topic: 'hotel', pendingQuestion: {
        text: 'How many guests?', expectedAnswerType: 'guests' },
        revision: 1, generation: 0, eventId: 'prior' },
    });
    expect(result.analysis).toMatchObject({ role: 'answer_to_current_question',
      entities: { guests: 2 } });
    expect(result.decision.action).toBe('continue_flow');
    expect(result.decision.entities.guests).toBe(2);
  });
  it('uses the primary interpreter for a natural-language hotel request', async () => {
    const llmInterpreter: LLMInterpreter = {
      interpret: vi.fn(),
    };

    const result = await new Orchestrator({ llmInterpreter }).plan({
      inboundMessage: inbound('find a hotel in Colombo'),
      text: 'find a hotel in Colombo',
      profileComplete: false,
    });

    expect(result.decision.action).toBe('require_profile');
    expect(result.decision.confidence).toBe(0.9);
    expect(llmInterpreter.interpret).toHaveBeenCalledTimes(1);
  });

  it('uses the same interpreter to understand a short answer in an active journey', async () => {
    const llmInterpreter: LLMInterpreter = {
      interpret: vi.fn().mockResolvedValue({
        role: 'extra_preference',
        intent: 'restaurant_search',
        entities: { guests: 2 },
        confidence: 0.88,
      }),
    };

    const result = await new Orchestrator({ llmInterpreter }).plan({
      inboundMessage: inbound('for two please'),
      text: 'for two please',
      profileComplete: true,
      activeSession: {
        flow: 'restaurant',
        state: 'collecting_required_details',
        activeSchema: 'search_restaurants',
        collectedFields: { location: 'Colombo' },
        requiredFields: ['location', 'guests'],
        missingFields: ['guests'],
      },
    });

    expect(result.prompt).toContain('Do not execute tools');
    expect(llmInterpreter.interpret).toHaveBeenCalledOnce();
    expect(result.interpretation?.entities).toEqual({ guests: 2 });
    expect(result.decision.action).toBe('continue_flow');
    expect(result.memoryUpdate.shouldPersist).toBe(true);
  });
});
