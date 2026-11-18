import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '../types/index.js';
import { ActiveConversationStateLoader } from './ActiveConversationStateLoader.js';
import { ConversationControlPlane } from './ConversationControlPlane.js';
import { ContextBuilder } from './ContextBuilder.js';

function inbound(text: string): InboundMessage {
  return {
    messageId: 'openwa-message-1',
    from: 'whatsapp:+15550000000',
    to: 'whatsapp:+15550000001',
    timestamp: new Date('2026-10-16T00:00:00.000Z'),
    type: 'text',
    inputType: 'text',
    content: { type: 'text', body: text },
  };
}

describe('ConversationControlPlane', () => {
  it('keeps a short restaurant location answer without automatically searching', async () => {
    const stateLoader = new ActiveConversationStateLoader({
      loadHotel: vi.fn().mockResolvedValue(null),
      loadRestaurant: vi.fn().mockResolvedValue({
        flow: 'restaurant',
        state: 'awaiting_preferences',
        stage: 'awaiting_preferences',
        schema: 'search_restaurants',
        fields: {},
        requiredFields: ['location'],
        updatedAt: '2026-10-16T00:00:01.000Z',
      }),
      loadExcursion: vi.fn().mockResolvedValue(null),
      loadLogistics: vi.fn().mockResolvedValue(null),
      loadItinerary: vi.fn().mockResolvedValue(null),
    });
    const controlPlane = new ConversationControlPlane({ stateLoader,
      contextBuilder: new ContextBuilder({ findRecentByTraveller: async () => [] }) });

    const result = await controlPlane.plan({
      inboundMessage: inbound('Kollupitiya'),
      text: 'Kollupitiya',
      correlationId: 'corr-1',
      profileComplete: true,
    });

    expect(result.context.activeSession).toMatchObject({
      flow: 'restaurant',
      activeSchema: 'search_restaurants',
      awaitedField: 'location',
      missingFields: ['location'],
    });
    expect(result.analysis).toMatchObject({
      role: 'answer_to_current_question',
      intent: 'restaurant_search',
      entities: { location: 'Kollupitiya' },
      shouldUseLLM: true,
    });
    expect(result.decision).toMatchObject({
      action: 'continue_flow',
      targetFlow: 'restaurant',
      missingFields: [],
    });
  });

  it('selects the most recently updated workflow without combining vertical state', async () => {
    const stateLoader = new ActiveConversationStateLoader({
      loadHotel: vi.fn().mockResolvedValue({
        flow: 'hotel',
        state: 'showing_results',
        stage: 'results',
        schema: 'search_hotels',
        fields: { location: 'Galle', internalRateToken: 'must-not-leak-from-other-flow' },
        requiredFields: ['location'],
        updatedAt: '2026-10-16T00:00:00.000Z',
      }),
      loadRestaurant: vi.fn().mockResolvedValue({
        flow: 'restaurant',
        state: 'awaiting_preferences',
        stage: 'awaiting_preferences',
        schema: 'search_restaurants',
        fields: {},
        requiredFields: ['location'],
        updatedAt: '2026-10-16T00:00:02.000Z',
      }),
      loadExcursion: vi.fn().mockResolvedValue(null),
      loadLogistics: vi.fn().mockResolvedValue(null),
      loadItinerary: vi.fn().mockResolvedValue(null),
    });

    const state = await stateLoader.load('whatsapp:+15550000000');

    expect(state?.flow).toBe('restaurant');
    expect(state?.collectedFields).toEqual({});
    expect(state?.collectedFields).not.toHaveProperty('internalRateToken');
  });

  it('exposes older workflows as bounded paused context without leaking unknown fields', async () => {
    const stateLoader = new ActiveConversationStateLoader({
      loadHotel: vi.fn().mockResolvedValue({
        flow: 'hotel', state: 'showing_results', stage: 'results', schema: 'search_hotels',
        fields: { location: 'Galle', internalRateToken: 'secret' }, requiredFields: ['location'],
        updatedAt: '2026-10-16T00:00:00.000Z',
      }),
      loadRestaurant: vi.fn().mockResolvedValue({
        flow: 'restaurant', state: 'awaiting_preferences', stage: 'awaiting_preferences', schema: 'search_restaurants',
        fields: { location: 'Mirissa' }, requiredFields: ['location'], updatedAt: '2026-10-16T00:00:02.000Z',
      }),
      loadExcursion: vi.fn().mockResolvedValue(null), loadLogistics: vi.fn().mockResolvedValue(null),
      loadItinerary: vi.fn().mockResolvedValue(null),
    });

    const result = await stateLoader.loadWithPaused('whatsapp:+15550000000');

    expect(result.activeSession?.flow).toBe('restaurant');
    expect(result.pausedSessions).toHaveLength(1);
    expect(result.pausedSessions[0]).toMatchObject({ flow: 'hotel', collectedFields: { location: 'Galle' } });
    expect(result.pausedSessions[0].collectedFields).not.toHaveProperty('internalRateToken');
  });

  it('does not let a recently paused workflow take control from an older active workflow', async () => {
    const stateLoader = new ActiveConversationStateLoader({
      loadHotel: vi.fn().mockResolvedValue({
        id: 'hotel-session', revision: 9, lifecycleStatus: 'paused', flow: 'hotel',
        state: 'showing_results', stage: 'results', schema: 'search_hotels',
        fields: { location: 'Galle' }, requiredFields: ['location'],
        updatedAt: '2026-10-27T10:00:02.000Z',
      }),
      loadRestaurant: vi.fn().mockResolvedValue({
        id: 'restaurant-session', revision: 4, lifecycleStatus: 'active', flow: 'restaurant',
        state: 'awaiting_preferences', stage: 'awaiting_preferences', schema: 'search_restaurants',
        fields: { location: 'Mirissa' }, requiredFields: ['location'],
        updatedAt: '2026-10-27T10:00:01.000Z',
      }),
      loadExcursion: vi.fn().mockResolvedValue(null), loadLogistics: vi.fn().mockResolvedValue(null),
      loadItinerary: vi.fn().mockResolvedValue(null),
    });

    const result = await stateLoader.loadWithPaused('whatsapp:+15550000000');

    expect(result.activeSession).toMatchObject({ flow: 'restaurant', lifecycleStatus: 'active' });
    expect(result.pausedSessions).toContainEqual(expect.objectContaining({
      flow: 'hotel', lifecycleStatus: 'paused', collectedFields: { location: 'Galle' },
    }));
  });

  it('keeps an abandoned paused schema out of active routing until the traveller resumes it', async () => {
    const stateLoader = new ActiveConversationStateLoader({
      loadHotel: vi.fn().mockResolvedValue({
        id: 'abandoned-hotel', revision: 2, lifecycleStatus: 'paused', flow: 'hotel',
        state: 'awaiting_preferences', stage: 'awaiting_preferences', schema: 'search_hotels',
        fields: { location: 'Galle' }, requiredFields: ['location'], updatedAt: '2026-10-27T10:00:00.000Z',
      }),
      loadRestaurant: vi.fn().mockResolvedValue(null), loadExcursion: vi.fn().mockResolvedValue(null),
      loadLogistics: vi.fn().mockResolvedValue(null), loadItinerary: vi.fn().mockResolvedValue(null),
    });

    const result = await stateLoader.loadWithPaused('whatsapp:+15550000000');

    expect(result.activeSession).toBeNull();
    expect(result.pausedSessions).toMatchObject([{ flow: 'hotel', lifecycleStatus: 'paused' }]);
  });

  it('resumes a matching paused form workflow without borrowing fields from the active workflow', async () => {
    const stateLoader = new ActiveConversationStateLoader({
      loadHotel: vi.fn().mockResolvedValue({
        id: 'hotel-session', revision: 9, lifecycleStatus: 'paused', flow: 'hotel',
        state: 'awaiting_preferences', stage: 'awaiting_preferences', schema: 'search_hotels',
        fields: { location: 'Galle', guests: 2 }, requiredFields: ['location', 'guests'],
        updatedAt: '2026-10-27T10:00:01.000Z',
      }),
      loadRestaurant: vi.fn().mockResolvedValue({
        id: 'restaurant-session', revision: 4, lifecycleStatus: 'active', flow: 'restaurant',
        state: 'awaiting_preferences', stage: 'awaiting_preferences', schema: 'search_restaurants',
        fields: { location: 'Mirissa', cuisine: ['Seafood'] }, requiredFields: ['location'],
        updatedAt: '2026-10-27T10:00:02.000Z',
      }),
      loadExcursion: vi.fn().mockResolvedValue(null), loadLogistics: vi.fn().mockResolvedValue(null),
      loadItinerary: vi.fn().mockResolvedValue(null),
    });
    const controlPlane = new ConversationControlPlane({ stateLoader,
      contextBuilder: new ContextBuilder({ findRecentByTraveller: async () => [] }) });

    const result = await controlPlane.reconcileFormSubmission(
      'whatsapp:+15550000000', 'hotel', { additionalPreferences: 'Quiet room' },
      { id: 'hotel-session', revision: 9 }
    );

    expect(result.collectedFields).toMatchObject({
      location: 'Galle', guests: 2, additionalPreferences: 'Quiet room',
    });
    expect(result.collectedFields).not.toHaveProperty('cuisine');
  });

  it('rejects a stale form workflow version', async () => {
    const stateLoader = new ActiveConversationStateLoader({
      loadHotel: vi.fn().mockResolvedValue({
        id: 'hotel-session', revision: 10, lifecycleStatus: 'paused', flow: 'hotel',
        state: 'awaiting_preferences', stage: 'awaiting_preferences', schema: 'search_hotels',
        fields: { location: 'Galle' }, requiredFields: ['location'],
        updatedAt: '2026-10-27T10:00:01.000Z',
      }),
      loadRestaurant: vi.fn().mockResolvedValue(null), loadExcursion: vi.fn().mockResolvedValue(null),
      loadLogistics: vi.fn().mockResolvedValue(null), loadItinerary: vi.fn().mockResolvedValue(null),
    });
    const controlPlane = new ConversationControlPlane({ stateLoader,
      contextBuilder: new ContextBuilder({ findRecentByTraveller: async () => [] }) });

    await expect(controlPlane.reconcileFormSubmission(
      'whatsapp:+15550000000', 'hotel', { additionalPreferences: 'Quiet room' },
      { id: 'hotel-session', revision: 9 }
    )).rejects.toMatchObject({ code: 'STALE_WORKFLOW' });
  });

  it('exposes only the latest displayed batch with stable result ids', async () => {
    const stateLoader = new ActiveConversationStateLoader({
      loadHotel: vi.fn().mockResolvedValue({
        id: 'hotel-session', revision: 4, flow: 'hotel', state: 'showing_results', stage: 'results',
        schema: 'search_hotels', fields: { location: 'Galle' }, requiredFields: ['location'],
        updatedAt: '2026-10-22T00:00:00.000Z', latestDisplayedBatchIndex: 1,
        resultBatches: [
          [{ id: 'old-1', name: 'Old One' }],
          [{ id: 'current-1', name: 'Current One' }, { id: 'current-2', name: 'Current Two' }],
        ],
      }),
      loadRestaurant: vi.fn().mockResolvedValue(null), loadExcursion: vi.fn().mockResolvedValue(null),
      loadLogistics: vi.fn().mockResolvedValue(null), loadItinerary: vi.fn().mockResolvedValue(null),
    });

    const state = await stateLoader.load('whatsapp:+15550000000');

    expect(state?.verifiedResults?.items).toEqual([
      { resultId: 'current-1', position: 1, name: 'Current One', rating: undefined },
      { resultId: 'current-2', position: 2, name: 'Current Two', rating: undefined },
    ]);
  });

  it('reconciles a form patch through CORE while preserving unrelated valid fields', async () => {
    const stateLoader = new ActiveConversationStateLoader({
      loadHotel: vi.fn().mockResolvedValue({
        id: 'hotel-session', revision: 7, flow: 'hotel', state: 'awaiting_preferences', stage: 'awaiting_preferences',
        schema: 'search_hotels',
        fields: { location: 'Galle', checkinDate: '2026-11-10', checkoutDate: '2026-11-12', guests: 2 },
        requiredFields: ['location', 'checkinDate', 'checkoutDate', 'guests'],
        updatedAt: '2026-10-22T00:00:00.000Z',
      }),
      loadRestaurant: vi.fn().mockResolvedValue(null), loadExcursion: vi.fn().mockResolvedValue(null),
      loadLogistics: vi.fn().mockResolvedValue(null), loadItinerary: vi.fn().mockResolvedValue(null),
    });
    const controlPlane = new ConversationControlPlane({ stateLoader,
      contextBuilder: new ContextBuilder({ findRecentByTraveller: async () => [] }) });

    const result = await controlPlane.reconcileFormSubmission(
      'whatsapp:+15550000000',
      'hotel',
      { additionalPreferences: 'Quiet room' }
    );

    expect(result.collectedFields).toMatchObject({
      location: 'Galle', checkinDate: '2026-11-10', checkoutDate: '2026-11-12', guests: 2,
      additionalPreferences: 'Quiet room',
    });
    expect(result.missingFields).toContain('rooms');
    expect(result.missingFields).not.toContain('location');
  });
});
