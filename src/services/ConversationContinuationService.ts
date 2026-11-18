import { createHash } from 'node:crypto';
import type { CanonicalConversationEvent } from '../types/core.js';
import type { OrchestrationResult, OrchestrationSessionSnapshot } from '../orchestration/Orchestrator.js';
import { fieldQuestionPurpose, fieldQuestionPurposes } from '../orchestration/ConversationAnalyzer.js';
import { PersistenceError } from '../storage/Persistence.js';
import { PostgresConversationContinuationRepository,
  type ConversationContinuation, type ConversationContinuationRepository } from '../storage/JourneyEventCheckpointRepository.js';
import { getStateStore, type StateStore } from './StateStore.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';

const TTL_SECONDS = 24 * 60 * 60;
const topics: Record<string, string> = {
  hotel_search: 'hotel', restaurant_search: 'restaurant', excursion_search: 'excursion',
  logistics_request: 'logistics', itinerary_plan: 'itinerary',
};
interface ObservedOutcome {
  reply: string;
  activeSession: OrchestrationSessionSnapshot | null;
  pausedSessions: OrchestrationSessionSnapshot[];
}

/** The accepted-event checkpoint is the durable source; Redis is only a projection. */
export class ConversationContinuationService {
  constructor(
    private readonly repository: ConversationContinuationRepository = new PostgresConversationContinuationRepository(),
    private readonly store: Pick<StateStore, 'setJson'> = getStateStore()
  ) {}

  async load(event: CanonicalConversationEvent): Promise<ConversationContinuation | null> {
    try {
      const state = await this.repository.find(event.userId, event.conversationId);
      if (state) await this.cache(event, state);
      return state;
    } catch { throw new PersistenceError(); }
  }

  async record(event: CanonicalConversationEvent, result: OrchestrationResult | undefined,
    observed: ObservedOutcome, modelFailure = false): Promise<void> {
    const previous = await this.load(event);
    if (modelFailure) {
      // This event was accepted, but its conversational interpretation was not.
      // Advance the checkpoint without treating the failure reply as an answer.
      await this.write(event, { topic: previous?.topic ?? null,
        pendingQuestion: previous?.pendingQuestion ?? null,
        outboundQuestion: previous?.outboundQuestion ?? null }, false);
      return;
    }
    const action = result?.decision.action;
    const validatedTransition = action === 'switch_flow' || action === 'continue_flow' ||
      action === 'execute_search' || action === 'send_form';
    const active = observed.activeSession;
    const followUp = result?.interpretation?.followUpQuestion;
    const deliveredQuestion = Boolean(followUp && observed.reply.includes(followUp.text));
    const deliveredPurposes = deliveredQuestion
      ? fieldQuestionPurposes(observed.reply).length
        ? fieldQuestionPurposes(observed.reply)
        : /^(?:which|what|where|when|how)\b/i.test(observed.reply.trim())
          ? fieldQuestionPurposes(undefined, { text: observed.reply.trim() }) : []
      : [];
    const deliveredPurpose = deliveredPurposes.find((question) =>
      followUp!.text.includes(question.text) || question.text.includes(followUp!.text));
    const previousQueue = previous?.pendingQuestion?.remaining ?? [];
    const queuedIndex = deliveredQuestion ? previousQueue.findIndex((question) =>
      question.text === followUp?.text) : -1;
    const queuedQuestion = queuedIndex >= 0 ? previousQueue[queuedIndex] : undefined;
    const serviceChoice = action === 'ask_clarifying_question' &&
      (result?.decision.reason.startsWith('Confirm whether to switch') ||
        result?.decision.reason === 'Clarify which service owns the proposed field question.');
    const verifiedAnswerType = deliveredPurpose && !deliveredPurpose.ambiguous
      ? deliveredPurpose.expectedAnswerType : queuedQuestion?.expectedAnswerType ??
        (serviceChoice ? 'service' : undefined);
    const conversationalTopic = result && deliveredQuestion &&
      (action === 'ask_clarifying_question' || action === 'answer_general_question') &&
      result.decision.targetFlow === topics[result.decision.intent] &&
      result.interpretation?.intent === result.decision.intent &&
      result.interpretation.responseText?.includes(followUp!.text)
      ? topics[result.decision.intent] : undefined;
    let topic = previous?.topic ?? null;
    if (action === 'pause_flow') topic = null;
    else if (active) topic = active.flow;
    else if (conversationalTopic) topic = conversationalTopic;
    const purpose = deliveredPurpose ?? fieldQuestionPurpose(followUp?.text);
    const questionTopic = purpose && purpose.flow !== 'none' ? purpose.flow
      : result?.decision.action === 'continue_flow' && result.decision.targetFlow !== 'none'
        ? result.decision.targetFlow
      : result?.interpretation?.intent ? topics[result.interpretation.intent] : undefined;
    const questionBelongsToTopic = !questionTopic || questionTopic === topic ||
      (action === 'ask_clarifying_question' &&
        (result?.decision.reason.startsWith('Confirm whether to switch') ||
          result?.decision.reason === 'Clarify which service owns the proposed field question.') &&
        verifiedAnswerType === 'service');
    const answered = result?.analysis.role === 'answer_to_current_question' &&
      validatedTransition && result.decision.targetFlow === previous?.topic &&
      active?.flow === previous.topic;
    const closed = action === 'pause_flow' || (validatedTransition &&
      (topic !== previous?.topic || Boolean(answered)));
    const remaining = deliveredPurpose && deliveredPurposes.length > 1
      ? deliveredPurposes.slice(deliveredPurposes.indexOf(deliveredPurpose) + 1)
      : queuedIndex >= 0 ? previousQueue.slice(queuedIndex + 1)
        : previous?.pendingQuestion?.text === followUp?.text ? previousQueue : [];
    const pendingQuestion = followUp && deliveredQuestion && action !== 'pause_flow' &&
      questionBelongsToTopic
      ? result?.decision.reason === 'The reply does not match the pending answer type.' && previous?.pendingQuestion
        ? previous.pendingQuestion
        : { text: deliveredPurpose?.text ?? followUp.text,
          ...(verifiedAnswerType ? { expectedAnswerType: verifiedAnswerType } : {}),
          ...(remaining.length ? { remaining: remaining.map((question) => ({
            text: question.text, ...(question.expectedAnswerType
              ? { expectedAnswerType: question.expectedAnswerType } : {}),
          })) } : {}),
          ...(active?.flow === topic && active.id ? { workflowId: active.id } : {}) }
      : closed ? null : previous?.pendingQuestion ?? null;
    const outboundQuestion = event.channel.startsWith('whatsapp_') &&
      event.metadata.outboundDeliveryManaged === true && pendingQuestion &&
      (JSON.stringify(pendingQuestion) !== JSON.stringify(previous?.pendingQuestion) ||
        result?.decision.reason === 'The reply does not match the pending answer type.')
      ? { eventId: event.eventId, question: pendingQuestion, priorQuestion: previous?.pendingQuestion ?? null,
          status: 'attempted' as const } : null;
    await this.write(event, { topic,
      pendingQuestion: outboundQuestion ? closed ? null : previous?.pendingQuestion ?? null : pendingQuestion,
      outboundQuestion }, false);
  }

  async reset(event: CanonicalConversationEvent): Promise<void> {
    await this.write(event, { topic: null, pendingQuestion: null, outboundQuestion: null }, true);
  }

  /** A provider HTTP acceptance is enough to make a question answerable. A
   * later failure callback removes it; delivered is a stronger observation. */
  async recordOutbound(event: CanonicalConversationEvent,
    status: NonNullable<ConversationContinuation['outboundQuestion']>['status'],
    providerMessageId?: string): Promise<void> {
    const saved = await this.repository.updateOutbound(event.userId, event.conversationId,
      event.eventId, status, providerMessageId);
    if (saved) await this.cache(event, saved);
    await new MessageRepository().markAssistantDelivery(event.userId, event.sourceEventId,
      status === 'attempted' ? 'failed' : status, providerMessageId).catch(() => undefined);
  }

  async recordProviderStatus(providerMessageId: string, status: 'sent' | 'delivered' | 'failed'): Promise<void> {
    const updated = await this.repository.updateOutboundByProviderId(providerMessageId, status);
    await new MessageRepository().markAssistantDeliveryByProviderId(providerMessageId, status).catch(() => undefined);
    if (updated) {
      const key = `journey:conversation:${createHash('sha256').update(updated.userId).digest('hex')}`;
      await this.store.setJson(key, updated.state, TTL_SECONDS).catch(() => undefined);
    }
  }

  private async write(event: CanonicalConversationEvent,
    state: Pick<ConversationContinuation, 'topic' | 'pendingQuestion' | 'outboundQuestion'>,
    reset: boolean): Promise<void> {
    let saved: ConversationContinuation | null;
    try { saved = await this.repository.save(event.userId, event.conversationId, event.eventId, state, reset); }
    catch { throw new PersistenceError(); }
    if (!saved) throw new PersistenceError();
    await this.cache(event, saved);
  }

  private async cache(event: CanonicalConversationEvent, state: ConversationContinuation): Promise<void> {
    const key = `journey:conversation:${createHash('sha256').update(event.userId).digest('hex')}`;
    await this.store.setJson(key, state, TTL_SECONDS).catch(() => undefined);
  }
}
