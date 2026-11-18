import { describe, expect, it } from 'vitest';
import { normalizeInboundMessage } from '../utils/messageNormalizer.js';
import { createInboundConversationEvent } from '../orchestration/CanonicalConversationEvent.js';
import { ContextBuilder, modelContext } from '../orchestration/ContextBuilder.js';
import type { OrchestrationResult } from '../orchestration/Orchestrator.js';
import type { ConversationContinuation, ConversationContinuationRepository } from '../storage/JourneyEventCheckpointRepository.js';
import { FixtureStateStore } from '../tests/fixtures/sessionStorage.js';
import { ConversationContinuationService } from './ConversationContinuationService.js';

const traveller = 'whatsapp:+94770000001';
function event(text: string, id: string) {
  return { ...createInboundConversationEvent(normalizeInboundMessage({ MessageSid: id,
    From: traveller, To: 'whatsapp:+14155238886', Body: text }), id),
    sessionId: 'session:continuation' };
}
function proposal(intent: string, question?: { text: string; expectedAnswerType: string }): OrchestrationResult {
  const flow = intent === 'excursion_search' ? 'excursion' : intent === 'hotel_search' ? 'hotel' : 'none';
  return { analysis: { role: 'new_intent' },
    interpretation: { role: 'new_intent', intent, entities: {}, confidence: 0.9,
    responseText: question?.text, followUpQuestion: question },
    decision: { action: 'answer_general_question', intent: intent as any,
    targetFlow: question ? flow : 'none', confidence: 0.9, entities: {}, missingFields: [], reason: 'test' },
    context: { activeSession: undefined } } as OrchestrationResult;
}
function acceptedAnswer(): OrchestrationResult {
  return { ...proposal('excursion_search'), analysis: { role: 'answer_to_current_question' },
    decision: { ...proposal('excursion_search').decision, action: 'continue_flow',
      targetFlow: 'excursion' } } as OrchestrationResult;
}
function observed(reply: string, flow?: 'hotel' | 'excursion') {
  return { reply, activeSession: flow ? { id: `${flow}-task`, flow,
    collectedFields: {}, requiredFields: [], missingFields: [] } : null, pausedSessions: [] };
}
function fixture() {
  let acceptedEventId = '';
  let state: ConversationContinuation | null = null;
  const repository: ConversationContinuationRepository = {
    find: async () => structuredClone(state),
    save: async (_user, _conversation, id, patch, reset) => {
      if (id !== acceptedEventId) return null;
      state = { ...structuredClone(patch), revision: (state?.revision ?? 0) + 1,
        generation: (state?.generation ?? 0) + Number(reset), eventId: id };
      return structuredClone(state);
    },
    updateOutbound: async (_user, _conversation, id, status) => {
      if (!state?.outboundQuestion || state.outboundQuestion.eventId !== id || state.eventId !== id) return null;
      state.pendingQuestion = status === 'failed' ? state.outboundQuestion.priorQuestion ?? null
        : state.outboundQuestion.question;
      state.outboundQuestion.status = status;
      return structuredClone(state);
    },
    updateOutboundByProviderId: async () => null,
  };
  return { repository, accept: (id: string) => { acceptedEventId = id; } };
}

describe('structured conversational continuation (Phase 8 Stage 1)', () => {
  it('preserves activities and the location question for a short answer, then resets', async () => {
    const durable = fixture();
    const cache = new FixtureStateStore();
    const service = new ConversationContinuationService(durable.repository, cache as any);
    const activities = event('activities', 'SM-activities');
    durable.accept(activities.eventId);
    await service.record(activities, proposal('excursion_search',
      { text: 'Which area would you like to explore', expectedAnswerType: 'location' }),
      observed('Which area would you like to explore'));
    await service.recordOutbound(activities, 'provider_accepted');
    cache.clear();
    const colombo = event('Colombo', 'SM-colombo');
    durable.accept(colombo.eventId);
    const recovered = await new ConversationContinuationService(durable.repository,
      new FixtureStateStore() as any).load(colombo);
    expect(recovered).toMatchObject({ topic: 'excursion',
      pendingQuestion: { text: 'Which area would you like to explore', expectedAnswerType: 'location' } });
    const context = new ContextBuilder().build({ inboundMessage: normalizeInboundMessage({
      MessageSid: 'SM-colombo', From: traveller, To: 'whatsapp:+14155238886', Body: 'Colombo' }),
      text: 'Colombo', profileComplete: true, continuation: recovered,
      conversationHistory: [{ role: 'assistant', content: 'A generic welcome without a question mark.' }] });
    expect(modelContext(context)).toMatchObject({ conversationTopic: 'excursion',
      pendingQuestion: { expectedAnswerType: 'location' } });
    await service.record(colombo, acceptedAnswer(), observed('Got it, Colombo.', 'excursion'));
    expect((await service.load(colombo))?.topic).toBe('excursion');
    expect((await service.load(colombo))?.pendingQuestion).toBeNull();
    const reset = event('reset', 'SM-reset');
    durable.accept(reset.eventId);
    await service.reset(reset);
    expect(await service.load(reset)).toMatchObject({ topic: null, pendingQuestion: null, generation: 1 });
  });

  it('keeps accommodation and the airport clarification separate from a workflow', async () => {
    const durable = fixture();
    const service = new ConversationContinuationService(durable.repository, new FixtureStateStore() as any);
    const stay = event('A place near the airport with a beach view', 'SM-stay');
    durable.accept(stay.eventId);
    await service.record(stay, proposal('hotel_search',
      { text: 'Which airport do you mean', expectedAnswerType: 'airport' }),
      observed('Which airport do you mean'));
    await service.recordOutbound(stay, 'provider_accepted');
    expect(await service.load(stay)).toMatchObject({ topic: 'hotel',
      pendingQuestion: { expectedAnswerType: 'airport' } });
    const stale = event('late result', 'SM-stale');
    await expect(service.record(stale, proposal('excursion_search'), observed('Which area?', 'excursion')))
      .rejects.toMatchObject({ status: 'failed' });
    expect((await service.load(stay))?.topic).toBe('hotel');
  });

  it('uses the persisted workflow outcome instead of a service intent for the current topic', async () => {
    const durable = fixture();
    const service = new ConversationContinuationService(durable.repository, new FixtureStateStore() as any);
    const start = event('activities', 'SM-start-activity');
    durable.accept(start.eventId);
    await service.record(start, proposal('excursion_search'), observed('Tell me about activities.', 'excursion'));
    const side = event('What hotels are nearby?', 'SM-side-hotel');
    durable.accept(side.eventId);
    await service.record(side, proposal('hotel_search'), observed('Here are some stay ideas.', 'excursion'));
    expect(await service.load(side)).toMatchObject({ topic: 'excursion' });
    const switchEvent = event('Hotels', 'SM-switch-hotel');
    durable.accept(switchEvent.eventId);
    await service.record(switchEvent, proposal('hotel_search'), observed('Let us explore stays.', 'hotel'));
    expect(await service.load(switchEvent)).toMatchObject({ topic: 'hotel' });
  });

  it('does not allow a delayed pre-reset decision to restore the old topic', async () => {
    const durable = fixture();
    const service = new ConversationContinuationService(durable.repository, new FixtureStateStore() as any);
    const before = event('activities', 'SM-before-reset');
    durable.accept(before.eventId);
    await service.record(before, proposal('excursion_search'), observed('Activities?', 'excursion'));
    const reset = event('reset', 'SM-reset-boundary');
    durable.accept(reset.eventId);
    await service.reset(reset);
    await expect(service.record(before, proposal('hotel_search'), observed('Hotels?', 'hotel')))
      .rejects.toMatchObject({ status: 'failed' });
    const after = event('Hello', 'SM-after-reset');
    durable.accept(after.eventId);
    await service.record(after, proposal('general_inquiry'), observed('Hello again.'));
    expect(await service.load(after)).toMatchObject({ topic: null, pendingQuestion: null, generation: 1 });
  });

  it('keeps the pending location after model failure so the next short answer can use it', async () => {
    const durable = fixture();
    const service = new ConversationContinuationService(durable.repository, new FixtureStateStore() as any);
    const first = event('Activities', 'SM-question');
    durable.accept(first.eventId);
    await service.record(first, proposal('excursion_search',
      { text: 'Which area?', expectedAnswerType: 'location' }), observed('Which area?'));
    await service.recordOutbound(first, 'provider_accepted');
    const failed = event('Can you help?', 'SM-model-failed');
    durable.accept(failed.eventId);
    await service.record(failed, proposal('hotel_search'), observed('I could not process that.'), true);
    expect(await service.load(failed)).toMatchObject({ topic: 'excursion', revision: 2,
      pendingQuestion: { text: 'Which area?', expectedAnswerType: 'location' } });
    const answer = event('Colombo', 'SM-answer');
    const continuation = await service.load(answer);
    const context = new ContextBuilder().build({ inboundMessage: normalizeInboundMessage({
      MessageSid: 'SM-answer', From: traveller, To: 'whatsapp:+14155238886', Body: 'Colombo' }),
      text: 'Colombo', profileComplete: true, continuation });
    expect(context.pendingQuestion?.expectedAnswerType).toBe('location');
    durable.accept(answer.eventId);
    await service.record(answer, acceptedAnswer(), observed('Got it, Colombo.', 'excursion'));
    expect((await service.load(answer))?.pendingQuestion).toBeNull();
  });

  it('rejects an unaccepted intent but records a displayed, validated question and an active transition', async () => {
    const durable = fixture();
    const service = new ConversationContinuationService(durable.repository, new FixtureStateStore() as any);
    const proposed = event('Hotels', 'SM-proposal');
    durable.accept(proposed.eventId);
    await service.record(proposed, proposal('hotel_search'), observed('Which hotel?'));
    expect((await service.load(proposed))?.topic).toBeNull();
    const rejected = event('Activities', 'SM-rejected');
    durable.accept(rejected.eventId);
    await service.record(rejected, { ...proposal('excursion_search'),
      decision: { ...proposal('excursion_search').decision, action: 'ask_clarifying_question', targetFlow: 'none' } },
    observed('Could you clarify?'));
    expect((await service.load(rejected))?.topic).toBeNull();
    const accepted = event('Activities', 'SM-accepted');
    durable.accept(accepted.eventId);
    await service.record(accepted, proposal('excursion_search',
      { text: 'Which area?', expectedAnswerType: 'location' }), observed('Which area?'));
    expect((await service.load(accepted))?.topic).toBe('excursion');
    const workflow = event('Colombo', 'SM-workflow');
    durable.accept(workflow.eventId);
    await service.record(workflow, proposal('hotel_search'), observed('Saved.', 'hotel'));
    expect((await service.load(workflow))?.topic).toBe('hotel');
  });
});
