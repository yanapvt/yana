import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '../types/index.js';
import { modelContext } from './ContextBuilder.js';
import { Orchestrator, type LLMInterpretation, type OrchestrationSessionSnapshot } from './Orchestrator.js';

function inbound(text: string): InboundMessage {
  return {
    messageId: 'message-1', from: 'whatsapp:+15550000000', to: 'whatsapp:+15550000001',
    timestamp: new Date('2026-10-28T00:00:00Z'), type: 'text', inputType: 'text',
    content: { type: 'text', body: text }, metadata: { eventType: 'whatsapp.message' },
  };
}

function session(flow: 'hotel' | 'restaurant' = 'hotel'): OrchestrationSessionSnapshot {
  return {
    id: `${flow}-session`, revision: 3, lifecycleStatus: 'active', flow,
    state: 'awaiting_preferences', activeSchema: flow === 'hotel' ? 'search_hotels' : 'search_restaurants',
    collectedFields: { location: 'Galle' }, requiredFields: ['location', 'guests'], missingFields: ['guests'],
  };
}

const baseInput = (text: string, activeSession?: OrchestrationSessionSnapshot) => ({
  inboundMessage: inbound(text), text, profileComplete: true, activeSession,
  metadata: { eventType: 'whatsapp.message' },
});

function modelReply(overrides: Partial<LLMInterpretation>): LLMInterpretation {
  return {
    role: 'question_or_faq', intent: 'general_inquiry', entities: {}, confidence: 0.92,
    responseText: 'I can help with that.', proposedAction: { name: 'none', arguments: {} },
    ...overrides,
  };
}

describe('unified primary conversational reasoning', () => {
  it('acknowledges an anniversary without activating a booking or transaction', async () => {
    const interpret = vi.fn().mockResolvedValue(modelReply({
      responseText: 'That sounds lovely. I can keep the anniversary in mind as we plan.',
    }));
    const plan = await new Orchestrator({ llmInterpreter: { interpret } }).plan(baseInput('It is our anniversary trip.'));

    expect(interpret).toHaveBeenCalledTimes(1);
    expect(plan.decision.action).toBe('answer_general_question');
    expect(plan.decision.targetFlow).toBe('none');
    expect(plan.interpretation?.proposedAction?.name).toBe('none');
    expect(plan.decision.action).not.toMatch(/book|pay|transaction/i);
  });

  it('answers a general question while preserving the open form journey', async () => {
    const active = session();
    const interpret = vi.fn().mockResolvedValue(modelReply({ responseText: 'Breakfast depends on the property; I can check once we choose one.' }));
    const plan = await new Orchestrator({ llmInterpreter: { interpret } }).plan(baseInput('What does breakfast usually include?', active));

    expect(interpret).toHaveBeenCalledTimes(1);
    expect(plan.decision).toMatchObject({ action: 'answer_general_question', targetFlow: 'hotel' });
    expect(plan.context.activeSession).toEqual(active);
  });

  it('applies a clear refinement to the current journey through the validated session patch', async () => {
    const active = session('restaurant');
    const interpret = vi.fn().mockResolvedValue(modelReply({
      role: 'extra_preference', intent: 'restaurant_search', entities: { cuisine: 'Seafood' },
      taskTransition: 'continue', suggestedAction: 'execute_tool', responseText: 'I’ll add seafood to the restaurant search.',
    }));
    const plan = await new Orchestrator({ llmInterpreter: { interpret } }).plan(baseInput('Actually, make it seafood.', active));

    expect(plan.decision.targetFlow).toBe('restaurant');
    expect(plan.decision.sessionPatch?.collectedFields).toMatchObject({ location: 'Galle', cuisine: 'Seafood' });
  });

  it('asks for clarification on an ambiguous request without changing the active journey', async () => {
    const active = session();
    const interpret = vi.fn().mockResolvedValue(modelReply({
      clarificationRequired: true, question: 'Would you like to change the hotel request or start a different service?',
      suggestedAction: 'clarify', confidence: 0.8,
    }));
    const plan = await new Orchestrator({ llmInterpreter: { interpret } }).plan(baseInput('Can you change that for me?', active));

    expect(plan.decision).toMatchObject({ action: 'ask_clarifying_question', targetFlow: 'hotel' });
    expect(plan.context.activeSession).toEqual(active);
  });

  it('supplies stable IDs for previously displayed results on a natural reference', async () => {
    const active = {
      ...session('hotel'), state: 'showing_results', missingFields: [],
      verifiedResults: { source: 'google_places', retrievedAt: '2026-10-28T00:00:00Z',
        items: [{ resultId: 'place-stable-2', position: 2, name: 'Courtyard House' }] },
    } satisfies OrchestrationSessionSnapshot;
    const interpret = vi.fn().mockImplementation(async (_prompt, context) => {
      const projected = modelContext(context);
      expect(projected.eventType).toBe('whatsapp.message');
      expect(projected.messageType).toBe('text');
      expect(projected.sessionState).toMatchObject({ lifecycleStatus: 'active', state: 'showing_results' });
      expect(projected.verifiedResults?.items).toContainEqual(expect.objectContaining({ resultId: 'place-stable-2' }));
      return modelReply({ responseText: 'You mean Courtyard House in Galle.',
        uiRecommendation: { mode: 'results_list', schemaId: 'search_hotels' } });
    });
    const plan = await new Orchestrator({ llmInterpreter: { interpret } }).plan(
      baseInput('The one we saw earlier with the courtyard.', active),
    );

    expect(interpret).toHaveBeenCalledTimes(1);
    expect(plan.decision.action).toBe('answer_general_question');
    expect(plan.ui?.mode).toBe('results_list');
  });

  it('carries anniversary context and the backend-resolved second result into a dinner refinement', async () => {
    const firstText = "I'm celebrating my anniversary, my wife is an architect";
    const firstInterpret = vi.fn().mockResolvedValue(modelReply({
      memoryCandidates: [
        { key: 'occasion', value: 'anniversary', scope: 'trip', confidence: 0.97, explicit: true },
        { key: 'preference', value: 'wife is an architect', scope: 'trip', confidence: 0.91, explicit: true },
      ],
    }));
    const firstPlan = await new Orchestrator({ llmInterpreter: { interpret: firstInterpret } }).plan(baseInput(firstText));
    expect(firstPlan.memoryUpdate.memoryCandidates).toHaveLength(2);

    const confirmedFacts = firstPlan.memoryUpdate.memoryCandidates!.map((candidate, index) => ({
      ...candidate, id: `memory-${index}`, userId: 'whatsapp:+15550000000',
      status: 'confirmed' as const, sensitive: false, sourceMessageId: 'message-1',
      createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
    }));
    const active = {
      ...session('restaurant'), flow: 'excursion' as const, state: 'showing_results',
      activeSchema: 'search_excursions', collectedFields: { destination: 'Galle' },
      requiredFields: ['destination'], missingFields: [],
      verifiedResults: { source: 'google_places', retrievedAt: '2026-10-28T00:00:00.000Z', items: [
        { resultId: 'experience-1', position: 1, name: 'Galle Fort Walk' },
        { resultId: 'experience-2', position: 2, name: 'Old Town Architecture Tour' },
        { resultId: 'experience-3', position: 3, name: 'Lighthouse Visit' },
      ] },
    } satisfies OrchestrationSessionSnapshot;
    const secondText = 'show me more places like the second one, but somewhere we can have dinner too';
    const secondInterpret = vi.fn().mockImplementation(async (_prompt, context) => {
      const projected = modelContext(context);
      expect(projected.travellerContext?.confirmedFacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'occasion', value: 'anniversary' }),
        expect.objectContaining({ key: 'preference', value: 'wife is an architect' }),
      ]));
      expect(projected.verifiedResults?.items).toContainEqual(expect.objectContaining({
        resultId: 'experience-2', position: 2, name: 'Old Town Architecture Tour',
      }));
      return modelReply({
        role: 'new_intent', intent: 'restaurant_search', confidence: 0.94,
        entities: { specialOccasion: 'Anniversary', additionalPreferences: 'Architecture-inspired setting' },
        taskTransition: 'switch',
        uiRecommendation: { mode: 'results_list', schemaId: 'search_restaurants' },
      });
    });
    const plan = await new Orchestrator({ llmInterpreter: { interpret: secondInterpret } }).plan({
      ...baseInput(secondText, active), travellerMemories: confirmedFacts,
      conversationHistory: [{ role: 'user', content: firstText }, { role: 'assistant', content: 'I will keep that in mind.' }],
    });

    expect(plan.analysis.entities).toMatchObject({ selection: 2, resultId: 'experience-2', referencedResultName: 'Old Town Architecture Tour' });
    expect(plan.decision).toMatchObject({ action: 'switch_flow', targetFlow: 'restaurant' });
    expect(plan.decision.entities).toMatchObject({
      selection: 2, resultId: 'experience-2', referencedResultName: 'Old Town Architecture Tour',
      specialOccasion: 'Anniversary', additionalPreferences: 'Architecture-inspired setting',
    });
    expect(plan.context.activeSession?.verifiedResults?.items[1].resultId).toBe('experience-2');
    expect(plan.ui?.mode).toBe('chat_reply');
  });
});
