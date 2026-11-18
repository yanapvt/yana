import { describe, expect, it } from 'vitest';
import { ConversationAnalyzer, fieldQuestionPurpose, fieldQuestionPurposes } from './ConversationAnalyzer.js';
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
  it('uses the question wording rather than optional model metadata to identify a field request', () => {
    expect(fieldQuestionPurpose('Would you like more information?', {
      text: 'Would you like more information?', expectedAnswerType: 'location',
    })).toBeNull();
    expect(fieldQuestionPurpose('Which area would you prefer for dining?')).toMatchObject({
      flow: 'restaurant', expectedAnswerType: 'location',
    });
  });
  it.each([
    ['Which neighbourhood would you prefer for your stay?', 'hotel', 'location'],
    ['How many nights would you like for your stay?', 'hotel', 'nights'],
    ['Which day would you like in your itinerary?', 'itinerary', 'date'],
    ['Where should your transfer pick you up?', 'logistics', 'location'],
    ['Which part of town for dining?', 'restaurant', 'location'],
    ['Which destination for your excursion?', 'excursion', 'location'],
  ] as const)('recognizes the registered question owner: %s', (question, flow, expectedAnswerType) => {
    expect(fieldQuestionPurpose(question)).toMatchObject({ flow, expectedAnswerType });
  });
  it('uses returned wording when model question metadata conflicts and clarifies multiple owners', () => {
    expect(fieldQuestionPurpose('Which area for dining?', {
      text: 'Which area for your hotel?', expectedAnswerType: 'location',
    })).toMatchObject({ flow: 'restaurant' });
    expect(fieldQuestionPurpose('Which area for your hotel or restaurant?')).toMatchObject({
      flow: 'none', ambiguous: true,
    });
    expect(fieldQuestionPurpose('Which area for your hotel? Which area for dining?')).toMatchObject({
      flow: 'none', ambiguous: true,
    });
  });
  it('keeps the first dining-area question separate from the following guest-count question', () => {
    const question = fieldQuestionPurpose('Which area for dining? How many guests for dining?');
    expect(question).toMatchObject({ text: 'Which area for dining?',
      expectedAnswerType: 'location', flow: 'restaurant' });
    const current = context('2');
    current.conversationTopic = 'hotel';
    current.pendingQuestion = { text: 'How many nights for your stay?', expectedAnswerType: 'nights' };
    const answer = new ConversationAnalyzer().analyze(current);
    expect(answer).toMatchObject({ role: 'answer_to_current_question',
      targetFlow: 'hotel', entities: { durationNights: 2 } });
  });
  it.each([
    ['Which dining area and how many guests?', ['location', 'guests']],
    ['Which hotel area and how many nights?', ['location', 'nights']],
    ['Which day and what time would you prefer?', ['date', 'time']],
    ['Could you share your check-in and check-out dates and guest count?',
      ['checkinDate', 'checkoutDate', 'guests']],
  ] as const)('retains distinct requirements in one coordinated question: %s', (text, types) => {
    expect(fieldQuestionPurposes(text).map((question) => question.expectedAnswerType)).toEqual(types);
    expect(fieldQuestionPurpose(text)?.ambiguous).not.toBe(true);
  });
  it('does not split every and and clarifies an unrecognized independent detail', () => {
    expect(fieldQuestionPurposes('Which area in Brighton and Hove?')).toHaveLength(1);
    expect(fieldQuestionPurpose('Which hotel area and what else would matter?'))
      .toMatchObject({ ambiguous: true, ambiguousField: true });
  });
  it.each(['transport please', 'airport taxi', 'I need a transfer', 'actually, hotels',
    'show me accommodation'])('keeps an explicit service request out of a pending airport answer: %s', (text) => {
    const current = context(text);
    current.conversationTopic = 'hotel';
    current.pendingQuestion = { text: 'Which airport do you mean?', expectedAnswerType: 'airport' };
    const result = new ConversationAnalyzer().analyze(current);
    expect(result.role).not.toBe('answer_to_current_question');
    expect(result.entities).not.toHaveProperty('location');
    expect(result.shouldUseLLM).toBe(true);
  });

  it.each([
    ['hotel', 'airport', 'Colombo Airport', 'location'],
    ['hotel', 'airport', 'Need Colombo Airport', 'location'],
    ['excursion', 'location', 'Colombo', 'destination'],
    ['hotel', 'guests', '2', 'guests'],
    ['logistics', 'passengers', '3', 'passengers'],
  ])('accepts a grounded short answer for %s %s', (topic, expectedAnswerType, text, field) => {
    const current = context(text);
    current.conversationTopic = topic;
    current.pendingQuestion = { text: 'Please clarify', expectedAnswerType };
    const result = new ConversationAnalyzer().analyze(current);
    expect(result.role).toBe('answer_to_current_question');
    expect(result.entities).toHaveProperty(field);
    expect(result.shouldUseLLM).toBe(true);
  });

  it.each([
    ['restaurant', 'location', '2'],
    ['restaurant', 'location', '2 guests'],
    ['restaurant', 'guests', 'Colombo'],
    ['restaurant', 'guests', 'Colombo Airport'],
    ['hotel', 'location', '2 nights'],
  ])('rejects %s %s pending-answer mismatch: %s', (topic, answerType, text) => {
    const current = context(text);
    current.conversationTopic = topic;
    current.pendingQuestion = { text: 'Which detail?', expectedAnswerType: answerType };
    expect(new ConversationAnalyzer().analyze(current)).toMatchObject({
      pendingAnswerMismatch: true, entities: {}, shouldUseLLM: true,
    });
  });

  it('preserves a bare result selection when there is no pending question', () => {
    expect(new ConversationAnalyzer().analyze(context('2'))).toMatchObject({
      role: 'command', command: 'book', entities: { selection: 2 },
    });
  });

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
