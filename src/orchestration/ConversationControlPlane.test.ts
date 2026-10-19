import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '../types/index.js';
import { ActiveConversationStateLoader } from './ActiveConversationStateLoader.js';
import { ConversationControlPlane } from './ConversationControlPlane.js';

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
  it('makes the active restaurant schema authoritative for a location reply', async () => {
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
    const controlPlane = new ConversationControlPlane({ stateLoader });

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
      shouldUseLLM: false,
    });
    expect(result.decision).toMatchObject({
      action: 'execute_search',
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
});
