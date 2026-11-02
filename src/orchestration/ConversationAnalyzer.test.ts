import { describe, expect, it } from 'vitest';
import { ConversationAnalyzer } from './ConversationAnalyzer.js';
import type { OrchestrationContext } from './Orchestrator.js';

function context(text: string): OrchestrationContext {
  return {
    userId: 'whatsapp:+15550000000',
    profileComplete: true,
    message: {
      messageId: 'SM1',
      from: 'whatsapp:+15550000000',
      inputType: 'text',
      text,
    },
    metadata: {},
  };
}

describe('ConversationAnalyzer', () => {
  it('detects deterministic commands with selection entities', () => {
    const result = new ConversationAnalyzer().analyze(context('details 2'));

    expect(result.role).toBe('command');
    expect(result.command).toBe('details');
    expect(result.entities).toEqual({ selection: 2 });
    expect(result.shouldUseLLM).toBe(false);
  });

  it('resolves an ordinal reference against the current persisted result id without an LLM call', () => {
    const activeContext = context('show me the second one');
    activeContext.activeSession = {
      flow: 'hotel',
      state: 'results',
      activeSchema: 'search_hotels',
      collectedFields: { location: 'Galle' },
      requiredFields: ['location'],
      missingFields: [],
      verifiedResults: {
        source: 'saved_discovery_results_not_confirmed_inventory',
        retrievedAt: '2026-10-22T00:00:00.000Z',
        items: [
          { resultId: 'place-1', position: 1, name: 'Hotel One' },
          { resultId: 'place-2', position: 2, name: 'Hotel Two' },
        ],
      },
    };

    const result = new ConversationAnalyzer().analyze(activeContext);

    expect(result).toMatchObject({
      role: 'command',
      command: 'details',
      entities: { selection: 2, resultId: 'place-2' },
      shouldUseLLM: false,
    });
  });

  it('detects restaurant intent and extracts common entities', () => {
    const result = new ConversationAnalyzer().analyze(
      context('Find a vegetarian rooftop restaurant in Colombo for 4')
    );

    expect(result.intent).toBe('restaurant_search');
    expect(result.targetFlow).toBe('restaurant');
    expect(result.entities).toMatchObject({
      location: 'Colombo',
      guests: 4,
      seatingPreference: 'Rooftop',
      dietaryPreferences: 'Vegetarian',
    });
  });

  it('marks side questions for LLM interpretation', () => {
    const result = new ConversationAnalyzer().analyze(context('does that include breakfast?'));

    expect(result.role).toBe('question_or_faq');
    expect(result.question).toBe('does that include breakfast?');
    expect(result.shouldUseLLM).toBe(true);
  });

  it('sends polite acknowledgements through the LLM when a workflow is active', () => {
    const activeContext = context("Thanks, I'll think about it");
    activeContext.activeSession = {
      flow: 'hotel', state: 'results', activeSchema: 'search_hotels',
      collectedFields: { location: 'Waskaduwa' }, requiredFields: ['location'], missingFields: [],
    };

    const result = new ConversationAnalyzer().analyze(activeContext);

    expect(result.intent).toBe('smalltalk');
    expect(result.shouldUseLLM).toBe(true);
  });

  it('treats a short reply as the active schema field before intent reclassification', () => {
    const activeContext = context('Kollupitiya');
    activeContext.activeSession = {
      flow: 'restaurant',
      state: 'awaiting_preferences',
      activeSchema: 'search_restaurants',
      awaitedField: 'location',
      collectedFields: {},
      requiredFields: ['location'],
      missingFields: ['location'],
    };

    const result = new ConversationAnalyzer().analyze(activeContext);

    expect(result.role).toBe('answer_to_current_question');
    expect(result.intent).toBe('restaurant_search');
    expect(result.entities).toEqual({ location: 'Kollupitiya' });
    expect(result.shouldUseLLM).toBe(true);
  });

  it('routes a new unrelated request from its message instead of applying the old awaited field', () => {
    const activeContext = context('Find a restaurant in Moratuwa');
    activeContext.activeSession = {
      flow: 'hotel', state: 'awaiting_preferences', activeSchema: 'search_hotels',
      awaitedField: 'location', collectedFields: {}, requiredFields: ['location'], missingFields: ['location'],
    };

    expect(new ConversationAnalyzer().analyze(activeContext)).toMatchObject({
      intent: 'restaurant_search', targetFlow: 'restaurant', role: 'new_intent',
    });
  });

  it('honors an explicit restaurant correction instead of matching the negated hotel word', () => {
    const result = new ConversationAnalyzer().analyze(
      context('I am looking for a restaurant, not a hotel')
    );

    expect(result.intent).toBe('restaurant_search');
    expect(result.targetFlow).toBe('restaurant');
  });

  it.each([
    'I am hungry',
    'I want a romantic place',
    'i want to find a restuarent near me',
  ])('classifies broad restaurant language without legacy routing: %s', (message) => {
    const result = new ConversationAnalyzer().analyze(context(message));

    expect(result).toMatchObject({
      intent: 'restaurant_search',
      targetFlow: 'restaurant',
      shouldUseLLM: true,
    });
  });

  it('does not invent a location from the phrase near me', () => {
    const result = new ConversationAnalyzer().analyze(
      context('i want to find a restuarent near me')
    );

    expect(result.entities).not.toHaveProperty('location');
  });

  it('preserves cuisine while deterministically routing restaurant discovery', () => {
    const result = new ConversationAnalyzer().analyze(
      context('Can you recommend seafood restaurants in Galle?')
    );

    expect(result.entities).toMatchObject({ location: 'Galle', cuisine: 'seafood' });
  });

  it.each([
    'I want to visit historic places',
    "We're looking for adventure",
    "I'd like to go surfing",
    'I want a safari',
    'What can I do in Kandy?',
    'What should we see around Galle?',
    "What's happening around here?",
    'Is there anything to do nearby?',
    'I am looking for experiences in Colombo',
    'Show me local sights in Negombo',
  ])('classifies broad excursion language without legacy routing: %s', (message) => {
    const result = new ConversationAnalyzer().analyze(context(message));

    expect(result).toMatchObject({
      intent: 'excursion_search',
      targetFlow: 'excursion',
      shouldUseLLM: true,
    });
  });

  it('switches a plural hotels question away from an active itinerary', () => {
    const activeContext = context('What about hotels around Kandy?');
    activeContext.activeSession = itinerarySession();

    const result = new ConversationAnalyzer().analyze(activeContext);

    expect(result).toMatchObject({
      role: 'new_intent',
      intent: 'hotel_search',
      targetFlow: 'hotel',
    });
  });

  it('sends an explicit hotel-to-excursion switch through the LLM while selecting excursions deterministically', () => {
    const activeContext = context('What activity can I do in Hikkaduwa?');
    activeContext.activeSession = {
      flow: 'hotel', state: 'results', activeSchema: 'search_hotels',
      collectedFields: { location: 'Hikkaduwa', checkinDate: '2026-11-10', checkoutDate: '2026-11-12', guests: 2 },
      requiredFields: ['location', 'checkinDate', 'checkoutDate', 'guests'], missingFields: [],
    };
    const result = new ConversationAnalyzer().analyze(activeContext);
    expect(result).toMatchObject({ role: 'new_intent', intent: 'excursion_search', targetFlow: 'excursion',
      entities: { location: 'Hikkaduwa' }, shouldUseLLM: true });
  });

  it('keeps a day-specific hotel change inside the active itinerary', () => {
    const activeContext = context('change hotel on day 2');
    activeContext.activeSession = itinerarySession();

    const result = new ConversationAnalyzer().analyze(activeContext);

    expect(result).toMatchObject({
      intent: 'itinerary_plan',
      targetFlow: 'itinerary',
      entities: { itineraryEdit: 'change hotel on day 2' },
    });
  });

  it('recognizes a common itinerary misspelling deterministically', () => {
    const result = new ConversationAnalyzer().analyze(
      context('give an intenry for a day in colombo')
    );

    expect(result).toMatchObject({
      intent: 'itinerary_plan',
      targetFlow: 'itinerary',
      shouldUseLLM: true,
    });
  });
});

function itinerarySession(): NonNullable<OrchestrationContext['activeSession']> {
  return {
    flow: 'itinerary',
    state: 'showing_itinerary',
    activeSchema: 'plan_itinerary',
    collectedFields: {
      arrivalDate: '2026-07-12',
      departureDate: '2026-07-19',
      adults: 2,
    },
    requiredFields: ['arrivalDate', 'departureDate', 'adults'],
    missingFields: [],
  };
}
