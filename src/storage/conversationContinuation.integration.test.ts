import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../db/connection.js';
import { createInboundConversationEvent } from '../orchestration/CanonicalConversationEvent.js';
import { ActiveConversationStateLoader } from '../orchestration/ActiveConversationStateLoader.js';
import { Orchestrator, type OrchestrationResult } from '../orchestration/Orchestrator.js';
import { DecisionEngine } from '../orchestration/DecisionEngine.js';
import { ConversationControlPlane, initConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import { ConversationContinuationService } from '../services/ConversationContinuationService.js';
import { processNormalizedInboundMessage } from '../services/ConversationMessageService.js';
import { initProfileGate, ProfileGate } from '../services/ProfileGate.js';
import { initProfileService, ProfileService } from '../services/ProfileService.js';
import { ExcursionSearchSessionService } from '../services/excursionSearchSessionService.js';
import { HotelSearchSessionService } from '../services/hotelSearchSessionService.js';
import { ItinerarySessionService } from '../services/itinerarySessionService.js';
import { LogisticsSearchSessionService } from '../services/logisticsSearchSessionService.js';
import { RestaurantSearchSessionService } from '../services/restaurantSearchSessionService.js';
import { StateStore } from '../services/StateStore.js';
import { normalizeInboundMessage } from '../utils/messageNormalizer.js';
import { PostgresConversationContinuationRepository,
  PostgresJourneyEventCheckpointRepository } from './JourneyEventCheckpointRepository.js';
import { PostgresTravellerMemoryRepository } from './travellerMemoryRepository.js';

const phone = '+94770000984';
const traveller = `whatsapp:${phone}`;
const cacheKey = `journey:conversation:${createHash('sha256').update(traveller).digest('hex')}`;
const cache = new StateStore();
const events = new PostgresJourneyEventCheckpointRepository();

function inbound(sourceEventId: string, text: string) {
  const event = createInboundConversationEvent(normalizeInboundMessage({
    MessageSid: sourceEventId, From: traveller, To: 'whatsapp:+15550000000', Body: text,
  }), `corr-${sourceEventId}`);
  return { ...event, sessionId: event.conversationId.replace('conversation:', 'session:') };
}

function plan(intent: 'hotel_search' | 'excursion_search', question?: string): OrchestrationResult {
  const flow = intent === 'hotel_search' ? 'hotel' : 'excursion';
  return { analysis: { role: 'new_intent' },
    interpretation: { role: 'new_intent', intent, entities: {}, confidence: 0.9,
      ...(question ? { responseText: question,
        followUpQuestion: { text: question, expectedAnswerType: 'location' } } : {}) },
    decision: { action: 'answer_general_question', intent, targetFlow: question ? flow : 'none',
      entities: {}, confidence: 0.9, missingFields: [], reason: 'integration fixture' },
    context: { activeSession: undefined } } as OrchestrationResult;
}

async function clearFixture() {
  await cache.deleteKey(cacheKey);
  await cache.deleteKey(`hotel-search:${traveller}`);
  await cache.deleteKey(`excursion-search:${traveller}`);
  await cache.deleteKey(`restaurant-search:${traveller}`);
  await cache.deleteKey(`logistics-search:${traveller}`);
  await cache.deleteKey(`itinerary:${traveller}`);
  await pool.query('DELETE FROM journey_inbound_events WHERE user_key=$1', [traveller]);
  await pool.query('DELETE FROM journey_event_checkpoints WHERE user_key=$1', [traveller]);
  await pool.query('DELETE FROM journey_workflow_transitions WHERE user_key=$1', [traveller]);
  await pool.query('DELETE FROM users WHERE phone_number=$1', [phone]);
}

beforeAll(async () => { await cache.connect(); });
beforeEach(async () => {
  await clearFixture();
  await pool.query('INSERT INTO users(phone_number,phone_hash) VALUES($1,$2)',
    [phone, 'phase8-continuation-fixture']);
});
afterAll(async () => { await clearFixture(); await cache.disconnect(); await pool.end(); });

describe('Phase 8 continuation against isolated PostgreSQL and Redis', () => {
  it('stages WhatsApp questions until provider acceptance and revokes them on failure', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async () => ({
        role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: .95,
        suggestedAction: 'clarify', clarificationRequired: true,
        responseText: 'Which dining area would you prefer?',
        followUpQuestion: { text: 'Which dining area would you prefer?', expectedAnswerType: 'location' },
      }) } }),
    }));
    try {
      const processed = await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: 'SM-delivery-stage', From: traveller, To: 'whatsapp:+15550000000',
        Body: 'Restaurants',
      }), 'corr-delivery-stage', true);
      const event = processed.canonicalEvent!;
      const staged = await continuation.load(event);
      expect(staged).toMatchObject({ pendingQuestion: null,
        outboundQuestion: { eventId: event.eventId, status: 'attempted',
          question: { expectedAnswerType: 'service' } } });
      const row = () => pool.query(`SELECT pending_question,outbound_question FROM journey_event_checkpoints
        WHERE user_key=$1`, [traveller]);
      expect((await row()).rows[0].pending_question).toBeNull();
      const history = () => pool.query(`SELECT m.metadata->>'delivery' AS status FROM messages m
        JOIN users u ON u.user_id=m.user_id WHERE u.phone_number=$1 AND m.role='assistant'
        ORDER BY m.created_at DESC LIMIT 1`, [phone]);
      expect((await history()).rows[0].status).toBe('generated');
      await continuation.recordOutbound(event, 'provider_accepted', 'wamid.test-delivery');
      expect((await continuation.load(event))?.pendingQuestion?.expectedAnswerType).toBe('service');
      expect((await history()).rows[0].status).toBe('provider_accepted');
      await continuation.recordProviderStatus('wamid.test-delivery', 'sent');
      await continuation.recordProviderStatus('wamid.test-delivery', 'failed');
      await continuation.recordProviderStatus('wamid.test-delivery', 'delivered');
      expect((await row()).rows[0]).toMatchObject({ pending_question: null,
        outbound_question: { status: 'failed' } });
      expect(await cache.getJson(cacheKey)).toMatchObject({ pendingQuestion: null,
        outboundQuestion: { status: 'failed' } });
      expect((await history()).rows[0].status).toBe('failed');
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('interprets a fast answer against a staged question before a delivery callback', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    const hotel = new HotelSearchSessionService(cache);
    let answerPending: string | undefined;
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => {
        if (context.message.text === '2') answerPending = context.pendingQuestion?.expectedAnswerType;
        return context.message.text === 'Hotels'
          ? { role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: .95,
            suggestedAction: 'clarify', clarificationRequired: true,
            responseText: 'How many guests?',
            followUpQuestion: { text: 'How many guests?', expectedAnswerType: 'guests' } }
          : { role: 'answer_to_current_question', intent: 'hotel_search', entities: { guests: 2 },
            confidence: .95, suggestedAction: 'none', responseText: 'I have noted two guests.' };
      } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`, true);
    try {
      await hotel.saveAwaitingPreferences(traveller, { location: 'Colombo' });
      const firstEvent = inbound('SM-fast-question', 'Hotels');
      await events.saveAccepted(firstEvent);
      const active = await hotel.getAuthoritative(traveller);
      await continuation.record({ ...firstEvent,
        metadata: { ...firstEvent.metadata, outboundDeliveryManaged: true } },
      { analysis: { role: 'new_intent' },
        interpretation: { role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: .95,
          responseText: 'How many guests?',
          followUpQuestion: { text: 'How many guests?', expectedAnswerType: 'guests' } },
        decision: { action: 'ask_clarifying_question', intent: 'hotel_search', targetFlow: 'hotel',
          entities: {}, confidence: .95, missingFields: [], reason: 'Ask for guest count' } } as OrchestrationResult,
      { reply: 'How many guests?', activeSession: { flow: 'hotel', id: active!.id,
        collectedFields: active!.criteria, requiredFields: [], missingFields: [] }, pausedSessions: [] });
      const staged = await continuation.load(firstEvent);
      expect(staged?.pendingQuestion).toBeNull();
      expect(staged?.topic).toBe('hotel');
      expect(staged?.outboundQuestion).toMatchObject({ status: 'attempted',
        question: { expectedAnswerType: 'guests' } });
      await send('SM-fast-answer', '2');
      expect(answerPending).toBe('guests');
      expect((await hotel.getAuthoritative(traveller))?.criteria.guests).toBe(2);
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('uses the delivered guest question rather than conflicting model location metadata', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const hotel = new HotelSearchSessionService(cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === 'Hotels'
          ? { role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
              suggestedAction: 'clarify', clarificationRequired: true,
              responseText: 'How many guests?', question: 'How many guests?',
              followUpQuestion: { text: 'How many guests?', expectedAnswerType: 'location' } }
          : { role: 'change_existing_criteria', intent: 'hotel_search', confidence: 0.95,
              entities: context.message.text === 'Galle' ? { location: 'Galle' } : { guests: 8 },
              suggestedAction: 'none', responseText: 'I have kept your request.' } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      await hotel.saveAwaitingPreferences(traveller, { location: 'Colombo' });
      expect((await send('SM-phase8-conflicting-question', 'Hotels')).reply).toContain('How many guests?');
      for (const state of [await continuation.load(inbound('SM-phase8-conflicting-question', 'Hotels')),
        await cache.getJson<{ topic: string; pendingQuestion: { expectedAnswerType: string } }>(cacheKey)])
        expect(state).toMatchObject({ topic: 'hotel', pendingQuestion: { expectedAnswerType: 'guests' } });
      const invalid = await send('SM-phase8-conflicting-location', 'Galle');
      expect(invalid.reply).toMatch(/guests|how many|detail/i);
      expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Colombo' });
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria)
        .toMatchObject({ location: 'Colombo' });
      expect(await continuation.load(inbound('SM-phase8-conflicting-location', 'Galle')))
        .toMatchObject({ pendingQuestion: { expectedAnswerType: 'guests' } });
      expect((await cache.getJson<{ pendingQuestion: { expectedAnswerType: string } }>(cacheKey))?.pendingQuestion)
        .toMatchObject({ expectedAnswerType: 'guests' });
      await send('SM-phase8-conflicting-valid-count', '2');
      expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Colombo', guests: 2 });
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria)
        .toMatchObject({ location: 'Colombo', guests: 2 });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('binds memory facts and companion names to their actual subjects and beneficiaries', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    const candidate = (key: 'preference' | 'trip_destination' | 'current_location' | 'companion_name', value: string) =>
      ({ key, value, scope: 'trip' as const, confidence: 0.99, explicit: true });
    const proposals: Record<string, ReturnType<typeof candidate>[]> = {
      'I want vegetarian food for my daughter': [candidate('preference', 'vegetarian')],
      'My son prefers a quiet hotel': [candidate('preference', 'quiet')],
      'My mother is travelling to Galle': [candidate('trip_destination', 'Galle')],
      'I am called Sarah; my wife is called Maria': [candidate('companion_name', 'Sarah'), candidate('companion_name', 'Maria')],
      'My wife prefers vegetarian food and I prefer vegan food': [candidate('preference', 'vegetarian'), candidate('preference', 'vegan')],
      'I am currently in Colombo': [candidate('current_location', 'Colombo')],
      'I am travelling to Galle': [candidate('trip_destination', 'Galle')],
      'I prefer quiet hotels': [candidate('preference', 'quiet')],
    };
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => ({
        role: 'question_or_faq', intent: 'general_inquiry', entities: {}, confidence: 0.95,
        suggestedAction: 'none', responseText: 'I understand.',
        memoryCandidates: proposals[context.message.text] ?? [],
      }) } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    const rows = (id: string) => pool.query(`SELECT tm.memory_key, tm.memory_value FROM traveller_memories tm
      JOIN users u ON u.user_id=tm.user_id WHERE u.phone_number=$1 AND tm.source_message_id=$2`, [phone, id]);
    try {
      await send('SM-phase8-daughter-beneficiary', 'I want vegetarian food for my daughter');
      await send('SM-phase8-son-preference', 'My son prefers a quiet hotel');
      await send('SM-phase8-mother-destination', 'My mother is travelling to Galle');
      for (const id of ['SM-phase8-daughter-beneficiary', 'SM-phase8-son-preference', 'SM-phase8-mother-destination'])
        expect((await rows(id)).rows).toHaveLength(0);
      await send('SM-phase8-two-names', 'I am called Sarah; my wife is called Maria');
      expect((await rows('SM-phase8-two-names')).rows).toMatchObject([
        { memory_key: 'companion_name', memory_value: 'Maria' },
      ]);
      await send('SM-phase8-mixed-preferences', 'My wife prefers vegetarian food and I prefer vegan food');
      expect((await rows('SM-phase8-mixed-preferences')).rows).toMatchObject([
        { memory_key: 'preference', memory_value: 'vegan' },
      ]);
      for (const [id, body, key, value] of [
        ['SM-phase8-first-person-location', 'I am currently in Colombo', 'current_location', 'Colombo'],
        ['SM-phase8-first-person-destination', 'I am travelling to Galle', 'trip_destination', 'Galle'],
        ['SM-phase8-first-person-preference', 'I prefer quiet hotels', 'preference', 'quiet'],
      ]) {
        await send(id, body);
        expect((await rows(id)).rows).toMatchObject([{ memory_key: key, memory_value: value }]);
      }
      expect(await cache.getJson(cacheKey)).not.toBeNull();
      await cache.deleteKey(cacheKey);
      const restored = await continuation.load(inbound('SM-phase8-first-person-preference', 'I prefer quiet hotels'));
      expect(restored).not.toBeNull();
      expect(await cache.getJson(cacheKey)).not.toBeNull();
      expect((await new PostgresTravellerMemoryRepository().findForContext(traveller, ['trip:current']))
        .filter((fact) => fact.status === 'proposed').map((fact) => `${fact.key}:${fact.value}`))
        .toEqual(expect.arrayContaining(['companion_name:Maria', 'current_location:Colombo',
          'trip_destination:Galle', 'preference:quiet']));
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('does not turn a bare place into an active hotel draft correction without a pending question', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const hotel = new HotelSearchSessionService(cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async () => ({
        role: 'change_existing_criteria', intent: 'hotel_search', confidence: 0.95,
        entities: { location: 'Galle', additionalPreferences: 'Galle' },
        suggestedAction: 'none', responseText: 'I can help with that.',
      }) } }),
    }));
    try {
      await hotel.saveAwaitingPreferences(traveller, { location: 'Colombo' });
      await processNormalizedInboundMessage(normalizeInboundMessage({ MessageSid: 'SM-phase8-bare-place',
        From: traveller, To: 'whatsapp:+15550000000', Body: 'Galle' }), 'corr-phase8-bare-place');
      await processNormalizedInboundMessage(normalizeInboundMessage({ MessageSid: 'SM-phase8-other-trip-place',
        From: traveller, To: 'whatsapp:+15550000000', Body: 'I want to visit Galle' }),
      'corr-phase8-other-trip-place');
      expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Colombo' });
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria)
        .toMatchObject({ location: 'Colombo' });
      await processNormalizedInboundMessage(normalizeInboundMessage({ MessageSid: 'SM-phase8-explicit-search-place',
        From: traveller, To: 'whatsapp:+15550000000', Body: 'Find hotels in Galle' }),
      'corr-phase8-explicit-search-place');
      expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Galle' });
      expect((await hotel.getAuthoritative(traveller))?.criteria).not.toHaveProperty('additionalPreferences');
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria)
        .toMatchObject({ location: 'Galle' });
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria)
        .not.toHaveProperty('additionalPreferences');
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('attributes location, destination and preferences to the traveller rather than companions', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => ({
        role: 'question_or_faq', intent: 'general_inquiry', confidence: 0.95,
        entities: {}, suggestedAction: 'none', responseText: 'I understand.',
        memoryCandidates: [{
          key: /currently in|current location/i.test(context.message.text) ? 'current_location' as const
            : /travell?ing to|my destination/i.test(context.message.text) ? 'trip_destination' as const : 'preference' as const,
          value: /Colombo/i.test(context.message.text) ? 'Colombo' : /Galle/i.test(context.message.text)
            ? 'Galle' : /Kandy/i.test(context.message.text) ? 'Kandy'
              : /Ella/i.test(context.message.text) ? 'Ella'
                : /vegan/i.test(context.message.text) ? 'vegan' : 'vegetarian',
          scope: 'trip' as const, confidence: 0.99, explicit: true,
        }],
      }) } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    const rows = (id: string) => pool.query(`SELECT tm.memory_key, tm.memory_value FROM traveller_memories tm
      JOIN users u ON u.user_id=tm.user_id WHERE u.phone_number=$1 AND tm.source_message_id=$2`, [phone, id]);
    try {
      await send('SM-wife-current-place', 'My wife is currently in Colombo');
      await send('SM-wife-destination', 'My wife is travelling to Galle');
      await send('SM-wife-beneficiary', 'I want vegetarian food for my wife');
      for (const id of ['SM-wife-current-place', 'SM-wife-destination', 'SM-wife-beneficiary'])
        expect((await rows(id)).rows).toHaveLength(0);
      await send('SM-own-current-place', 'I am currently in Colombo');
      await send('SM-own-destination', 'I am travelling to Galle');
      await send('SM-own-preference', 'I prefer vegetarian food');
      expect((await rows('SM-own-current-place')).rows).toMatchObject([
        { memory_key: 'current_location', memory_value: 'Colombo' },
      ]);
      expect((await rows('SM-own-destination')).rows).toMatchObject([
        { memory_key: 'trip_destination', memory_value: 'Galle' },
      ]);
      expect((await rows('SM-own-preference')).rows).toMatchObject([
        { memory_key: 'preference', memory_value: 'vegetarian' },
      ]);
      await cache.deleteKey(cacheKey);
      expect((await new PostgresTravellerMemoryRepository().findForContext(traveller, ['trip:current']))
        .filter((fact) => fact.status === 'proposed').map((fact) => `${fact.key}:${fact.value}`))
        .toEqual(expect.arrayContaining(['current_location:Colombo', 'trip_destination:Galle',
          'preference:vegetarian']));
      await send('SM-own-location-update', 'Set my current location to Kandy');
      await send('SM-own-destination-update', 'Change my destination to Ella');
      await send('SM-own-preference-update', 'Set my preference to vegan');
      for (const [id, key, value] of [
        ['SM-own-location-update', 'current_location', 'Kandy'],
        ['SM-own-destination-update', 'trip_destination', 'Ella'],
        ['SM-own-preference-update', 'preference', 'vegan'],
      ]) expect((await rows(id)).rows).toMatchObject([{ memory_key: key, memory_value: value }]);
      await cache.deleteKey(cacheKey);
      expect((await new PostgresTravellerMemoryRepository().findForContext(traveller, ['trip:current']))
        .filter((fact) => fact.status === 'proposed').map((fact) => `${fact.key}:${fact.value}`))
        .toEqual(expect.arrayContaining(['current_location:Kandy', 'trip_destination:Ella',
          'preference:vegan']));
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });
  it('keeps a pending guest question authoritative when a model calls Galle an area correction', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const hotel = new HotelSearchSessionService(cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => ({
        role: 'change_existing_criteria', intent: 'hotel_search', confidence: 0.95,
        entities: context.message.text === '2' ? { guests: 8 } : { location: 'Galle' },
        suggestedAction: 'none', responseText: 'I have updated the area.',
      }) } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    const persisted = () => hotel.getAuthoritative(traveller);
    const redis = () => cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`);
    try {
      await hotel.saveAwaitingPreferences(traveller, { location: 'Colombo' });
      const first = inbound('SM-phase8-pending-guest-seed', 'Hotels');
      await events.saveAccepted(first, first.payload, first.metadata);
      const seed = plan('hotel_search', 'How many guests?');
      seed.interpretation = { ...seed.interpretation!,
        followUpQuestion: { text: 'How many guests?', expectedAnswerType: 'guests' } };
      await continuation.record(first, seed, {
        reply: 'How many guests?', ...await new ActiveConversationStateLoader().loadWithPaused(traveller),
      });
      expect(await continuation.load(first)).toMatchObject({ topic: 'hotel',
        pendingQuestion: { expectedAnswerType: 'guests' } });
      const invalid = await send('SM-phase8-pending-guest-invalid', 'Galle');
      expect(invalid.reply).toMatch(/guests|how many|detail/i);
      expect((await persisted())?.criteria).toMatchObject({ location: 'Colombo' });
      expect((await redis())?.criteria).toMatchObject({ location: 'Colombo' });
      expect(await continuation.load(inbound('SM-phase8-pending-guest-invalid', 'Galle')))
        .toMatchObject({ topic: 'hotel', pendingQuestion: { expectedAnswerType: 'guests' } });
      await send('SM-phase8-pending-guest-valid', '2');
      expect((await persisted())?.criteria).toMatchObject({ location: 'Colombo', guests: 2 });
      expect((await redis())?.criteria).toMatchObject({ location: 'Colombo', guests: 2 });
      const correction = await send('SM-phase8-pending-guest-correction', 'Change my hotel area to Galle');
      expect(correction.reply).toMatch(/Galle|updated/i);
      expect((await persisted())?.criteria).toMatchObject({ location: 'Galle', guests: 2 });
      expect((await redis())?.criteria).toMatchObject({ location: 'Galle', guests: 2 });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('does not attribute a companion preference to the traveller or lose first-person memory after Redis loss', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const hotel = new HotelSearchSessionService(cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => ({
        role: 'question_or_faq', intent: 'general_inquiry', entities: {}, confidence: 0.95,
        suggestedAction: 'none', responseText: 'I can keep that in mind.',
        memoryCandidates: [{ key: 'preference', value: 'vegetarian', scope: 'profile',
          confidence: 0.99, explicit: true }],
      }) } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    const rows = (id: string) => pool.query(`SELECT tm.memory_value, tm.status FROM traveller_memories tm
      JOIN users u ON u.user_id=tm.user_id WHERE u.phone_number=$1 AND tm.source_message_id=$2`, [phone, id]);
    try {
      await hotel.saveAwaitingPreferences(traveller, { location: 'Colombo' });
      await send('SM-phase8-wife-preference', 'My wife prefers vegetarian food');
      expect((await rows('SM-phase8-wife-preference')).rows).toHaveLength(0);
      await send('SM-phase8-group-preference', 'We prefer vegetarian food');
      expect((await rows('SM-phase8-group-preference')).rows).toHaveLength(0);
      expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Colombo' });
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria)
        .toMatchObject({ location: 'Colombo' });
      await send('SM-phase8-own-preference', 'I prefer vegetarian food');
      expect((await rows('SM-phase8-own-preference')).rows).toMatchObject([
        { memory_value: 'vegetarian', status: 'proposed' },
      ]);
      expect((await send('SM-phase8-own-preference-consent', 'remember it')).reply).toContain('I’ll remember');
      await cache.deleteKey(`hotel-search:${traveller}`);
      expect((await hotel.get(traveller))?.criteria).toMatchObject({ location: 'Colombo' });
      expect((await new PostgresTravellerMemoryRepository().findForContext(traveller))
        .some((fact) => fact.key === 'preference' && fact.value === 'vegetarian' && fact.status === 'confirmed'))
        .toBe(true);
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it.each(['hotel', 'itinerary'] as const)('keeps an informational turn out of the %s draft', async (flow) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async () => ({
        role: 'question_or_faq', intent: 'general_inquiry', entities: {}, confidence: 0.95,
        suggestedAction: 'none', responseText: 'I can explain the options.',
      }) } }),
    }));
    const hotel = new HotelSearchSessionService(cache);
    const itinerary = new ItinerarySessionService(cache);
    const text = flow === 'hotel' ? 'What facilities do hotels in Galle have?'
      : 'What are the highlights of Galle?';
    try {
      if (flow === 'hotel') await hotel.saveAwaitingPreferences(traveller, { location: 'Colombo' });
      else await itinerary.saveAwaitingPreferences(traveller, {
        arrivalDate: '2026-12-01', arrivalTime: '10:00', departureDate: '2026-12-03',
        departureTime: '18:00', adults: 2, budget: 'moderate', travelStyle: 'relaxed',
      });
      const reply = await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: `SM-phase8-${flow}-info-draft`, From: traveller,
        To: 'whatsapp:+15550000000', Body: text,
      }), `corr-phase8-${flow}-info-draft`);
      expect(reply.reply).toContain('explain');
      if (flow === 'hotel') {
        expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Colombo' });
        expect((await hotel.getAuthoritative(traveller))?.criteria).not.toHaveProperty('additionalPreferences');
        expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria)
          .not.toHaveProperty('additionalPreferences');
      } else {
        expect((await itinerary.getAuthoritative(traveller))?.criteria).not.toHaveProperty('additionalPreferences');
        expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`itinerary:${traveller}`))?.criteria)
          .not.toHaveProperty('additionalPreferences');
      }
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it.each(['hotel', 'itinerary'] as const)('guards the legacy %s draft handler even when it is reached', async (flow) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    // Force the compatibility executor to run. The normal DecisionEngine
    // answers this informational turn before the legacy handler is reached.
    const targetIntent = flow === 'hotel' ? 'hotel_search' : 'itinerary_plan';
    const forcedDecision = {
      decide: () => ({ action: 'handle_command', intent: targetIntent, targetFlow: flow,
        confidence: 0.95, entities: {}, missingFields: [], reason: 'compatibility guard regression' }),
      validateResponseQuestion: (_input: unknown, decision: unknown) => decision,
    } as unknown as DecisionEngine;
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ decisionEngine: forcedDecision,
        llmInterpreter: { interpret: async () => ({ role: 'question_or_faq', intent: targetIntent,
          entities: {}, confidence: 0.95, suggestedAction: 'none',
          responseText: 'I can explain the options.' }) } }),
    }));
    const hotel = new HotelSearchSessionService(cache);
    const itinerary = new ItinerarySessionService(cache);
    try {
      if (flow === 'hotel') await hotel.saveAwaitingPreferences(traveller, { location: 'Colombo' });
      else await itinerary.saveAwaitingPreferences(traveller, {
        arrivalDate: '2026-12-01', arrivalTime: '10:00', departureDate: '2026-12-03',
        departureTime: '18:00', adults: 2, budget: 'moderate', travelStyle: 'relaxed',
      });
      const text = flow === 'hotel' ? 'What facilities do hotels in Galle have?'
        : 'What are the highlights of Galle?';
      await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: `SM-phase8-${flow}-forced-legacy-info`, From: traveller,
        To: 'whatsapp:+15550000000', Body: text,
      }), `corr-phase8-${flow}-forced-legacy-info`);
      await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: `SM-phase8-${flow}-forced-legacy-unrelated`, From: traveller,
        To: 'whatsapp:+15550000000', Body: 'I need a taxi',
      }), `corr-phase8-${flow}-forced-legacy-unrelated`);
      if (flow === 'hotel') {
        expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Colombo' });
        expect((await hotel.getAuthoritative(traveller))?.criteria).not.toHaveProperty('additionalPreferences');
        expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria)
          .not.toHaveProperty('additionalPreferences');
        await processNormalizedInboundMessage(normalizeInboundMessage({
          MessageSid: 'SM-phase8-hotel-forced-legacy-explicit', From: traveller,
          To: 'whatsapp:+15550000000', Body: 'Quiet room please',
        }), 'corr-phase8-hotel-forced-legacy-explicit');
        expect((await hotel.getAuthoritative(traveller))?.criteria.additionalPreferences).toBe('Quiet room please');
        expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria)
          .toMatchObject({ additionalPreferences: 'Quiet room please' });
      } else {
        expect((await itinerary.getAuthoritative(traveller))?.criteria).not.toHaveProperty('additionalPreferences');
        expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`itinerary:${traveller}`))?.criteria)
          .not.toHaveProperty('additionalPreferences');
      }
      const seed = inbound(`SM-phase8-${flow}-pending-preference-seed`, 'Preferences');
      await events.saveAccepted(seed, seed.payload, seed.metadata);
      const question = `Any other ${flow} preferences?`;
      const pendingPlan = { analysis: { role: 'new_intent' },
        interpretation: { role: 'new_intent', intent: targetIntent, entities: {}, confidence: 0.95,
          responseText: question, followUpQuestion: { text: question, expectedAnswerType: 'preference' } },
        decision: { action: 'answer_general_question', intent: targetIntent, targetFlow: flow,
          entities: {}, confidence: 0.95, missingFields: [], reason: 'pending preference fixture' },
        context: { activeSession: undefined } } as OrchestrationResult;
      await continuation.record(seed, pendingPlan, {
        reply: question, ...await new ActiveConversationStateLoader().loadWithPaused(traveller),
      });
      expect((await continuation.load(seed))?.pendingQuestion).toMatchObject({
        expectedAnswerType: 'preference',
      });
      const beforeUnrelated = flow === 'hotel' ? (await hotel.getAuthoritative(traveller))?.criteria
        : (await itinerary.getAuthoritative(traveller))?.criteria;
      await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: `SM-phase8-${flow}-pending-unrelated-switch`, From: traveller,
        To: 'whatsapp:+15550000000', Body: 'Taxi please',
      }), `corr-phase8-${flow}-pending-unrelated-switch`);
      const beforeAnswer = flow === 'hotel' ? (await hotel.getAuthoritative(traveller))?.criteria
        : (await itinerary.getAuthoritative(traveller))?.criteria;
      expect(beforeAnswer?.additionalPreferences).toBe(beforeUnrelated?.additionalPreferences);
      expect((await continuation.load(inbound(`SM-phase8-${flow}-pending-unrelated-switch`, 'Taxi please'))
        )?.pendingQuestion).toMatchObject({ expectedAnswerType: 'preference' });
      const answer = flow === 'hotel' ? 'Garden view' : 'Slow pace';
      await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: `SM-phase8-${flow}-pending-preference-answer`, From: traveller,
        To: 'whatsapp:+15550000000', Body: answer,
      }), `corr-phase8-${flow}-pending-preference-answer`);
      const durable = flow === 'hotel' ? (await hotel.getAuthoritative(traveller))?.criteria
        : (await itinerary.getAuthoritative(traveller))?.criteria;
      const cached = (await cache.getJson<{ criteria: Record<string, unknown> }>(
        `${flow === 'hotel' ? 'hotel-search' : 'itinerary'}:${traveller}`))?.criteria;
      expect(durable?.additionalPreferences).toContain(answer);
      expect(cached?.additionalPreferences).toContain(answer);
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });
  it('retains the PostgreSQL pending question across a failed model turn and a short answer', async () => {
    const service = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const first = inbound('SM-phase8-failure-question', 'Activities');
    await events.saveAccepted(first, first.payload, first.metadata);
    await service.record(first, plan('excursion_search', 'Which area?'), {
      reply: 'Which area?', activeSession: null, pausedSessions: [],
    });
    const failed = inbound('SM-phase8-failure', 'Can you help?');
    await events.saveAccepted(failed, failed.payload, failed.metadata);
    await service.record(failed, plan('hotel_search'), {
      reply: 'I could not process that just now.', activeSession: null, pausedSessions: [],
    }, true);
    await cache.deleteKey(cacheKey);
    expect(await service.load(failed)).toMatchObject({ topic: 'excursion', revision: 2,
      pendingQuestion: { text: 'Which area?', expectedAnswerType: 'location' } });
    const answer = await new Orchestrator({ llmInterpreter: { interpret: async () => ({
      role: 'question_or_faq', intent: 'general_inquiry', entities: {}, confidence: 0.9,
      responseText: 'How can I help?', suggestedAction: 'none',
    }) } }).plan({ inboundMessage: normalizeInboundMessage({
      MessageSid: 'SM-phase8-failure-answer', From: traveller,
      To: 'whatsapp:+15550000000', Body: 'Colombo',
    }), text: 'Colombo', profileComplete: true, continuation: await service.load(failed) });
    expect(answer.decision).toMatchObject({ action: 'continue_flow', targetFlow: 'excursion',
      entities: { destination: 'Colombo' } });
    await new ExcursionSearchSessionService(cache).saveAwaitingPreferences(traveller,
      answer.decision.sessionPatch?.collectedFields ?? {});
    const answered = inbound('SM-phase8-failure-answer', 'Colombo');
    await events.saveAccepted(answered, answered.payload, answered.metadata);
    await service.record(answered, answer, { ...await new ActiveConversationStateLoader().loadWithPaused(traveller),
      reply: answer.interpretation?.responseText ?? 'Got it, Colombo.' });
    expect((await service.load(answered))?.pendingQuestion).toMatchObject({ expectedAnswerType: 'preference' });
  });

  it('verifies migration 030 and restores a pending question after Redis loss', async () => {
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='journey_event_checkpoints' AND column_name IN
       ('conversation_topic','pending_question','conversation_revision','conversation_generation','conversation_state_event_id')`);
    expect(columns.rows).toHaveLength(5);
    const migration = await pool.query(`SELECT filename FROM schema_migrations
      WHERE filename='030_journey_conversation_continuation.sql'`);
    expect(migration.rowCount).toBe(1);
    const first = inbound('SM-phase8-first', 'Activities');
    expect(await events.saveAccepted(first, first.payload, first.metadata)).toBe(true);
    const service = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const question = 'Which area would you like to explore?';
    await service.record(first, plan('excursion_search', question), {
      reply: question, activeSession: null, pausedSessions: [],
    });
    expect(await cache.getJson(cacheKey)).toMatchObject({ topic: 'excursion',
      pendingQuestion: { expectedAnswerType: 'location' } });
    await cache.deleteKey(cacheKey);
    const restartedCache = new StateStore();
    try {
      const restarted = new ConversationContinuationService(new PostgresConversationContinuationRepository(),
        restartedCache);
      expect(await restarted.load(first)).toMatchObject({ topic: 'excursion', revision: 1,
        pendingQuestion: { text: question } });
      expect(await cache.getJson(cacheKey)).toMatchObject({ topic: 'excursion' });
    } finally { await restartedCache.disconnect(); }
  });

  it('keeps a reset boundary and rejects a late pre-reset write', async () => {
    const service = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const first = inbound('SM-phase8-old', 'Activities');
    await events.saveAccepted(first, first.payload, first.metadata);
    await service.record(first, plan('excursion_search', 'Which area?'), {
      reply: 'Which area?', activeSession: null, pausedSessions: [],
    });
    const reset = inbound('SM-phase8-reset', 'reset');
    await events.saveAccepted(reset, reset.payload, reset.metadata);
    await service.reset(reset);
    await expect(service.record(first, plan('hotel_search'), {
      reply: 'Hotels?', activeSession: null, pausedSessions: [],
    })).rejects.toMatchObject({ status: 'failed' });
    const next = inbound('SM-phase8-next', 'Hello');
    await events.saveAccepted(next, next.payload, next.metadata);
    await service.record(next, undefined, { reply: 'Hello!', activeSession: null, pausedSessions: [] });
    expect(await service.load(next)).toMatchObject({ topic: null, pendingQuestion: null, generation: 1 });
  });

  it('follows the actual active workflow while keeping the previous task paused', async () => {
    const excursions = new ExcursionSearchSessionService(cache);
    const hotels = new HotelSearchSessionService(cache);
    const loader = new ActiveConversationStateLoader();
    const service = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const intro = inbound('SM-phase8-activities', 'Activities');
    await events.saveAccepted(intro, intro.payload, intro.metadata);
    const areaQuestion = 'Which area would you like to explore?';
    await service.record(intro, plan('excursion_search', areaQuestion), {
      reply: areaQuestion, activeSession: null, pausedSessions: [],
    });
    const colombo = await new Orchestrator({ llmInterpreter: { interpret: async () => ({
      role: 'question_or_faq', intent: 'general_inquiry', entities: {}, confidence: 0.9,
      responseText: 'How can I help?', suggestedAction: 'none',
    }) } }).plan({ inboundMessage: normalizeInboundMessage({
      MessageSid: 'SM-phase8-colombo', From: traveller, To: 'whatsapp:+15550000000', Body: 'Colombo',
    }), text: 'Colombo', profileComplete: true, continuation: await service.load(intro) });
    expect(colombo.decision).toMatchObject({ action: 'continue_flow', targetFlow: 'excursion',
      entities: { destination: 'Colombo' } });
    await excursions.saveAwaitingPreferences(traveller,
      colombo.decision.sessionPatch?.collectedFields ?? {});
    const colomboEvent = inbound('SM-phase8-colombo', 'Colombo');
    await events.saveAccepted(colomboEvent, colomboEvent.payload, colomboEvent.metadata);
    await service.record(colomboEvent, colombo, {
      ...await loader.loadWithPaused(traveller),
      reply: colombo.interpretation?.responseText ?? 'Got it, Colombo.',
    });
    await excursions.pause(traveller);
    await hotels.saveAwaitingPreferences(traveller, { location: 'Negombo', additionalPreferences: 'beachfront' });
    const firstState = await loader.loadWithPaused(traveller);
    expect(firstState.activeSession?.flow).toBe('hotel');
    expect(firstState.pausedSessions.map((item) => item.flow)).toContain('excursion');
    const hotelTurn = inbound('SM-phase8-hotel', 'Hotels');
    await events.saveAccepted(hotelTurn, hotelTurn.payload, hotelTurn.metadata);
    await service.record(hotelTurn, plan('hotel_search'), { ...firstState, reply: 'Here are stays.' });
    expect((await service.load(hotelTurn))?.topic).toBe('hotel');
    await hotels.pause(traveller);
    await excursions.resume(traveller);
    const resumed = await loader.loadWithPaused(traveller);
    expect(resumed.activeSession?.flow).toBe('excursion');
    expect(resumed.pausedSessions.map((item) => item.flow)).toContain('hotel');
    const resumeTurn = inbound('SM-phase8-resume', 'resume activities');
    await events.saveAccepted(resumeTurn, resumeTurn.payload, resumeTurn.metadata);
    await service.record(resumeTurn, undefined, { ...resumed, reply: 'Resuming activities.' });
    expect((await service.load(resumeTurn))?.topic).toBe('excursion');
    expect((await excursions.getAuthoritative(traveller))?.criteria.destination).toBe('Colombo');
    expect((await hotels.getAuthoritative(traveller))?.criteria).toMatchObject({
      location: 'Negombo', additionalPreferences: 'beachfront',
    });
  });

  it('carries an airport answer and beachfront preference into the saved hotel draft', async () => {
    const service = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const intro = inbound('SM-phase8-beach', 'A place near the airport with a beach view');
    await events.saveAccepted(intro, intro.payload, intro.metadata);
    const airportQuestion = 'Which airport do you mean?';
    await service.record(intro, plan('hotel_search', airportQuestion), {
      reply: airportQuestion, activeSession: null, pausedSessions: [],
    });
    const hotels = new HotelSearchSessionService(cache);
    await hotels.saveAwaitingPreferences(traveller, { additionalPreferences: 'beachfront view' });
    const answer = await new Orchestrator({ llmInterpreter: { interpret: async () => ({
      role: 'answer_to_current_question', intent: 'hotel_search', confidence: 0.9,
      entities: { location: 'Colombo Airport', additionalPreferences: 'beachfront view' },
      responseText: 'I can look for beachfront stays near Colombo Airport.', suggestedAction: 'none',
    }) } }).plan({ inboundMessage: normalizeInboundMessage({
      MessageSid: 'SM-phase8-airport', From: traveller, To: 'whatsapp:+15550000000', Body: 'Colombo Airport',
    }), text: 'Colombo Airport', profileComplete: true,
      activeSession: (await new ActiveConversationStateLoader().loadWithPaused(traveller)).activeSession,
      continuation: await service.load(intro),
      conversationHistory: [{ role: 'user', content: 'A place near the airport with a beach view' },
        { role: 'assistant', content: airportQuestion }],
    });
    expect(answer.decision.action).toBe('continue_flow');
    await hotels.saveAwaitingPreferences(traveller, answer.decision.sessionPatch?.collectedFields ?? {});
    const answerEvent = inbound('SM-phase8-airport', 'Colombo Airport');
    await events.saveAccepted(answerEvent, answerEvent.payload, answerEvent.metadata);
    await service.record(answerEvent, answer, {
      ...await new ActiveConversationStateLoader().loadWithPaused(traveller),
      reply: answer.interpretation?.responseText ?? 'I can look for beachfront stays.',
    });
    expect((await hotels.getAuthoritative(traveller))?.criteria).toMatchObject({
      location: 'Colombo Airport', additionalPreferences: 'beachfront view',
    });
  });

  it.each([
    { caseName: 'accepted with metadata', accepted: true, modelIntent: 'hotel_search', includeMetadata: true },
    { caseName: 'rejected with metadata', accepted: false, modelIntent: 'hotel_search', includeMetadata: true },
    { caseName: 'rejected without optional metadata', accepted: false, modelIntent: 'hotel_search', includeMetadata: false },
    { caseName: 'informational hotel question rejects a model switch', accepted: false,
      modelIntent: 'hotel_search', includeMetadata: false, forceSwitch: true },
    { caseName: 'general inquiry without optional metadata', accepted: false, modelIntent: 'general_inquiry', includeMetadata: false },
    { caseName: 'accepted without follow-up metadata', accepted: true, modelIntent: 'hotel_search', includeMetadata: false },
    { caseName: 'explicit switch without transition metadata', accepted: true, modelIntent: 'hotel_search',
      includeMetadata: false, omitTransition: true, message: "Let's look at hotels instead." },
    { caseName: 'accepted generic area question', accepted: true, modelIntent: 'hotel_search', includeMetadata: false, genericQuestion: true },
    { caseName: 'rejected despite model clarification', accepted: false, modelIntent: 'hotel_search', includeMetadata: true, clarificationRequired: true },
    { caseName: 'accepted despite conflicting metadata', accepted: true, modelIntent: 'hotel_search', includeMetadata: true,
      metadataText: 'Which area would you prefer for dining?' },
    { caseName: 'rejected despite conflicting metadata', accepted: false, modelIntent: 'hotel_search', includeMetadata: true,
      metadataText: 'Which area would you prefer for dining?' },
    { caseName: 'actual dining question rejects a proposed hotel switch', accepted: false, modelIntent: 'hotel_search',
      includeMetadata: true, forceSwitch: true, hotelQuestion: 'Which area would you prefer for dining?',
      metadataText: 'Which area would you prefer for your hotel?' },
    { caseName: 'accepted neighbourhood paraphrase', accepted: true, modelIntent: 'hotel_search', includeMetadata: false,
      hotelQuestion: 'Which neighbourhood would you prefer for your stay?' },
  ] as const)('keeps an excursion and hotel question coherent: $caseName', async ({ accepted, modelIntent, includeMetadata, ...caseOptions }) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const excursion = new ExcursionSearchSessionService(cache);
    const hotel = new HotelSearchSessionService(cache);
    await excursion.saveAwaitingPreferences(traveller, { destination: 'Kandy' });
    const originalExcursionId = (await excursion.getAuthoritative(traveller))?.id;
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    const interpreted: string[] = [];
    const hotelQuestion = 'hotelQuestion' in caseOptions ? caseOptions.hotelQuestion
      : 'genericQuestion' in caseOptions && caseOptions.genericQuestion
        ? 'Which area would you prefer?' : 'Which area would you prefer for your hotel?';
    const switchMessage = 'message' in caseOptions ? caseOptions.message
      : accepted ? 'Hotels' : 'Are there hotels near the activity?';
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => {
        interpreted.push(context.message.text);
        if (context.message.text === "Let's return to activities instead.") return {
          role: 'new_intent', intent: 'excursion_search', entities: {}, confidence: 0.95,
          suggestedAction: 'none', responseText: 'Let us return to your activities in Kandy.',
        };
        if (context.message.text === switchMessage) return {
          role: modelIntent === 'general_inquiry' ? 'question_or_faq' : 'new_intent',
          intent: modelIntent, entities: {}, confidence: 0.95,
          ...(accepted && !('omitTransition' in caseOptions) || 'forceSwitch' in caseOptions ? { taskTransition: 'switch' as const }
            : includeMetadata ? { taskTransition: 'none' as const } : {}),
          suggestedAction: 'none',
          responseText: hotelQuestion,
          ...('clarificationRequired' in caseOptions ? {
            clarificationRequired: true, question: hotelQuestion } : {}),
          ...(includeMetadata ? { followUpQuestion: {
            text: 'metadataText' in caseOptions ? caseOptions.metadataText : hotelQuestion,
            expectedAnswerType: 'location' } } : {}),
        };
        return { role: 'answer_to_current_question', intent: 'hotel_search',
          entities: { location: 'Colombo' }, confidence: 0.95, suggestedAction: 'none',
          responseText: 'Got it, Colombo.' };
      } } }),
    }));
    try {
      const first = await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: 'SM-phase8-service-switch', From: traveller, To: 'whatsapp:+15550000000', Body: switchMessage,
      }), 'corr-phase8-service-switch');
      expect(first.reply).toBe(accepted
        ? hotelQuestion
        : 'Would you like to continue your current request or switch to the new one?');
      const firstEvent = inbound('SM-phase8-service-switch', switchMessage);
      const state = await continuation.load(firstEvent);
      const activeExcursion = await excursion.getAuthoritative(traveller);
      if (accepted) {
        expect(activeExcursion?.lifecycleStatus).toBe('paused');
        expect((await hotel.getAuthoritative(traveller))?.lifecycleStatus).not.toBe('paused');
        expect(state).toMatchObject({ topic: 'hotel', pendingQuestion: {
          text: hotelQuestion, expectedAnswerType: 'location',
        } });
        const second = await processNormalizedInboundMessage(normalizeInboundMessage({
          MessageSid: 'SM-phase8-service-answer', From: traveller, To: 'whatsapp:+15550000000', Body: 'Colombo',
        }), 'corr-phase8-service-answer');
        expect(second.reply).toContain('Colombo');
        expect(interpreted).toContain('Colombo');
        expect((await hotel.getAuthoritative(traveller))?.criteria.location).toBe('Colombo');
        expect((await continuation.load(inbound('SM-phase8-service-answer', 'Colombo')))?.topic).toBe('hotel');
        if ('omitTransition' in caseOptions) {
          const returned = await processNormalizedInboundMessage(normalizeInboundMessage({
            MessageSid: 'SM-phase8-service-return', From: traveller, To: 'whatsapp:+15550000000',
            Body: "Let's return to activities instead.",
          }), 'corr-phase8-service-return');
          expect(returned.reply).toContain('activities');
          expect((await excursion.getAuthoritative(traveller))).toMatchObject({
            id: originalExcursionId, lifecycleStatus: 'active', criteria: { destination: 'Kandy' },
          });
          expect((await hotel.getAuthoritative(traveller))?.lifecycleStatus).toBe('paused');
          expect((await continuation.load(inbound('SM-phase8-service-return',
            "Let's return to activities instead.")))?.topic).toBe('excursion');
        }
      } else {
        expect(activeExcursion?.lifecycleStatus).not.toBe('paused');
        expect(await hotel.getAuthoritative(traveller)).toBeNull();
        expect(state?.topic).toBe('excursion');
        expect(state?.pendingQuestion?.expectedAnswerType).toBe('service');
        expect(state?.pendingQuestion?.text).toContain('switch');
      }
    } finally {
      initConversationControlPlane();
      initProfileGate();
      initProfileService();
    }
  });

  it('returns the backend restaurant-location confirmation without a conflicting model question', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const hotel = new HotelSearchSessionService(cache);
    const restaurant = new RestaurantSearchSessionService(cache);
    await hotel.saveAwaitingPreferences(traveller, { location: 'Kandy' });
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async () => ({
        role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: 0.95,
        suggestedAction: 'none', responseText: 'Which dining area would you prefer?',
      }) } }),
    }));
    try {
      const reply = await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: 'SM-priority2-restaurant-switch', From: traveller,
        To: 'whatsapp:+15550000000', Body: "Let's look at restaurants instead.",
      }), 'corr-priority2-restaurant-switch');
      expect(reply.reply).toBe('Would you like me to use Kandy for the restaurant search, or should I look somewhere else?');
      expect((await hotel.getAuthoritative(traveller))?.lifecycleStatus).toBe('paused');
      expect((await restaurant.getAuthoritative(traveller))?.pendingLocationConfirmation).toBe('Kandy');
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it.each([true, false])('rejects unsupported model draft and memory changes without a pending question: metadata=%s', async (metadata) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const hotel = new HotelSearchSessionService(cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => {
        const text = context.message.text;
        const fields = text === 'Tell me about hotel facilities in Galle' ? {}
          : text === 'Change the area to Galle' ? { location: 'Galle' }
          : text === 'Change my hotel area to Galle' ? { location: 'Galle' }
          : text === 'Change the area to Kandy for 4 guests' ? { location: 'Kandy', guests: 4 }
          : text === 'Pool please' ? { location: 'Galle', additionalPreferences: 'Pool' }
          : text === 'I want to know whether this hotel has a pool' ? { additionalPreferences: 'pool' }
          : text.includes('facilities') || text.includes('Galle') ? { location: 'Galle' } : { guests: 8 };
        return { role: text.startsWith('Change') || text === 'What facilities do hotels in Galle have?' ||
            text === 'I live in Galle'
            ? 'change_existing_criteria' : text === 'Pool please' ||
              text === 'Tell me about hotel facilities in Galle'
              ? 'extra_preference' : 'question_or_faq',
          intent: text.startsWith('Change') || text === 'Pool please' || text.includes('facilities') ||
            text === 'I want to know whether this hotel has a pool' ||
            text === 'I live in Galle' ? 'hotel_search' : 'general_inquiry',
          entities: fields, confidence: 0.99, suggestedAction: 'none',
          responseText: text.startsWith('Change') ? 'I have updated your stay preferences.'
            : text === 'Pool please' ? 'I have noted the pool preference.'
              : text.includes('facilities') ? undefined : 'I can help with that question.',
          ...(metadata ? { followUpQuestion: { text: 'What else matters?', expectedAnswerType: 'preference' } } : {}),
          memoryCandidates: text.includes('facilities') || /^I want (?:to know|to find out|details)/.test(text) ||
            text === 'I visited Galle' || text.startsWith('Are there hotels')
            ? [{ key: 'preference', value: text.includes('pool') ? 'pool' : 'Galle',
                scope: 'trip', confidence: 0.99, explicit: true }]
            : [],
        };
      } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    const persisted = async () => (await hotel.getAuthoritative(traveller))?.criteria;
    const cached = async () => (await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria;
    try {
      await hotel.saveAwaitingPreferences(traveller, {});
      await send('SM-phase8-new-field-past-visit', 'I visited Galle');
      expect((await persisted())?.location).toBeUndefined();
      expect((await cached())?.location).toBeUndefined();
      expect((await pool.query(`SELECT tm.memory_value FROM traveller_memories tm JOIN users u ON u.user_id=tm.user_id
        WHERE u.phone_number=$1 AND tm.source_message_id=$2`, [phone, 'SM-phase8-new-field-past-visit'])).rows)
        .toHaveLength(0);
      await hotel.saveAwaitingPreferences(traveller, { location: 'Colombo', guests: 2 });
      await send('SM-phase8-global-facilities', 'What facilities do hotels in Galle have?');
      expect(await persisted()).toMatchObject({ location: 'Colombo', guests: 2 });
      expect(await cached()).toMatchObject({ location: 'Colombo', guests: 2 });
      const memories = await pool.query(`SELECT tm.memory_value FROM traveller_memories tm JOIN users u ON u.user_id=tm.user_id
        WHERE u.phone_number=$1 AND tm.source_message_id=$2`, [phone, 'SM-phase8-global-facilities']);
      expect(memories.rows).toHaveLength(0);
      await send('SM-phase8-global-hotel-shortcut-question', 'Tell me about hotel facilities in Galle');
      expect(await persisted()).toMatchObject({ location: 'Colombo', guests: 2 });
      expect(await cached()).toMatchObject({ location: 'Colombo', guests: 2 });
      await send('SM-phase8-pool-information', 'I want to know whether this hotel has a pool');
      expect(await persisted()).toMatchObject({ location: 'Colombo', guests: 2 });
      expect((await persisted())?.additionalPreferences).toBeUndefined();
      expect((await cached())?.additionalPreferences).toBeUndefined();
      expect((await pool.query(`SELECT tm.memory_value FROM traveller_memories tm JOIN users u ON u.user_id=tm.user_id
        WHERE u.phone_number=$1 AND tm.source_message_id=$2`, [phone, 'SM-phase8-pool-information'])).rows)
        .toHaveLength(0);
      await send('SM-phase8-global-context-statement', 'I live in Galle');
      expect(await persisted()).toMatchObject({ location: 'Colombo', guests: 2 });
      expect(await cached()).toMatchObject({ location: 'Colombo', guests: 2 });
      for (const [id, message] of [
        ['SM-phase8-info-statement', 'I want to know about hotels in Galle'],
        ['SM-phase8-find-out', 'I want to find out about hotels in Galle'],
        ['SM-phase8-details', 'I want details about hotels in Galle'],
        ['SM-phase8-compare', 'I want to compare hotels in Galle'],
        ['SM-phase8-past-visit', 'I visited Galle'],
        ['SM-phase8-nearby-question', 'Are there hotels near Galle?'],
      ] as const) {
        await send(id, message);
        expect(await persisted()).toMatchObject({ location: 'Colombo', guests: 2 });
        expect(await cached()).toMatchObject({ location: 'Colombo', guests: 2 });
        const stored = await pool.query(`SELECT tm.memory_value FROM traveller_memories tm JOIN users u ON u.user_id=tm.user_id
          WHERE u.phone_number=$1 AND tm.source_message_id=$2`, [phone, id]);
        expect(stored.rows).toHaveLength(0);
      }
      await send('SM-phase8-global-general', 'What is the weather today?');
      expect(await persisted()).toMatchObject({ location: 'Colombo', guests: 2 });
      expect(await cached()).toMatchObject({ location: 'Colombo', guests: 2 });
      await send('SM-phase8-global-correction', 'Change my hotel area to Galle');
      expect(await persisted()).toMatchObject({ location: 'Galle', guests: 2 });
      expect(await cached()).toMatchObject({ location: 'Galle', guests: 2 });
      await send('SM-phase8-global-multi', 'Change the area to Kandy for 4 guests');
      expect(await persisted()).toMatchObject({ location: 'Kandy', guests: 4 });
      expect(await cached()).toMatchObject({ location: 'Kandy', guests: 4 });
      await send('SM-phase8-global-hotel-shortcut', 'Pool please');
      expect(await persisted()).toMatchObject({ location: 'Kandy', guests: 4,
        additionalPreferences: 'Pool please' });
      await cache.deleteKey(`hotel-search:${traveller}`);
      expect((await hotel.get(traveller))?.criteria).toMatchObject({ location: 'Kandy', guests: 4,
        additionalPreferences: 'Pool please' });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('keeps restaurant preferences grounded before creating a patch and persists an explicit later update', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const restaurant = new RestaurantSearchSessionService(cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => {
        const text = context.message.text;
        if (text === 'Restaurants') return { role: 'new_intent', intent: 'restaurant_search',
          entities: {}, confidence: 0.95, suggestedAction: 'none',
          responseText: 'Is there an atmosphere or preference you have in mind?',
          followUpQuestion: { text: 'Is there an atmosphere or preference you have in mind?',
            expectedAnswerType: 'preference' } };
        return { role: text.startsWith('I prefer') ? 'change_existing_criteria' : 'extra_preference',
          intent: 'restaurant_search', confidence: 0.95,
          entities: { additionalPreferences: text === 'Somewhere romantic' ? 'Galle'
            : text.startsWith('I want to know') ? 'Romantic' : 'Somewhere quiet' },
          suggestedAction: 'none', responseText: 'I have noted your preference.' };
      } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      await send('SM-phase8-restaurant-preference-start', 'Restaurants');
      await restaurant.saveAwaitingPreferences(traveller, { location: 'Colombo' });
      await send('SM-phase8-restaurant-preference-conflict', 'Somewhere romantic');
      expect((await restaurant.getAuthoritative(traveller))?.criteria).toMatchObject({
        location: 'Colombo', additionalPreferences: 'Somewhere romantic',
      });
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`restaurant-search:${traveller}`))?.criteria)
        .toMatchObject({ location: 'Colombo', additionalPreferences: 'Somewhere romantic' });
      await send('SM-phase8-restaurant-preference-explicit', 'I prefer somewhere quiet');
      expect((await restaurant.getAuthoritative(traveller))?.criteria).toMatchObject({
        location: 'Colombo', additionalPreferences: 'Somewhere quiet',
      });
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`restaurant-search:${traveller}`))?.criteria)
        .toMatchObject({ location: 'Colombo', additionalPreferences: 'Somewhere quiet' });
      await send('SM-phase8-restaurant-info', 'I want to know about romantic restaurants');
      expect((await restaurant.getAuthoritative(traveller))?.criteria).toMatchObject({
        location: 'Colombo', additionalPreferences: 'Somewhere quiet',
      });
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`restaurant-search:${traveller}`))?.criteria)
        .toMatchObject({ location: 'Colombo', additionalPreferences: 'Somewhere quiet' });
      await cache.deleteKey(`restaurant-search:${traveller}`);
      expect((await restaurant.get(traveller))?.criteria.additionalPreferences).toBe('Somewhere quiet');
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('switches from hotels to dining and reconciles the next location under restaurants', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const hotels = new HotelSearchSessionService(cache);
    const restaurants = new RestaurantSearchSessionService(cache);
    await hotels.saveAwaitingPreferences(traveller, {});
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === 'Restaurants'
          ? { role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: 0.95,
              taskTransition: 'switch', suggestedAction: 'none',
              responseText: 'Which town or area would you prefer for dining?' }
          : { role: 'answer_to_current_question', intent: 'restaurant_search',
              entities: { location: 'Galle' }, confidence: 0.95, suggestedAction: 'none',
              responseText: 'Got it, Galle.' } } }),
    }));
    try {
      const first = await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: 'SM-phase8-reverse-switch', From: traveller,
        To: 'whatsapp:+15550000000', Body: 'Restaurants',
      }), 'corr-phase8-reverse-switch');
      expect(first.reply).toContain('Which town or area would you prefer for dining?');
      expect((await hotels.getAuthoritative(traveller))?.lifecycleStatus).toBe('paused');
      expect((await restaurants.getAuthoritative(traveller))?.lifecycleStatus).not.toBe('paused');
      expect(await continuation.load(inbound('SM-phase8-reverse-switch', 'Restaurants'))).toMatchObject({
        topic: 'restaurant', pendingQuestion: {
          text: 'Which town or area would you prefer for dining?', expectedAnswerType: 'location',
        },
      });
      await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: 'SM-phase8-reverse-answer', From: traveller,
        To: 'whatsapp:+15550000000', Body: 'Galle',
      }), 'corr-phase8-reverse-answer');
      expect((await restaurants.getAuthoritative(traveller))?.criteria.location).toBe('Galle');
      expect((await hotels.getAuthoritative(traveller))?.lifecycleStatus).toBe('paused');
    } finally {
      initConversationControlPlane();
      initProfileGate();
      initProfileService();
    }
  });

  it.each([
    { flow: 'hotel', intent: 'hotel_search', request: 'Hotels',
      question: 'How many nights would you like for your stay?', answerType: 'nights' },
    { flow: 'restaurant', intent: 'restaurant_search', request: 'Restaurants',
      question: 'Which neighbourhood would you prefer for dining?', answerType: 'location' },
    { flow: 'logistics', intent: 'logistics_request', request: 'Transport',
      question: 'Where should your transfer pick you up?', answerType: 'location' },
    { flow: 'itinerary', intent: 'itinerary_plan', request: 'Itinerary',
      question: 'Which day would you like in your itinerary?', answerType: 'date' },
  ] as const)('binds a paraphrased $flow question to its accepted workflow', async ({ flow, intent, request, question, answerType }) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const excursion = new ExcursionSearchSessionService(cache);
    await excursion.saveAwaitingPreferences(traveller, { destination: 'Kandy' });
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async () => ({
        role: 'new_intent', intent, entities: {}, confidence: 0.95,
        taskTransition: 'switch', suggestedAction: 'none', responseText: question,
      }) } }),
    }));
    try {
      const reply = await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: `SM-phase8-paraphrase-${flow}`, From: traveller,
        To: 'whatsapp:+15550000000', Body: request,
      }), `corr-phase8-paraphrase-${flow}`);
      expect(reply.reply).toContain(question);
      expect((await excursion.getAuthoritative(traveller))?.lifecycleStatus).toBe('paused');
      expect((await new ActiveConversationStateLoader().loadWithPaused(traveller)).activeSession?.flow).toBe(flow);
      expect(await continuation.load(inbound(`SM-phase8-paraphrase-${flow}`, request))).toMatchObject({
        topic: flow, pendingQuestion: { text: question, expectedAnswerType: answerType },
      });
    } finally {
      initConversationControlPlane(); initProfileGate(); initProfileService();
    }
  });

  it('clarifies a question naming multiple services without switching the active excursion', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const excursion = new ExcursionSearchSessionService(cache);
    await excursion.saveAwaitingPreferences(traveller, { destination: 'Kandy' });
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async () => ({
        role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
        taskTransition: 'switch', suggestedAction: 'none',
        responseText: 'Which area would you prefer for your hotel or restaurant?',
      }) } }),
    }));
    try {
      const reply = await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: 'SM-phase8-multiple-owners', From: traveller,
        To: 'whatsapp:+15550000000', Body: 'Hotels',
      }), 'corr-phase8-multiple-owners');
      expect(reply.reply).toContain('Which request would you like to continue with?');
      expect((await excursion.getAuthoritative(traveller))?.lifecycleStatus).not.toBe('paused');
      expect(await new HotelSearchSessionService(cache).getAuthoritative(traveller)).toBeNull();
      expect(await continuation.load(inbound('SM-phase8-multiple-owners', 'Hotels'))).toMatchObject({
        topic: 'excursion', pendingQuestion: { text: 'Which request would you like to continue with?',
          expectedAnswerType: 'service' },
      });
    } finally {
      initConversationControlPlane(); initProfileGate(); initProfileService();
    }
  });

  it('validates each dining answer before a command or a different field can advance the queue', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => {
        if (context.message.text === 'Restaurants') return {
          role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: 0.95,
          suggestedAction: 'none', responseText: 'Which dining area and how many guests?',
        };
        return { role: 'answer_to_current_question', intent: 'restaurant_search',
          entities: context.message.text === 'Colombo' ? { location: 'Colombo' } : { guests: 3 },
          confidence: 0.95, suggestedAction: 'execute_tool',
          proposedAction: { name: 'search' as const, arguments: {} },
          responseText: 'I will search now.',
        };
      } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    const state = async (id: string, body: string) => continuation.load(inbound(id, body));
    try {
      await send('SM-phase8-ordered-dining-start', 'Restaurants');
      expect(await state('SM-phase8-ordered-dining-start', 'Restaurants')).toMatchObject({
        topic: 'restaurant', pendingQuestion: { expectedAnswerType: 'location',
          remaining: [{ expectedAnswerType: 'guests' }] },
      });
      for (const [id, body] of [
        ['SM-phase8-ordered-dining-number', '2'],
        ['SM-phase8-ordered-dining-count', '2 guests'],
      ]) {
        const reply = await send(id, body);
        expect(reply.reply).toContain('Which dining area?');
        expect(reply.reply).not.toMatch(/book(?:ing|ed)?|search now/i);
        expect(await state(id, body)).toMatchObject({ topic: 'restaurant',
          pendingQuestion: { expectedAnswerType: 'location', remaining: [{ expectedAnswerType: 'guests' }] } });
        expect(await cache.getJson(cacheKey)).toMatchObject({ topic: 'restaurant',
          pendingQuestion: { expectedAnswerType: 'location' } });
        expect(await new RestaurantSearchSessionService(cache).getAuthoritative(traveller)).toBeNull();
      }
      await cache.deleteKey(cacheKey);
      const area = await send('SM-phase8-ordered-dining-area', 'Colombo');
      expect(area.reply).toContain('how many guests?');
      expect(await state('SM-phase8-ordered-dining-area', 'Colombo')).toMatchObject({
        topic: 'restaurant', pendingQuestion: { expectedAnswerType: 'guests' },
      });
      expect((await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .toMatchObject({ location: 'Colombo' });
      const wrongCount = await send('SM-phase8-ordered-dining-wrong-count', 'Colombo');
      expect(wrongCount.reply).toContain('how many guests?');
      expect(await state('SM-phase8-ordered-dining-wrong-count', 'Colombo')).toMatchObject({
        topic: 'restaurant', pendingQuestion: { expectedAnswerType: 'guests' },
      });
      expect((await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .not.toHaveProperty('guests');
      const guests = await send('SM-phase8-ordered-dining-valid-count', '2');
      expect(guests.reply).not.toContain('how many guests?');
      expect((await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .toMatchObject({ location: 'Colombo', guests: 2 });
      expect(await state('SM-phase8-ordered-dining-valid-count', '2')).toMatchObject({
        topic: 'restaurant', pendingQuestion: null,
      });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it.each([true, false])('ignores unrequested model fields while answering the area: metadata=%s', async (metadata) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    const question = 'Which dining area and how many guests?';
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => {
        if (context.message.text === 'Restaurants') return {
          role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: 0.95,
          suggestedAction: 'none', responseText: question,
          ...(metadata ? { followUpQuestion: { text: question, expectedAnswerType: 'location' } } : {}),
        };
        if (context.message.text === 'Actually, Galle') return {
          role: 'change_existing_criteria', intent: 'restaurant_search', confidence: 0.95,
          entities: { location: 'Galle', guests: 9 }, suggestedAction: 'none',
          responseText: 'I have updated the area to Galle. How many guests?',
          ...(metadata ? { followUpQuestion: { text: 'How many guests?', expectedAnswerType: 'guests' } } : {}),
        };
        return { role: 'answer_to_current_question', intent: 'restaurant_search', confidence: 0.95,
          entities: context.message.text === 'Colombo'
            ? { location: 'Galle', guests: 7, diningDate: '2026-12-01', additionalPreferences: 'rooftop' }
            : { guests: 8, diningDate: '2026-12-01' },
          suggestedAction: 'none', responseText: context.message.text === 'Colombo'
            ? 'Galle sounds lovely. Shall I show you options?' : 'Got it.',
        };
      } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      await send('SM-phase8-unrequested-start', 'Restaurants');
      const area = await send('SM-phase8-unrequested-area', 'Colombo');
      expect(area.reply).toContain('how many guests?');
      expect(area.reply).not.toContain('Galle');
      expect((await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .toMatchObject({ location: 'Colombo' });
      const afterArea = (await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria;
      expect(afterArea).not.toHaveProperty('guests');
      expect(afterArea).not.toHaveProperty('diningDate');
      expect(afterArea).not.toHaveProperty('additionalPreferences');
      expect(await continuation.load(inbound('SM-phase8-unrequested-area', 'Colombo'))).toMatchObject({
        topic: 'restaurant', pendingQuestion: { expectedAnswerType: 'guests' },
      });
      expect(await cache.getJson(cacheKey)).toMatchObject({ topic: 'restaurant',
        pendingQuestion: { expectedAnswerType: 'guests' } });
      const correction = await send('SM-phase8-explicit-correction', 'Actually, Galle');
      expect(correction.reply).toContain('Galle');
      expect((await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .toMatchObject({ location: 'Galle' });
      expect((await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .not.toHaveProperty('guests');
      expect(await continuation.load(inbound('SM-phase8-explicit-correction', 'Actually, Galle'))).toMatchObject({
        topic: 'restaurant', pendingQuestion: { expectedAnswerType: 'guests' },
      });
      const count = await send('SM-phase8-unrequested-count', '2');
      expect(count.reply).not.toContain('how many guests?');
      const afterCount = (await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria;
      expect(afterCount).toMatchObject({ location: 'Galle', guests: 2 });
      expect(afterCount).not.toHaveProperty('diningDate');
      expect(await continuation.load(inbound('SM-phase8-unrequested-count', '2'))).toMatchObject({
        topic: 'restaurant', pendingQuestion: null,
      });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it.each([true, false])('accepts an explicit area correction while that question is pending: metadata=%s', async (metadata) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    const question = 'Which dining area and how many guests?';
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === 'Restaurants'
          ? { role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: 0.95,
              suggestedAction: 'none', responseText: question,
              ...(metadata ? { followUpQuestion: { text: question, expectedAnswerType: 'location' } } : {}) }
          : { role: 'answer_to_current_question', intent: 'restaurant_search', confidence: 0.95,
              entities: { location: 'Colombo', guests: 7 }, suggestedAction: 'none',
              responseText: 'Colombo sounds good.' } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      await send('SM-phase8-correct-pending-start', 'Restaurants');
      const answer = await send('SM-phase8-correct-pending-area', 'Actually, Galle');
      expect(answer.reply).toContain('how many guests?');
      expect(answer.reply).not.toContain('Colombo');
      const criteria = (await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria;
      expect(criteria).toMatchObject({ location: 'Galle' });
      expect(criteria).not.toHaveProperty('guests');
      expect(await continuation.load(inbound('SM-phase8-correct-pending-area', 'Actually, Galle')))
        .toMatchObject({ topic: 'restaurant', pendingQuestion: { expectedAnswerType: 'guests' } });
      expect(await cache.getJson(cacheKey)).toMatchObject({ topic: 'restaurant',
        pendingQuestion: { expectedAnswerType: 'guests' } });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it.each([
    { intent: 'restaurant_search', role: 'change_existing_criteria' },
    { intent: 'hotel_search', role: 'new_intent' },
  ] as const)('keeps an active draft answer authoritative despite model $role / $intent', async ({ intent, role }) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === 'Restaurants'
          ? { role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: 0.95,
              suggestedAction: 'none', responseText: 'Which dining area and how many guests?' }
          : { role, intent, confidence: 0.95,
              entities: { location: 'Galle', guests: 7 }, suggestedAction: 'none',
              responseText: 'Galle sounds good.' } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      await send('SM-phase8-active-pending-start', 'Restaurants');
      await new RestaurantSearchSessionService(cache).saveAwaitingPreferences(traveller, {});
      const answer = await send('SM-phase8-active-pending-area', 'Colombo');
      expect(answer.reply).toContain('how many guests?');
      expect(answer.reply).not.toContain('Galle');
      const criteria = (await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria;
      expect(criteria).toMatchObject({ location: 'Colombo' });
      expect(criteria).not.toHaveProperty('guests');
      expect(await continuation.load(inbound('SM-phase8-active-pending-area', 'Colombo')))
        .toMatchObject({ topic: 'restaurant', pendingQuestion: { expectedAnswerType: 'guests' } });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('accepts area and guest count together only when both appear in the traveller message', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === 'Restaurants'
          ? { role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: 0.95,
              suggestedAction: 'none', responseText: 'Which dining area and how many guests?' }
          : { role: 'answer_to_current_question', intent: 'restaurant_search', confidence: 0.95,
              entities: { location: 'Colombo', guests: 2, diningDate: '2026-12-01' },
              suggestedAction: 'none', responseText: 'Got it.' } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      await send('SM-phase8-multifield-start', 'Restaurants');
      const answer = await send('SM-phase8-multifield-answer', 'Colombo for 2 guests');
      expect(answer.reply).not.toContain('how many guests?');
      const criteria = (await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria;
      expect(criteria).toMatchObject({ location: 'Colombo', guests: 2 });
      expect(criteria).not.toHaveProperty('diningDate');
      expect((await continuation.load(inbound('SM-phase8-multifield-answer', 'Colombo for 2 guests')))
        ?.pendingQuestion?.expectedAnswerType).not.toBe('guests');
      expect(await cache.getJson(cacheKey)).toMatchObject({ topic: 'restaurant' });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('rejects a night count as a hotel area, then accepts it after the area is saved', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === 'Hotels'
          ? { role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
              suggestedAction: 'none', responseText: 'Which hotel area and how many nights?' }
          : { role: 'answer_to_current_question', intent: 'hotel_search',
              entities: context.message.text === 'Galle' ? { location: 'Galle' } : { durationNights: 2 },
              confidence: 0.95, suggestedAction: 'none', responseText: 'Got it.' } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      await send('SM-phase8-ordered-hotel-start', 'Hotels');
      const invalid = await send('SM-phase8-ordered-hotel-invalid', '2 nights');
      expect(invalid.reply).toContain('Which hotel area?');
      expect(await continuation.load(inbound('SM-phase8-ordered-hotel-invalid', '2 nights'))).toMatchObject({
        topic: 'hotel', pendingQuestion: { expectedAnswerType: 'location',
          remaining: [{ expectedAnswerType: 'nights' }] },
      });
      expect(await cache.getJson(cacheKey)).toMatchObject({ topic: 'hotel',
        pendingQuestion: { expectedAnswerType: 'location' } });
      expect(await new HotelSearchSessionService(cache).getAuthoritative(traveller)).toBeNull();
      await cache.deleteKey(cacheKey);
      const area = await send('SM-phase8-ordered-hotel-area', 'Galle');
      expect(area.reply).toContain('how many nights?');
      expect((await new HotelSearchSessionService(cache).getAuthoritative(traveller))?.criteria.location)
        .toBe('Galle');
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria.location)
        .toBe('Galle');
      expect(await continuation.load(inbound('SM-phase8-ordered-hotel-area', 'Galle'))).toMatchObject({
        topic: 'hotel', pendingQuestion: { expectedAnswerType: 'nights' },
      });
      const duration = await send('SM-phase8-ordered-hotel-duration', '2');
      expect(duration.reply).not.toContain('how many nights?');
      expect((await new HotelSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .toMatchObject({ location: 'Galle', durationNights: 2 });
      expect(await continuation.load(inbound('SM-phase8-ordered-hotel-duration', '2'))).toMatchObject({
        topic: 'hotel', pendingQuestion: null,
      });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('still accepts an explicit service switch while a field answer is pending', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === 'Restaurants'
          ? { role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: 0.95,
              suggestedAction: 'none', responseText: 'Which dining area?' }
          : { role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
              taskTransition: 'switch', suggestedAction: 'none',
              responseText: 'Which area would you prefer for your hotel?' } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      await send('SM-phase8-pending-switch-start', 'Restaurants');
      const switched = await send('SM-phase8-pending-switch-hotel', 'Hotels');
      expect(switched.reply).toContain('Which area would you prefer for your hotel?');
      expect(await continuation.load(inbound('SM-phase8-pending-switch-hotel', 'Hotels'))).toMatchObject({
        topic: 'hotel', pendingQuestion: { expectedAnswerType: 'location' },
      });
      expect(await cache.getJson(cacheKey)).toMatchObject({ topic: 'hotel',
        pendingQuestion: { expectedAnswerType: 'location' } });
      expect(await new RestaurantSearchSessionService(cache).getAuthoritative(traveller)).toBeNull();
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it.each([
    { includeMetadata: true, coordinated: false }, { includeMetadata: false, coordinated: false },
    { includeMetadata: true, coordinated: true }, { includeMetadata: false, coordinated: true },
  ])('persists dining area and guests separately: $includeMetadata $coordinated', async ({ includeMetadata, coordinated }) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    const areaQuestion = coordinated ? 'Which dining area' : 'Which area would you prefer for dining?';
    const guestQuestion = coordinated ? 'how many guests?' : 'How many guests will join you for dining?';
    const fullQuestion = coordinated ? `${areaQuestion} and ${guestQuestion}` : `${areaQuestion} ${guestQuestion}`;
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => {
        if (context.message.text === 'Restaurants') return {
          role: 'new_intent', intent: 'restaurant_search', entities: {}, confidence: 0.95,
          suggestedAction: 'none', responseText: fullQuestion,
          ...(includeMetadata ? { followUpQuestion: { text: fullQuestion, expectedAnswerType: 'location' } } : {}),
        };
        if (context.message.text === 'Colombo') return {
          role: 'answer_to_current_question', intent: 'restaurant_search', entities: { location: 'Colombo' },
          confidence: 0.95, suggestedAction: 'none', responseText: 'Got it, Colombo.',
        };
        return { role: 'answer_to_current_question', intent: 'restaurant_search', entities: { guests: 2 },
          confidence: 0.95, suggestedAction: 'none', responseText: 'Two guests, noted.' };
      } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      const first = await send('SM-phase8-dining-two-questions', 'Restaurants');
      expect(first.reply).toContain(areaQuestion);
      expect(first.reply).toContain(guestQuestion);
      expect(await continuation.load(inbound('SM-phase8-dining-two-questions', 'Restaurants'))).toMatchObject({
        topic: 'restaurant', pendingQuestion: { text: areaQuestion, expectedAnswerType: 'location',
          remaining: [{ text: guestQuestion, expectedAnswerType: 'guests' }] },
      });
      await cache.deleteKey(cacheKey);
      const area = await send('SM-phase8-dining-area', 'Colombo');
      expect(area.reply).toContain(guestQuestion);
      expect((await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .toMatchObject({ location: 'Colombo' });
      expect(await continuation.load(inbound('SM-phase8-dining-area', 'Colombo'))).toMatchObject({
        topic: 'restaurant', pendingQuestion: { text: guestQuestion, expectedAnswerType: 'guests' },
      });
      await cache.deleteKey(cacheKey);
      await cache.deleteKey(`restaurant-search:${traveller}`);
      const guests = await send('SM-phase8-dining-guests', '2');
      expect(guests.reply).not.toContain('Which area');
      expect((await new RestaurantSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .toMatchObject({ location: 'Colombo', guests: 2 });
      expect(await continuation.load(inbound('SM-phase8-dining-guests', '2'))).toMatchObject({
        topic: 'restaurant', pendingQuestion: null,
      });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('reconciles a short night count into the same durable hotel draft', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    const question = 'How many nights would you like for your stay?';
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === 'Hotels'
          ? { role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
              suggestedAction: 'none', responseText: question,
              followUpQuestion: { text: question, expectedAnswerType: 'nights' } }
          : { role: 'answer_to_current_question', intent: 'hotel_search', entities: {}, confidence: 0.95,
              suggestedAction: 'none', responseText: 'Two nights, noted.' } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      const first = await send('SM-phase8-hotel-nights-question', 'Hotels');
      expect(first.reply).toContain(question);
      expect(await continuation.load(inbound('SM-phase8-hotel-nights-question', 'Hotels'))).toMatchObject({
        topic: 'hotel', pendingQuestion: { text: question, expectedAnswerType: 'nights' },
      });
      const answer = await send('SM-phase8-hotel-nights-answer', '2');
      expect(answer.reply).toContain('2');
      expect((await new HotelSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .toMatchObject({ durationNights: 2 });
      const state = await continuation.load(inbound('SM-phase8-hotel-nights-answer', '2'));
      expect(state).toMatchObject({ topic: 'hotel', pendingQuestion: null });
      await cache.deleteKey(`hotel-search:${traveller}`);
      expect((await new HotelSearchSessionService(cache).getAuthoritative(traveller))?.criteria.durationNights).toBe(2);
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('keeps a coordinated hotel-area and night-count question through separate answers and Redis loss', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === 'Hotels'
          ? { role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
              suggestedAction: 'none', responseText: 'Which hotel area and how many nights?' }
          : context.message.text === 'Galle'
            ? { role: 'answer_to_current_question', intent: 'hotel_search', entities: { location: 'Galle' },
                confidence: 0.95, suggestedAction: 'none', responseText: 'Got it, Galle.' }
            : { role: 'answer_to_current_question', intent: 'hotel_search', entities: {},
                confidence: 0.95, suggestedAction: 'none', responseText: 'Two nights, noted.' } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      expect((await send('SM-phase8-combined-hotel-question', 'Hotels')).reply)
        .toContain('Which hotel area and how many nights?');
      expect(await continuation.load(inbound('SM-phase8-combined-hotel-question', 'Hotels'))).toMatchObject({
        topic: 'hotel', pendingQuestion: { text: 'Which hotel area', expectedAnswerType: 'location',
          remaining: [{ text: 'how many nights?', expectedAnswerType: 'nights' }] },
      });
      expect((await send('SM-phase8-combined-hotel-area', 'Galle')).reply).toContain('how many nights?');
      expect(await continuation.load(inbound('SM-phase8-combined-hotel-area', 'Galle'))).toMatchObject({
        topic: 'hotel', pendingQuestion: { text: 'how many nights?', expectedAnswerType: 'nights' },
      });
      await cache.deleteKey(cacheKey);
      await cache.deleteKey(`hotel-search:${traveller}`);
      await send('SM-phase8-combined-hotel-nights', '2');
      expect((await new HotelSearchSessionService(cache).getAuthoritative(traveller))?.criteria)
        .toMatchObject({ location: 'Galle', durationNights: 2 });
      expect(await continuation.load(inbound('SM-phase8-combined-hotel-nights', '2'))).toMatchObject({
        topic: 'hotel', pendingQuestion: null,
      });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it.each([true, false])('keeps validated hotel draft fields authoritative: metadata=%s', async (metadata) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const hotel = new HotelSearchSessionService(cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    const question = 'Which hotel area and how many guests and how many nights?';
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) => {
        const text = context.message.text;
        if (text === 'Hotels') return { role: 'new_intent', intent: 'hotel_search', entities: {},
          confidence: 0.95, suggestedAction: 'none', responseText: question,
          ...(metadata ? { followUpQuestion: { text: question, expectedAnswerType: 'location' } } : {}) };
        if (text === 'Actually, make it 8 guests') return {
          role: 'change_existing_criteria', intent: 'hotel_search', entities: { guests: 8, durationNights: 9 },
          confidence: 0.95, suggestedAction: 'none', responseText: 'I have changed the guest count to 8.',
        };
        return { role: 'answer_to_current_question', intent: 'hotel_search', confidence: 0.95,
          entities: text === 'Colombo' ? { location: 'Galle', guests: 7 }
            : text === '2' && context.pendingQuestion?.expectedAnswerType === 'guests'
              ? { guests: 8, durationNights: 9 } : { durationNights: 8, guests: 9 },
          suggestedAction: 'none', responseText: 'Got it.',
          ...(metadata ? { followUpQuestion: { text: 'Got it.', expectedAnswerType: 'preference' } } : {}),
        };
      } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    const redisHotel = () => cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`);
    try {
      await send('SM-phase8-hotel-authority-start', 'Hotels');
      const area = await send('SM-phase8-hotel-authority-area', 'Colombo');
      expect(area.reply).not.toContain('Galle');
      expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Colombo' });
      expect((await redisHotel())?.criteria).toMatchObject({ location: 'Colombo' });
      expect((await hotel.getAuthoritative(traveller))?.criteria).not.toHaveProperty('guests');
      expect(await continuation.load(inbound('SM-phase8-hotel-authority-area', 'Colombo')))
        .toMatchObject({ topic: 'hotel', pendingQuestion: { expectedAnswerType: 'guests' } });

      const count = await send('SM-phase8-hotel-authority-guests', '2');
      expect(count.reply).not.toContain('8 guests');
      expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Colombo', guests: 2 });
      expect((await redisHotel())?.criteria).toMatchObject({ location: 'Colombo', guests: 2 });
      expect((await hotel.getAuthoritative(traveller))?.criteria).not.toHaveProperty('durationNights');
      expect(await continuation.load(inbound('SM-phase8-hotel-authority-guests', '2')))
        .toMatchObject({ topic: 'hotel', pendingQuestion: { expectedAnswerType: 'nights' } });

      await send('SM-phase8-hotel-authority-correction', 'Actually, make it 8 guests');
      expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Colombo', guests: 8 });
      expect((await redisHotel())?.criteria).toMatchObject({ location: 'Colombo', guests: 8 });
      expect((await hotel.getAuthoritative(traveller))?.criteria).not.toHaveProperty('durationNights');
      expect(await continuation.load(inbound('SM-phase8-hotel-authority-correction', 'Actually, make it 8 guests')))
        .toMatchObject({ topic: 'hotel', pendingQuestion: { expectedAnswerType: 'nights' } });

      await send('SM-phase8-hotel-authority-nights', '2');
      expect((await hotel.getAuthoritative(traveller))?.criteria)
        .toMatchObject({ location: 'Colombo', guests: 8, durationNights: 2 });
      expect((await redisHotel())?.criteria).toMatchObject({ location: 'Colombo', guests: 8, durationNights: 2 });
      expect(await continuation.load(inbound('SM-phase8-hotel-authority-nights', '2')))
        .toMatchObject({ topic: 'hotel', pendingQuestion: null });
      await cache.deleteKey(`hotel-search:${traveller}`);
      expect((await hotel.get(traveller))?.criteria).toMatchObject({ location: 'Colombo', guests: 8, durationNights: 2 });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('persists both explicitly supplied hotel fields despite conflicting model proposals', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const hotel = new HotelSearchSessionService(cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => ({ ...profile }) } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === 'Hotels'
          ? { role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
              suggestedAction: 'none', responseText: 'Which hotel area and how many guests?' }
          : { role: 'answer_to_current_question', intent: 'hotel_search', confidence: 0.95,
              entities: { location: 'Galle', guests: 8, durationNights: 9 },
              suggestedAction: 'none', responseText: 'Got it.' } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    try {
      await send('SM-phase8-hotel-multi-start', 'Hotels');
      await send('SM-phase8-hotel-multi-answer', 'Colombo for 2 guests');
      expect((await hotel.getAuthoritative(traveller))?.criteria).toMatchObject({ location: 'Colombo', guests: 2 });
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`hotel-search:${traveller}`))?.criteria)
        .toMatchObject({ location: 'Colombo', guests: 2 });
      expect((await hotel.getAuthoritative(traveller))?.criteria).not.toHaveProperty('durationNights');
      const continued = await continuation.load(inbound('SM-phase8-hotel-multi-answer', 'Colombo for 2 guests'));
      expect(continued?.topic).toBe('hotel');
      expect(continued?.pendingQuestion?.expectedAnswerType).not.toBe('guests');
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it.each([
    { label: 'restaurant', cue: 'Restaurants', intent: 'restaurant_search',
      question: 'How many guests for dining?', field: 'guests', cachePrefix: 'restaurant-search' },
    { label: 'excursion', cue: 'Activities', intent: 'excursion_search',
      question: 'How many guests for excursions?', field: 'guests', cachePrefix: 'excursion-search' },
    { label: 'logistics', cue: 'Transport', intent: 'logistics_request',
      question: 'How many passengers for transport?', field: 'passengers', cachePrefix: 'logistics-search' },
  ] as const)('uses the same validated draft patch for $label', async ({ cue, intent, question, field, cachePrefix }) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async (_prompt, context) =>
        context.message.text === cue
          ? { role: 'new_intent', intent, entities: {}, confidence: 0.95,
              suggestedAction: 'none', responseText: question }
          : { role: 'answer_to_current_question', intent, confidence: 0.95,
              entities: { [field]: 8 }, suggestedAction: 'none', responseText: 'Eight noted.' } } }),
    }));
    const send = (id: string, body: string) => processNormalizedInboundMessage(normalizeInboundMessage({
      MessageSid: id, From: traveller, To: 'whatsapp:+15550000000', Body: body,
    }), `corr-${id}`);
    const service = intent === 'restaurant_search' ? new RestaurantSearchSessionService(cache)
      : intent === 'excursion_search' ? new ExcursionSearchSessionService(cache)
      : new LogisticsSearchSessionService(cache);
    try {
      await send(`SM-phase8-${intent}-start`, cue);
      await service.saveAwaitingPreferences(traveller, {});
      const answer = await send(`SM-phase8-${intent}-answer`, '2');
      expect(answer.reply).not.toContain('Eight');
      expect((await service.getAuthoritative(traveller))?.criteria).toMatchObject({ [field]: 2 });
      expect((await cache.getJson<{ criteria: Record<string, unknown> }>(`${cachePrefix}:${traveller}`))?.criteria)
        .toMatchObject({ [field]: 2 });
      expect(await continuation.load(inbound(`SM-phase8-${intent}-answer`, '2')))
        .toMatchObject({ pendingQuestion: null });
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it('clarifies an unrecognized coordinated detail without accepting a guessed field', async () => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const hotel = new HotelSearchSessionService(cache);
    await hotel.saveAwaitingPreferences(traveller, {});
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async () => ({
        role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
        suggestedAction: 'none', responseText: 'Which hotel area and what else would matter?',
        followUpQuestion: { text: 'Which hotel area?', expectedAnswerType: 'location' },
      }) } }),
    }));
    try {
      const reply = await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: 'SM-phase8-ambiguous-coordination', From: traveller,
        To: 'whatsapp:+15550000000', Body: 'Hotels',
      }), 'corr-phase8-ambiguous-coordination');
      expect(reply.reply).toBe('Could you clarify which detail you would like to provide first?');
      expect((await hotel.getAuthoritative(traveller))?.criteria.location).toBeUndefined();
      expect(await continuation.load(inbound('SM-phase8-ambiguous-coordination', 'Hotels'))).toMatchObject({
        topic: 'hotel', pendingQuestion: { text: reply.reply },
      });
      expect((await continuation.load(inbound('SM-phase8-ambiguous-coordination', 'Hotels')))
        ?.pendingQuestion?.expectedAnswerType).toBeUndefined();
    } finally { initConversationControlPlane(); initProfileGate(); initProfileService(); }
  });

  it.each([true, false])('keeps a saved conversational topic coherent without an active workflow: accepted=%s', async (accepted) => {
    const continuation = new ConversationContinuationService(new PostgresConversationContinuationRepository(), cache);
    const intro = inbound('SM-phase8-topic-only-intro', 'Activities');
    await events.saveAccepted(intro, intro.payload, intro.metadata);
    const areaQuestion = 'Which area would you like to explore?';
    await continuation.record(intro, plan('excursion_search', areaQuestion), {
      reply: areaQuestion, activeSession: null, pausedSessions: [],
    });
    const profile = { userId: traveller, form: { preferredName: 'Test Traveller' },
      createdAt: new Date(), updatedAt: new Date() } as unknown as Awaited<ReturnType<ProfileService['getProfile']>>;
    initProfileService({ getProfile: async () => profile } as ProfileService);
    initProfileGate({ check: async () => ({ complete: true }) } as ProfileGate);
    initConversationControlPlane(new ConversationControlPlane({ continuation,
      interpretingOrchestrator: new Orchestrator({ llmInterpreter: { interpret: async () => ({
        role: 'new_intent', intent: 'hotel_search', entities: {}, confidence: 0.95,
        ...(accepted ? { taskTransition: 'switch' as const } : {}), suggestedAction: 'none',
        responseText: 'Which area would you prefer for your hotel?',
      }) } }),
    }));
    try {
      const message = accepted ? 'Hotels' : 'Are there hotels near the activity?';
      const reply = await processNormalizedInboundMessage(normalizeInboundMessage({
        MessageSid: 'SM-phase8-topic-only-switch', From: traveller,
        To: 'whatsapp:+15550000000', Body: message,
      }), 'corr-phase8-topic-only-switch');
      const state = await continuation.load(inbound('SM-phase8-topic-only-switch', message));
      if (accepted) {
        expect(reply.reply).toContain('Which area would you prefer for your hotel?');
        expect(state).toMatchObject({ topic: 'hotel', pendingQuestion: {
          text: 'Which area would you prefer for your hotel?', expectedAnswerType: 'location',
        } });
      } else {
        expect(reply.reply).toContain('Would you like to continue your current request or switch to the new one?');
        expect(state).toMatchObject({ topic: 'excursion', pendingQuestion: { expectedAnswerType: 'service' } });
      }
      expect(await new HotelSearchSessionService(cache).getAuthoritative(traveller)).toBeNull();
    } finally {
      initConversationControlPlane();
      initProfileGate();
      initProfileService();
    }
  });
});
