import { describe, expect, it } from 'vitest';
import { DecisionEngine } from './DecisionEngine.js';
import { requiredFieldsForAction } from './WorkflowDefinitions.js';
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
  it('saves a short answer to its location question before searching', () => {
    const current = context();
    current.activeSession = undefined;
    current.pendingQuestion = { text: 'Where would you like to dine?' };
    current.message.text = 'Colombo.';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'answer_to_current_question', intent: 'restaurant_search', targetFlow: 'restaurant',
        entities: { location: 'Colombo' }, confidence: 0.9, rawText: 'Colombo.', shouldUseLLM: true },
      interpretation: { role: 'new_request', intent: 'restaurant_search', confidence: 0.95,
        entities: { location: 'Colombo' }, suggestedAction: 'execute_tool',
        proposedAction: { name: 'search', arguments: { schemaId: 'search_restaurants' } } } });
    expect(decision.action).toBe('continue_flow');
    expect(decision.sessionPatch?.collectedFields).toMatchObject({ location: 'Colombo' });
  });
  it('saves a pending location answer even when the model asks for a booking date', () => {
    const current = context();
    current.activeSession = undefined;
    current.pendingQuestion = { text: 'Where would you like to dine for your anniversary?' };
    current.conversationHistory = [{ role: 'user', content: 'I am looking for anniversary dining' },
      { role: 'assistant', content: 'Where would you like to dine for your anniversary?' }];
    current.message.text = 'Colombo.';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'answer_to_current_question', intent: 'restaurant_search', targetFlow: 'restaurant',
        entities: { location: 'Colombo' }, confidence: 0.9, rawText: 'Colombo.', shouldUseLLM: true },
      interpretation: { role: 'new_request', intent: 'restaurant_search', confidence: 0.95,
        entities: { location: 'Colombo' }, suggestedAction: 'clarify', clarificationRequired: true,
        question: 'What date would you like to dine?' } });
    expect(decision.action).toBe('continue_flow');
    expect(decision.sessionPatch?.collectedFields).toMatchObject({ location: 'Colombo', specialOccasion: 'anniversary' });
  });
  it('grounds a one-word place answer when the model omits the location field', () => {
    const current = context();
    current.activeSession = undefined;
    current.pendingQuestion = { text: 'Where would you like to dine?' };
    current.message.text = 'Colombo.';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'unclear', intent: 'unclear', targetFlow: 'none',
        entities: {}, confidence: 0.35, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'new_request', intent: 'restaurant_search', confidence: 0.95,
        entities: {}, suggestedAction: 'execute_tool',
        proposedAction: { name: 'search', arguments: { schemaId: 'search_restaurants' } } } });
    expect(decision.sessionPatch?.collectedFields).toMatchObject({ location: 'Colombo' });
    expect(decision.action).toBe('continue_flow');
  });
  it('carries a confirmed recent anniversary into restaurant discovery criteria', () => {
    const current = context();
    current.activeSession = undefined;
    current.message.text = 'Colombo.';
    current.pendingQuestion = { text: 'Where would you like to dine?' };
    current.conversationHistory = [{ role: 'user', content: 'I want anniversary dining' },
      { role: 'assistant', content: 'Where would you like to dine?' }];
    current.travellerMemories = [{ id: 'occasion-1', userId: current.userId,
      key: 'occasion', value: 'anniversary', scope: 'trip', confidence: 0.95,
      explicit: true, sensitive: false, sourceMessageId: 'older', status: 'confirmed',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'answer_to_current_question', intent: 'restaurant_search', targetFlow: 'restaurant',
        entities: { location: 'Colombo' }, confidence: 0.9, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'new_request', intent: 'restaurant_search', confidence: 0.9,
        entities: { location: 'Colombo' }, suggestedAction: 'execute_tool',
        proposedAction: { name: 'search', arguments: {} } } });
    expect(decision.sessionPatch?.collectedFields).toMatchObject({ location: 'Colombo', specialOccasion: 'anniversary' });
  });
  it('keeps a preference as draft criteria until the traveller asks to see options', () => {
    const current = context();
    current.message.text = 'Somewhere romantic.';
    current.activeSession = { ...current.activeSession!, state: 'awaiting_preferences',
      collectedFields: { location: 'Colombo' }, requiredFields: ['location'], missingFields: [] };
    const preference = new DecisionEngine().decide({ context: current,
      analysis: { role: 'extra_preference', intent: 'restaurant_search', targetFlow: 'restaurant',
        entities: {}, confidence: 0.8, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'extra_preference', intent: 'restaurant_search', confidence: 0.9,
        entities: { additionalPreferences: 'romantic' }, suggestedAction: 'execute_tool',
        proposedAction: { name: 'search', arguments: { schemaId: 'search_restaurants' } } } });
    expect(preference.action).toBe('continue_flow');
    expect(preference.sessionPatch?.collectedFields).toMatchObject({ location: 'Colombo', additionalPreferences: 'romantic' });
    current.activeSession = preference.sessionPatch;
    current.message.text = 'Yes, show me options.';
    const search = new DecisionEngine().decide({ context: current,
      analysis: { role: 'answer_to_current_question', intent: 'restaurant_search', targetFlow: 'restaurant',
        entities: {}, confidence: 0.8, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'extra_preference', intent: 'restaurant_search', confidence: 0.9,
        entities: {}, suggestedAction: 'none', responseText: 'Here are some options.' } });
    expect(search.action).toBe('execute_search');
    expect(search.sessionPatch?.collectedFields).toMatchObject({ location: 'Colombo', additionalPreferences: 'romantic' });
  });
  it('saves a contextual preference instead of asking booking fields', () => {
    const current = context();
    current.message.text = 'Somewhere romantic.';
    current.pendingQuestion = { text: 'Is there an atmosphere or preference you have in mind, or shall I show you a few options?' };
    current.activeSession = { ...current.activeSession!, state: 'awaiting_preferences',
      collectedFields: { location: 'Colombo', specialOccasion: 'anniversary' },
      requiredFields: ['location'], missingFields: [] };
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'restaurant',
        entities: {}, confidence: 0.55, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'extra_preference', intent: 'restaurant_search', confidence: 0.9,
        entities: {}, suggestedAction: 'clarify', clarificationRequired: true,
        question: 'What date, time, and party size would you like?' } });
    expect(decision).toMatchObject({ action: 'continue_flow', targetFlow: 'restaurant',
      entities: { additionalPreferences: 'Somewhere romantic' } });
    expect(decision.sessionPatch?.collectedFields).toMatchObject({ location: 'Colombo',
      specialOccasion: 'anniversary', additionalPreferences: 'Somewhere romantic' });
  });
  it('does not search when the model proposes search for a preference reply', () => {
    const current = context();
    current.message.text = 'Somewhere romantic.';
    current.pendingQuestion = { text: 'Is there an atmosphere or preference you have in mind, or shall I show you a few options?' };
    current.activeSession = { ...current.activeSession!, state: 'awaiting_preferences',
      collectedFields: { location: 'Colombo', specialOccasion: 'anniversary' },
      requiredFields: ['location'], missingFields: [] };
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'restaurant',
        entities: {}, confidence: 0.55, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'extra_preference', intent: 'restaurant_search', confidence: 0.95,
        entities: {}, suggestedAction: 'execute_tool',
        proposedAction: { name: 'search', arguments: { schemaId: 'search_restaurants' } } } });
    expect(decision.action).toBe('continue_flow');
    expect(decision.sessionPatch?.collectedFields).toMatchObject({ location: 'Colombo',
      specialOccasion: 'anniversary', additionalPreferences: 'Somewhere romantic' });
  });
  it('opens a validated booking form when an explicit request switches workflows', () => {
    const current = context();
    current.message.text = 'Book me a hotel in Galle';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'new_intent', intent: 'hotel_search', targetFlow: 'hotel', entities: {},
        confidence: 0.95, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'new_request', intent: 'hotel_search', confidence: 0.96,
        entities: { location: 'Galle' }, taskTransition: 'switch', suggestedAction: 'ask_missing',
        proposedAction: { name: 'open_form', arguments: { schemaId: 'search_hotels' } } } });
    expect(decision).toMatchObject({ action: 'send_form', targetFlow: 'hotel', entities: { location: 'Galle' } });
  });
  it('keeps thanks conversational even while the hotel schema is active', () => {
    const current = context();
    current.activeSession = { ...current.activeSession!, flow: 'hotel',
      activeSchema: 'search_hotels', state: 'awaiting_hotel_selection',
      collectedFields: { location: 'Galle' }, missingFields: ['checkinDate'] };
    current.message.text = 'Thanks';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'smalltalk', intent: 'smalltalk', targetFlow: 'none',
        entities: {}, confidence: 0.95, rawText: 'Thanks', shouldUseLLM: true },
      interpretation: { role: 'unclear', intent: 'smalltalk', entities: {}, confidence: 0.96,
        suggestedAction: 'clarify', responseText: 'You’re welcome.' } });
    expect(decision).toMatchObject({ action: 'answer_smalltalk', targetFlow: 'hotel', entities: {} });
    expect(decision.sessionPatch).toBeUndefined();
  });
  it('separates discovery, provider search, booking request, and backend confirmation requirements', () => {
    expect(requiredFieldsForAction('hotel', 'discovery')).toEqual(['location']);
    expect(requiredFieldsForAction('hotel', 'provider_search')).toEqual(['location']);
    expect(requiredFieldsForAction('hotel', 'booking')).toEqual([
      'location', 'checkinDate', 'checkoutDate', 'guests', 'rooms',
    ]);
    expect(requiredFieldsForAction('hotel', 'confirmation')).toEqual([]);
  });
  it('uses multiple validated fields from one sentence without opening a collection form', () => {
    const current = context();
    current.activeSession = undefined;
    current.message.text = 'Find a hotel in Galle from 2026-12-01 to 2026-12-03 for 2 guests';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'new_intent', intent: 'hotel_search', targetFlow: 'hotel', entities: {},
        confidence: 0.9, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'new_intent', intent: 'hotel_search', confidence: 0.95,
        entities: { location: 'Galle', checkinDate: '2026-12-01', checkoutDate: '2026-12-03', guests: 2 },
        taskTransition: 'none', suggestedAction: 'execute_tool',
        proposedAction: { name: 'search', arguments: { schemaId: 'search_hotels' } } } });
    expect(decision.action).toBe('execute_search');
    expect(decision.missingFields).toEqual([]);
    expect(decision.sessionPatch?.collectedFields).toEqual({
      location: 'Galle', checkinDate: '2026-12-01', checkoutDate: '2026-12-03', guests: 2,
    });
  });
  it('accepts a confident correction instead of the schema awaited-field guess', () => {
    const current = context();
    current.message.text = 'Actually change dinner to 2026-12-02';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'answer_to_current_question', intent: 'restaurant_search', targetFlow: 'restaurant',
        entities: { guests: 2 }, confidence: 0.98, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'change_existing_criteria', intent: 'restaurant_search',
        entities: { diningDate: '2026-12-02' }, confidence: 0.94, taskTransition: 'continue' } });
    expect(decision.entities).toEqual({ diningDate: '2026-12-02' });
    expect(decision.sessionPatch?.collectedFields).toMatchObject({ location: 'Colombo', diningDate: '2026-12-02' });
    expect(decision.sessionPatch?.collectedFields).not.toHaveProperty('guests');
  });
  it('saves a date correction without executing a search that was not requested', () => {
    const current = context();
    current.activeSession!.requiredFields = ['location'];
    current.activeSession!.missingFields = [];
    current.message.text = 'Change dinner to 2026-12-02';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'extra_preference', intent: 'restaurant_search', targetFlow: 'restaurant',
        entities: {}, confidence: 0.8, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'change_existing_criteria', intent: 'restaurant_search',
        entities: { diningDate: '2026-12-02' }, confidence: 0.95, taskTransition: 'continue',
        proposedAction: { name: 'none', arguments: {} }, responseText: 'I updated your dinner date to 2 December.' } });
    expect(decision).toMatchObject({ action: 'continue_flow', entities: { diningDate: '2026-12-02' } });
    expect(decision.sessionPatch?.collectedFields).toMatchObject({ location: 'Colombo', diningDate: '2026-12-02' });
  });

  it('keeps a service question conversational while retaining the active fields', () => {
    const current = context();
    current.message.text = 'What is the weather like before dinner?';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'question_or_faq', intent: 'restaurant_search', targetFlow: 'restaurant',
        entities: {}, confidence: 0.9, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'question_or_faq', intent: 'restaurant_search', entities: {},
        confidence: 0.94, responseText: 'I can check the forecast for Colombo before dinner.',
        taskTransition: 'none' } });
    expect(decision).toMatchObject({ action: 'answer_general_question', targetFlow: 'restaurant', entities: {} });
    expect(decision.sessionPatch).toBeUndefined();
    expect(current.activeSession?.collectedFields).toEqual({ location: 'Colombo' });
  });

  it('does not replace a primary conversational reply with the next required field', () => {
    const current = context();
    current.message.text = 'Let me consider the options';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'restaurant',
        entities: {}, confidence: 0.55, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'extra_preference', intent: 'restaurant_search', entities: {},
        confidence: 0.94, responseText: 'Of course. Your dinner details are saved; tell me when you are ready.',
        taskTransition: 'none', proposedAction: { name: 'none', arguments: {} } } });
    expect(decision).toMatchObject({ action: 'answer_general_question', targetFlow: 'restaurant' });
    expect(decision.sessionPatch).toBeUndefined();
  });
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

    expect(decision.action).toBe('continue_flow');
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

  it('keeps an excursion waiting for a time while answering a lunch side question', () => {
    const current = context();
    current.message.text = 'What are nearby lunch options?';
    current.activeSession = { id: 'excursion-1', revision: 4, flow: 'excursion',
      state: 'awaiting_preferences', activeSchema: 'search_excursions',
      collectedFields: { destination: 'Ella', preferredDate: '2026-12-01' },
      requiredFields: ['destination', 'preferredTime'], missingFields: ['preferredTime'], awaitedField: 'preferredTime' };
    const analysis: ConversationAnalysis = { role: 'new_intent', intent: 'restaurant_search', targetFlow: 'restaurant',
      entities: {}, confidence: 0.9, rawText: current.message.text, shouldUseLLM: true };
    const answer = new DecisionEngine().decide({ context: current, analysis,
      interpretation: { role: 'question_or_faq', intent: 'general_inquiry', entities: {}, confidence: 0.96,
        taskTransition: 'none', suggestedAction: 'clarify',
        responseText: 'There are lunch options around Ella town.' } });
    expect(answer).toMatchObject({ action: 'answer_general_question', targetFlow: 'excursion', entities: {},
      missingFields: ['preferredTime'] });
    expect(answer.sessionPatch).toBeUndefined();
    expect(current.activeSession.collectedFields).toEqual({ destination: 'Ella', preferredDate: '2026-12-01' });

    current.message.text = '08:30';
    const continuation = new DecisionEngine().decide({ context: current,
      analysis: { role: 'answer_to_current_question', intent: 'excursion_search', targetFlow: 'excursion',
        entities: {}, confidence: 0.7, rawText: '08:30', shouldUseLLM: true },
      interpretation: { role: 'answer_to_current_question', intent: 'excursion_search',
        entities: { preferredTime: '08:30' }, confidence: 0.96, taskTransition: 'continue' } });
    expect(continuation).toMatchObject({ action: 'continue_flow', targetFlow: 'excursion',
      sessionPatch: { id: 'excursion-1', revision: 4,
        collectedFields: { destination: 'Ella', preferredDate: '2026-12-01', preferredTime: '08:30' } } });
  });

  it('does not open a form from a low-confidence schema proposal', () => {
    const decision = new DecisionEngine().decide({ context: { ...context(), activeSession: undefined },
      analysis: { role: 'unclear', intent: 'unclear', targetFlow: 'none', entities: {},
        confidence: 0.35, rawText: 'Maybe somewhere nice', shouldUseLLM: true },
      interpretation: { role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: 0.3,
        suggestedAction: 'ask_missing', recommendedSchema: 'search_restaurants' } });
    expect(decision).toMatchObject({ action: 'ask_clarifying_question', targetFlow: 'none', entities: {} });
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

  it('uses contextual model meaning when a keyword hint points to another service', () => {
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
    expect(decision).toMatchObject({ action: 'answer_general_question', targetFlow: 'hotel', entities: {} });
    expect(decision.sessionPatch).toBeUndefined();
  });

  it.each([
    ['Let’s look around Unawatuna', 'location', 'Unawatuna'],
    ['Somewhere closer to the beach', 'additionalPreferences', 'Closer to the beach'],
    ['Could we make it Saturday', 'checkinDate', '2026-12-05'],
  ])('reconciles %s while retaining unrelated validated hotel fields', (text, field, value) => {
    const current = context();
    current.message.text = text;
    current.activeSession = { id: 'hotel-1', revision: 3, flow: 'hotel', state: 'awaiting_preferences',
      collectedFields: { location: 'Galle', checkinDate: '2026-12-01', checkoutDate: '2026-12-08', guests: 2 },
      requiredFields: ['location', 'checkinDate'], missingFields: [] };
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'hotel', entities: {},
        confidence: 0.55, rawText: text, shouldUseLLM: true },
      interpretation: { role: 'change_existing_criteria', intent: 'hotel_search', entities: { [field]: value },
        confidence: 0.94, taskTransition: 'continue', proposedAction: { name: 'none', arguments: {} } } });
    expect(decision).toMatchObject({ action: 'continue_flow', entities: { [field]: value } });
    expect(decision.sessionPatch?.collectedFields).toEqual({
      location: field === 'location' ? value : 'Galle',
      checkinDate: field === 'checkinDate' ? value : '2026-12-01',
      checkoutDate: '2026-12-08', guests: 2,
      ...(field === 'additionalPreferences' ? { additionalPreferences: value } : {}),
    });
    expect(decision.sessionPatch).toMatchObject({ id: 'hotel-1', revision: 3 });
  });

  it('adds children to an itinerary without changing its dates or adult count', () => {
    const current = context();
    current.message.text = 'We will have two children';
    current.activeSession = { id: 'trip-1', revision: 7, flow: 'itinerary', state: 'awaiting_preferences',
      collectedFields: { arrivalDate: '2026-12-01', departureDate: '2026-12-08', adults: 2, travelStyle: 'relaxed' },
      requiredFields: ['arrivalDate', 'departureDate', 'adults'], missingFields: [] };
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'itinerary', entities: {},
        confidence: 0.55, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'change_existing_criteria', intent: 'itinerary_plan', entities: { children: 2 },
        confidence: 0.95, taskTransition: 'continue', proposedAction: { name: 'none', arguments: {} } } });
    expect(decision.sessionPatch?.collectedFields).toEqual({
      arrivalDate: '2026-12-01', departureDate: '2026-12-08', adults: 2, travelStyle: 'relaxed', children: 2,
    });
    expect(decision.action).toBe('continue_flow');
  });

  it('asks one clarification for an ambiguous change and keeps the current revision', () => {
    const current = context();
    current.message.text = 'Somewhere else';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'restaurant', entities: {},
        confidence: 0.55, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'unclear', intent: 'unclear', entities: {}, confidence: 0.81,
        clarificationRequired: true, question: 'Which area would you prefer?', suggestedAction: 'clarify' } });
    expect(decision).toMatchObject({ action: 'ask_clarifying_question', entities: {} });
    expect(decision.sessionPatch).toBeUndefined();
    expect(current.activeSession?.collectedFields).toEqual({ location: 'Colombo' });
  });

  it('rejects a date correction that conflicts with the retained checkout date', () => {
    const current = context();
    current.message.text = 'Could we make it Saturday';
    current.activeSession = { flow: 'hotel', collectedFields: { location: 'Galle', checkinDate: '2026-12-01', checkoutDate: '2026-12-03' },
      requiredFields: ['location', 'checkinDate'], missingFields: [] };
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'hotel', entities: {},
        confidence: 0.55, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'change_existing_criteria', intent: 'hotel_search', entities: { checkinDate: '2026-12-05' },
        confidence: 0.95, taskTransition: 'continue' } });
    expect(decision).toMatchObject({ action: 'ask_clarifying_question', entities: {} });
    expect(decision.sessionPatch).toBeUndefined();
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

  it('does not execute a proposed search while the discovery location is missing', () => {
    const current = context();
    current.activeSession = { flow: 'hotel', state: 'awaiting_preferences', activeSchema: 'search_hotels',
      collectedFields: {}, requiredFields: ['location'], missingFields: ['location'] };
    const decision = new DecisionEngine().decide({
      context: current,
      analysis: { role: 'extra_preference', intent: 'unclear', targetFlow: 'hotel', entities: {},
        confidence: 0.4, rawText: 'Find hotels', shouldUseLLM: true },
      interpretation: { role: 'extra_preference', intent: 'hotel_search', entities: {}, confidence: 0.94,
        proposedAction: { name: 'search', arguments: { schemaId: 'search_hotels' } } },
    });
    expect(decision.action).toBe('continue_flow');
    expect(decision.missingFields).toContain('location');
  });

  it('keeps an exploratory hotel mention conversational without activating a workflow', () => {
    const current = context();
    current.activeSession = undefined;
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'new_intent', intent: 'hotel_search', targetFlow: 'hotel', entities: {},
        confidence: 0.9, rawText: 'What are hotels like in Galle?', shouldUseLLM: true },
      interpretation: { role: 'new_intent', intent: 'hotel_search', entities: { location: 'Galle' },
        confidence: 0.94, responseText: 'Galle has several styles of stay.',
        proposedAction: { name: 'none', arguments: {} } } });
    expect(decision).toMatchObject({ action: 'answer_general_question', targetFlow: 'none' });
    expect(decision.sessionPatch).toBeUndefined();
  });

  it('rejects a premature hotel form when the traveller only shares trip context', () => {
    const current = context();
    current.activeSession = undefined;
    current.message.text = 'I am coming to Sri Lanka with my wife';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'new_intent', intent: 'hotel_search', targetFlow: 'hotel', entities: {},
        confidence: 0.9, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'new_intent', intent: 'hotel_search', entities: { location: 'Sri Lanka' },
        confidence: 0.94, responseText: 'Please complete the hotel form.',
        proposedAction: { name: 'open_form', arguments: { schemaId: 'search_hotels' } } } });
    expect(decision).toMatchObject({ action: 'answer_general_question', targetFlow: 'none' });
    expect(decision.sessionPatch).toBeUndefined();
  });

  it('needs only a location for exploratory hotel search but keeps booking fields separate', () => {
    const current = context();
    current.activeSession = undefined;
    current.message.text = 'Show me hotels around Galle';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'new_intent', intent: 'hotel_search', targetFlow: 'hotel', entities: {},
        confidence: 0.9, rawText: current.message.text, shouldUseLLM: true },
      interpretation: { role: 'new_intent', intent: 'hotel_search', entities: { location: 'Galle' },
        confidence: 0.94, proposedAction: { name: 'search', arguments: { schemaId: 'search_hotels' } } } });
    expect(decision).toMatchObject({ action: 'execute_search', missingFields: [] });
  });

  it('searches restaurants with a location without collecting reservation fields', () => {
    const current = context();
    current.activeSession = undefined;
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'new_intent', intent: 'restaurant_search', targetFlow: 'restaurant', entities: {},
        confidence: 0.9, rawText: 'Find restaurants in Galle', shouldUseLLM: true },
      interpretation: { role: 'new_intent', intent: 'restaurant_search', entities: { location: 'Galle' },
        confidence: 0.94, recommendedSchema: 'search_restaurants',
        proposedAction: { name: 'search', arguments: { schemaId: 'search_restaurants' } } } });
    expect(decision).toMatchObject({ action: 'execute_search', missingFields: [] });
  });

  it('uses the service-request fields only for an explicit form proposal', () => {
    const current = context();
    current.activeSession = undefined;
    current.message.text = 'Book dinner in Galle';
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'new_intent', intent: 'restaurant_search', targetFlow: 'restaurant', entities: {},
        confidence: 0.9, rawText: 'Book dinner in Galle', shouldUseLLM: true },
      interpretation: { role: 'new_intent', intent: 'restaurant_search', entities: { location: 'Galle' },
        confidence: 0.94, recommendedSchema: 'search_restaurants',
        proposedAction: { name: 'open_form', arguments: { schemaId: 'search_restaurants' } } } });
    expect(decision).toMatchObject({ action: 'send_form', targetFlow: 'restaurant' });
    expect(decision.missingFields).toEqual(['diningDate', 'diningTime', 'guests', 'priceRange']);
  });

  it('rejects a schema proposal for a different workflow', () => {
    const current = context();
    current.activeSession = undefined;
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'new_intent', intent: 'restaurant_search', targetFlow: 'restaurant', entities: {},
        confidence: 0.9, rawText: 'Find restaurants in Galle', shouldUseLLM: true },
      interpretation: { role: 'new_intent', intent: 'restaurant_search', entities: { location: 'Galle' },
        confidence: 0.94, recommendedSchema: 'search_hotels',
        proposedAction: { name: 'search', arguments: { schemaId: 'search_hotels' } } } });
    expect(decision).toMatchObject({ action: 'ask_clarifying_question', targetFlow: 'none' });
  });

  it('requires pickup time before a transport provider search', () => {
    const current = context();
    current.activeSession = undefined;
    const decision = new DecisionEngine().decide({ context: current,
      analysis: { role: 'new_intent', intent: 'logistics_request', targetFlow: 'logistics', entities: {},
        confidence: 0.9, rawText: 'Find a ride', shouldUseLLM: true },
      interpretation: { role: 'new_intent', intent: 'logistics_request', confidence: 0.94,
        entities: { pickupLocation: 'Colombo', destination: 'Galle', pickupDate: '2026-12-01', passengers: 2 },
        proposedAction: { name: 'search', arguments: { schemaId: 'search_transport' } } } });
    expect(decision).toMatchObject({ action: 'continue_flow', targetFlow: 'logistics' });
    expect(decision.missingFields).toEqual(['pickupTime']);
  });
});
