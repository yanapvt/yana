import { describe, expect, it } from 'vitest';
import { ConversationManager } from './ConversationManager.js';

describe('ConversationManager', () => {
  const manager = new ConversationManager({
    async generateText() {
      throw new Error('LLM unavailable in fallback tests');
    },
  });

  it('creates a natural response from the formal presentation input', async () => {
    const result = manager.createFallbackMessage({
      userInput: 'Please help me plan',
      profile: { preferredName: 'Sam' },
      session: { flow: 'hotel', activeSchema: 'search_hotels' },
      intent: 'search_hotels',
      entities: { destination: 'Galle' },
      decision: { suggestedAction: 'ask_missing', confidence: 0.91 },
      missingFields: ['destination', 'travelDates', 'rooms'],
      currentFlow: 'hotel',
    });

    expect(result).toEqual({
      text: expect.any(String),
    });
    expect(result.text).toContain('hotel search');
    expect(result.text).toContain('where you would like to go');
    expect(result.text).toContain('your travel dates');
    expect(result.text).toContain('how many rooms you need');
    expect(result.text).not.toContain('search_hotels');
    expect(result.text).not.toContain('travelDates');
    expect(result.text).not.toContain('destination');
    expect(result.text).not.toContain('suggestedAction');
    expect(result.text).not.toContain('confidence');
    expect(result.text).not.toContain('I understood this as');
  });

  it('uses a Sri Lanka trip planning template', async () => {
    const result = manager.createFallbackMessage({
      userInput: 'I want to plan my trip in Sri Lanka',
      intent: 'general_inquiry',
      entities: { duration: 'one week' },
      decision: { suggestedAction: 'clarify', confidence: 0.86 },
    });

    expect(result.text).toContain("I'd love to help you plan your trip in Sri Lanka");
    expect(result.text).toContain("Since you'll be here for a week");
    expect(result.text).toContain('hotels, transport, experiences, restaurants');
    expect(result.text).toContain('relaxing trip, adventure, culture, beaches, wildlife');
    expect(result.text).not.toContain('general_inquiry');
    expect(result.text).not.toContain('search_hotels');
  });

  it('uses a capabilities template', async () => {
    const result = manager.createFallbackMessage({
      userInput: 'what else can you do?',
      intent: 'general_inquiry',
      decision: { suggestedAction: 'clarify', confidence: 0.8 },
    });

    expect(result.text).toBe(
      'I can help with hotels, transport, restaurants, excursions, itinerary planning, local recommendations, shopping, wellness, nightlife, and practical travel support. What would you like to organize first?'
    );
  });

  it('uses a concise hotel-start template', async () => {
    const result = manager.createFallbackMessage({
      userInput: 'I need a hotel',
      intent: 'search_hotels',
      missingFields: ['destination', 'travelDates'],
      decision: { suggestedAction: 'ask_missing', confidence: 0.88 },
    });

    expect(result.text).toBe(
      'Of course — I can help you find a great place to stay. Which area are you thinking of, and what dates should I check?'
    );
    expect(result.text).not.toContain('search_hotels');
    expect(result.text).not.toContain('destination');
    expect(result.text).not.toContain('travelDates');
  });

  it('uses a dates-only hotel template', async () => {
    const result = manager.createFallbackMessage({
      userInput: 'Colombo for 2 guests',
      intent: 'search_hotels',
      missingFields: ['checkin_date', 'checkout_date'],
      decision: { suggestedAction: 'ask_missing', confidence: 0.91 },
      currentFlow: 'hotel',
    });

    expect(result.text).toBe(
      'Great, I can work with that. What are your check-in and check-out dates?'
    );
    expect(result.text).not.toContain('checkin_date');
    expect(result.text).not.toContain('checkout_date');
  });

  it('uses a low-confidence guidance template', async () => {
    const result = manager.createFallbackMessage({
      userInput: 'hmm maybe',
      intent: 'unclear',
      decision: { suggestedAction: 'clarify', confidence: 0.32 },
    });

    expect(result.text).toBe(
      'Sure — just so I guide you properly, are you looking for help with accommodation, transport, food, activities, or a full itinerary?'
    );
    expect(result.text).not.toContain('unclear');
    expect(result.text).not.toContain('confidence');
  });

  it('answers smalltalk warmly without exposing flow metadata', async () => {
    const result = manager.createFallbackMessage({
      userInput: 'good morning',
      profile: { preferredName: 'Jeremy' },
      intent: 'smalltalk',
      decision: 'answer_smalltalk',
      currentFlow: 'hotel',
    });

    expect(result.text).toContain('Hi Jeremy');
    expect(result.text).toContain('trip');
    expect(result.text).not.toContain('smalltalk');
    expect(result.text).not.toContain('answer_smalltalk');
  });

  it('sanitizes accidental internal terms before returning text', async () => {
    const result = manager.createFallbackMessage({
      userInput: 'help',
      intent: 'general_inquiry',
      decision: { suggestedAction: 'execute_tool', confidence: 0.72 },
      missingFields: ['customInternalField'],
      currentFlow: 'search_hotels',
    });

    expect(result.text).not.toContain('general_inquiry');
    expect(result.text).not.toContain('execute_tool');
    expect(result.text).not.toContain('search_hotels');
    expect(result.text).not.toContain('customInternalField');
  });

  it('turns missing hotel fields into traveler-facing language', async () => {
    const reply = manager.buildMissingInfoReply({
      intent: 'search_hotels',
      parameters: {},
      missingFields: ['destination', 'travelDates', 'guest_count'],
      suggestedAction: 'ask_missing',
      confidence: 0.8,
    });

    expect(reply).toContain('hotel search');
    expect(reply).toContain('where you would like to go');
    expect(reply).toContain('your travel dates');
    expect(reply).toContain('how many guests are travelling');
    expect(reply).not.toContain('search_hotels');
    expect(reply).not.toContain('travelDates');
    expect(reply).not.toContain('guest_count');
  });

  it('hides unsupported internal intents behind natural wording', async () => {
    const reply = manager.buildUnsupportedToolReply({
      intent: 'general_inquiry',
      parameters: {},
      missingFields: [],
      suggestedAction: 'execute_tool',
      confidence: 0.8,
    });

    expect(reply).toContain('travel');
    expect(reply).not.toContain('general_inquiry');
    expect(reply).not.toContain('I understood this as');
  });

  it('uses a simple clarification without exposing decision metadata', async () => {
    const reply = manager.buildClarifyingReply({
      intent: 'profile_update',
      parameters: {},
      missingFields: [],
      suggestedAction: 'clarify',
      confidence: 0.7,
    });

    expect(reply).toContain('Could you tell me a little more');
    expect(reply).not.toContain('profile_update');
    expect(reply).not.toContain('I understood this as');
  });

  it('uses an LLM writer for the final concierge wording without choosing the action', async () => {
    const prompts: string[] = [];
    const llmManager = new ConversationManager({
      async generateText(prompt) {
        prompts.push(prompt);
        return 'Wonderful, Sri Lanka is a beautiful trip to plan. Are you hoping for beaches, culture, wildlife, adventure, or a mix?';
      },
    });

    const result = await llmManager.createMessage({
      userInput: 'i want to plan my trip in sri lanka',
      interpretation: {
        intent: 'general_inquiry',
        entities: { destination: 'Sri Lanka' },
        confidence: 0.84,
      },
      decision: {
        action: 'ask_missing_fields',
        payload: { missingFields: ['travel_style'] },
        confidence: 0.9,
        source: 'DecisionEngine',
      },
    });

    expect(result.text).toContain('Sri Lanka');
    expect(result.text).toContain('trip');
    expectNoInternalTerms(result.text);
    expect(prompts[0]).toContain('ConversationManager must not choose the next action');
    expect(prompts[0]).toContain('ASK_MISSING_FIELDS');
  });

  it('lets the LLM naturally list available services', async () => {
    const llmManager = new ConversationManager({
      async generateText() {
        return 'I can help with hotels, restaurants, transport, excursions, itinerary planning, local recommendations, shopping, adventure, and wellness. What would you like to organize first?';
      },
    });

    const result = await llmManager.createMessage({
      userInput: 'what can you help me with?',
      interpretation: {
        intent: 'general_inquiry',
        entities: {},
        confidence: 0.9,
      },
      decision: {
        action: 'clarify',
        payload: {},
        confidence: 0.88,
        source: 'DecisionEngine',
      },
      availableServices: [
        'hotels',
        'restaurants',
        'transport',
        'excursions',
        'itinerary planning',
        'local recommendations',
        'shopping',
        'adventure',
        'wellness',
      ],
    });

    expect(result.text).toContain('hotels');
    expect(result.text).toContain('restaurants');
    expect(result.text).toContain('wellness');
    expectNoInternalTerms(result.text);
  });

  it('uses LLM wording to acknowledge rich trip-planning details', async () => {
    const llmManager = new ConversationManager({
      async generateText() {
        return 'That sounds like a lovely 7-day Sri Lanka trip: historic sites for you, with animals and adventure woven in for your wife. To shape it well, what city are you starting from, what is your rough budget, and do you prefer a relaxed or active pace?';
      },
    });

    const result = await llmManager.createMessage({
      userInput:
        'i want to travel around sri lanka in the next 7 days, i like historic locations while my wife likes animals and adventure',
      interpretation: {
        intent: 'general_inquiry',
        entities: {
          destination: 'Sri Lanka',
          duration: '7 days',
          interests: ['historic locations', 'animals', 'adventure'],
          companions: ['wife'],
        },
        confidence: 0.92,
      },
      decision: {
        action: 'ask_missing_fields',
        payload: { missingFields: ['start_location', 'budget', 'pace'] },
        confidence: 0.91,
        source: 'DecisionEngine',
      },
    });

    expect(result.text).toContain('7-day');
    expect(result.text).toContain('historic');
    expect(result.text).toContain('wife');
    expect(result.text).toContain('animals');
    expect(result.text).toContain('adventure');
    expectNoInternalTerms(result.text);
  });

  it('falls back deterministically if the LLM leaks internal terms', async () => {
    const llmManager = new ConversationManager({
      async generateText() {
        return 'intent general_inquiry confidence 0.9 schema search_hotels ASK_MISSING_FIELDS';
      },
    });

    const result = await llmManager.createMessage({
      userInput: 'i want to plan my trip in sri lanka',
      interpretation: {
        intent: 'general_inquiry',
        entities: { destination: 'Sri Lanka' },
        confidence: 0.9,
      },
      decision: {
        action: 'ask_missing_fields',
        payload: { missingFields: ['travel_style'] },
        confidence: 0.9,
        source: 'DecisionEngine',
      },
    });

    expect(result.text).toContain('Sri Lanka');
    expectNoInternalTerms(result.text);
  });
});

function expectNoInternalTerms(reply: string): void {
  for (const term of [
    'search_hotels',
    'general_inquiry',
    'ASK_MISSING_FIELDS',
    'EXECUTE_SEARCH',
    'confidence',
    'schema',
    'intent',
    'travelDates',
  ]) {
    expect(reply).not.toContain(term);
  }
}
