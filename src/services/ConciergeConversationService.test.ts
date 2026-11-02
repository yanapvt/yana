import { describe, expect, it, vi } from 'vitest';
const model = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('./LLMService.js', () => ({ getLLMService: () => ({ generateUIContent: model.generate }) }));
import { ConciergeConversationService, CONCIERGE_BUBBLE_SEPARATOR, unfinishedRequestHint } from './ConciergeConversationService.js';
import { splitWhatsAppText } from './twilioOutboundService.js';
import type { StateStore } from './StateStore.js';

function service() {
  const values = new Map<string, unknown>();
  const store = {
    getJson: async (key: string) => values.get(key) ?? null,
    setJson: async (key: string, value: unknown) => { values.set(key, value); },
  } as StateStore;
  return new ConciergeConversationService(store);
}

describe('ConciergeConversationService', () => {
  it('acknowledges a clear request before the existing workflow handles it', async () => {
    const concierge = service();
    const first = await concierge.open('traveller-1', 'm1', 'Find me a hotel in Galle', 'Maya');
    expect(first.lead).toContain('Maya');
    expect(first.text).toBe('Find me a hotel in Galle');
    expect(await concierge.open('traveller-1', 'm2', 'tomorrow')).toEqual({ text: 'tomorrow' });
  });

  it('offers choices for unclear intent and carries the chosen service forward', async () => {
    const concierge = service();
    const first = await concierge.open('traveller-2', 'm1', 'Hi there');
    expect(splitWhatsAppText(first.reply!)).toHaveLength(2);
    expect(first.reply).toContain(CONCIERGE_BUBBLE_SEPARATOR);
    const second = await concierge.open('traveller-2', 'm2', 'hotel');
    expect(second.text).toMatch(/^Find a hotel/);
    expect(second.lead).toContain('help');
  });

  it('uses model-written empathy even when the service is not yet clear', async () => {
    model.generate.mockResolvedValueOnce('What a wonderful graduation, Maya. I would be happy to help you celebrate.');
    const concierge = service();
    const lead = await concierge.proposeLead('I just graduated and want to celebrate', 'Maya');
    const opening = await concierge.open('traveller-social', 'm1', 'I just graduated and want to celebrate', 'Maya', { lead });
    expect(splitWhatsAppText(opening.reply!)[0]).toContain('wonderful graduation');
    expect(splitWhatsAppText(opening.reply!)).toHaveLength(2);
  });

  it('uses the model to recognize a personal event in a continuing conversation', async () => {
    model.generate.mockResolvedValueOnce('I am sorry to hear about your mother. I can help you with the journey.');
    expect(await service().proposeLead('My mother is very ill and I need to travel', undefined, 'personal_event'))
      .toContain('sorry to hear');
    model.generate.mockResolvedValueOnce('NONE');
    expect(await service().proposeLead('Next please', undefined, 'personal_event')).toBeUndefined();
    model.generate.mockRejectedValueOnce(new Error('offline'));
    expect(await service().proposeLead('My father passed away', undefined, 'personal_event')).toContain('sorry for your loss');
  });

  it('offers condolences before routing a travel request', async () => {
    const result = await service().open('traveller-3', 'm1', 'My father passed away; I need a taxi');
    expect(result.lead).toContain('sorry for your loss');
  });

  it('uses a bounded model acknowledgment without letting it claim completion', async () => {
    const concierge = service();
    const proposed = await concierge.open('traveller-4', 'm1', 'Somewhere nice for dinner', undefined,
      { flow: 'restaurant', lead: 'That sounds lovely. I can help you find a dinner spot.' });
    expect(proposed.lead).toContain('That sounds lovely');
    const unsafe = await concierge.open('traveller-5', 'm1', 'Somewhere nice for dinner', undefined,
      { flow: 'restaurant', lead: 'Your table is booked and confirmed.' });
    expect(unsafe.lead).not.toContain('booked');
  });

  it('offers to resume an older incomplete request only on a greeting', () => {
    const session = { flow: 'hotel' as const, collectedFields: {}, requiredFields: ['location'],
      missingFields: ['location'], updatedAt: '2026-10-29T08:00:00Z' };
    expect(unfinishedRequestHint(session, 'Hi', Date.parse('2026-10-29T10:00:00Z'))).toContain('still here');
    expect(unfinishedRequestHint(session, 'Find dinner', Date.parse('2026-10-29T10:00:00Z'))).toBeNull();
  });
});
