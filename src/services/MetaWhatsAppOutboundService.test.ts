import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('MetaWhatsAppOutboundService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    process.env.NODE_ENV = 'test';
    process.env.WHATSAPP_PROVIDER = 'meta';
    process.env.META_WHATSAPP_ACCESS_TOKEN = 'test-meta-token';
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = '123456789';
    process.env.META_WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
    process.env.META_WHATSAPP_API_VERSION = 'v20.0';
    process.env.TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';
  });

  it('does not send a late text reply after its workflow is invalidated', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { MetaWhatsAppOutboundService } = await import('./MetaWhatsAppOutboundService.js');
    expect(await new MetaWhatsAppOutboundService().sendWhatsAppReply('whatsapp:+94777269221', 'Old result', {
      shouldContinue: () => false,
    })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops a split reply after its workflow changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const { MetaWhatsAppOutboundService } = await import('./MetaWhatsAppOutboundService.js');
    const shouldContinue = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    expect(await new MetaWhatsAppOutboundService().sendWhatsAppReply(
      'whatsapp:+94777269221', 'A'.repeat(4000), { shouldContinue }
    )).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends image result cards as a Meta carousel with book and details quick replies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { MetaWhatsAppOutboundService } = await import('./MetaWhatsAppOutboundService.js');
    const service = new MetaWhatsAppOutboundService();

    const sent = await service.sendWhatsAppMessages('whatsapp:+94 77 726 9221', [
      {
        body: 'I found these hotel matches for Kandy.\nReply "next" or "more" for more options.',
      },
      {
        body: [
          '1. Hotel One',
          'Rating: 4.8/5 (120 reviews)',
          'Why Yana picked it: Great location near the lake with strong reviews and a useful distance signal for a short Kandy stay.',
          'Smart view: https://example.com/places/smart/one',
          'View on Google Maps: https://example.com/place/one',
          'Book now: reply book 1',
          'More info: reply details 1',
        ].join('\n'),
        mediaUrl: 'https://example.com/hotel-one.jpg',
      },
      {
        body: [
          '2. Hotel Two',
          'Rating: 4.7/5 (98 reviews)',
          'Why Yana picked it: Strong reviews and family friendly.',
          'View on Google Maps: https://example.com/place/two',
          'Book now: reply book 2',
          'More info: reply details 2',
        ].join('\n'),
        mediaUrl: 'https://example.com/hotel-two.jpg',
      },
    ]);

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/123456789/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-meta-token',
          'Content-Type': 'application/json',
        }),
      })
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.to).toBe('94777269221');
    expect(payload.type).toBe('interactive');
    expect(payload.interactive.type).toBe('carousel');
    expect(payload.interactive.action.cards).toHaveLength(2);
    expect(payload.interactive.action.cards[0].header.image.link).toBe(
      'https://example.com/hotel-one.jpg'
    );
    expect(payload.interactive.action.cards[0].action.buttons).toEqual([
      { type: 'quick_reply', quick_reply: { id: 'book 1', title: 'Book Now' } },
      { type: 'quick_reply', quick_reply: { id: 'details 1', title: 'Details' } },
    ]);
    expect(payload.interactive.action.cards[1].action.buttons).toEqual([
      { type: 'quick_reply', quick_reply: { id: 'book 2', title: 'Book Now' } },
      { type: 'quick_reply', quick_reply: { id: 'details 2', title: 'Details' } },
    ]);
    expect(payload.interactive.action.cards[0].body.text).toContain('1. Hotel One');
    expect(payload.interactive.action.cards[0].body.text).toContain('⭐ 4.8/5');
    expect(payload.interactive.action.cards[0].body.text).toContain('✨ Strong reviews + location');
    expect(payload.interactive.action.cards[0].body.text).not.toContain('View on Google Maps');
    expect(payload.interactive.action.cards[0].body.text).not.toContain('Smart view');
    expect(payload.interactive.action.cards[0].body.text).not.toContain('Book now');
    expect(payload.interactive.action.cards[0].body.text.length).toBeLessThan(160);
    expect(payload.interactive.action.cards[1].body.text.length).toBeLessThan(160);
  });

  it('renders transport cards as unconfirmed quote requests in Meta', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { MetaWhatsAppOutboundService } = await import('./MetaWhatsAppOutboundService.js');
    const service = new MetaWhatsAppOutboundService();
    const transportCard = (number: number) => ({
      body: [
        `${number}. Van transfer request`,
        'Status: request option only — not live inventory or a confirmed quote',
        'Vehicle: Van transfer',
        'Quote status: Not quoted; an operator must confirm price',
        'Suggested capacity: 7 (operator must confirm fit)',
        'Duration status: Not estimated; operator must confirm route time',
        `Request operator quote: reply book ${number}`,
        `More info: reply details ${number}`,
      ].join('\n'),
      mediaUrl: `https://example.com/transport-${number}.jpg`,
    });

    const sent = await service.sendWhatsAppMessages('whatsapp:+94777269221', [
      { body: 'These are illustrative request options, not live provider inventory.' },
      transportCard(1),
      transportCard(2),
    ]);

    expect(sent).toBe(true);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    const firstCard = payload.interactive.action.cards[0];
    expect(firstCard.action.buttons[0]).toEqual({
      type: 'quick_reply',
      quick_reply: { id: 'book 1', title: 'Request Quote' },
    });
    expect(firstCard.body.text).toContain('request option only');
    expect(firstCard.body.text).toContain('💬 Not quoted');
    expect(firstCard.body.text).not.toMatch(/rating|book now/i);
  });

  it('uses a labelled social URL button on a carousel card when Google supplied a social profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const { MetaWhatsAppOutboundService } = await import('./MetaWhatsAppOutboundService.js');

    await new MetaWhatsAppOutboundService().sendWhatsAppMessages('whatsapp:+94777269221', [
      { body: 'I found these restaurant matches.' },
      {
        body: '🍽️ *1. Social Cafe*\nℹ️ Discovery suggestion only — contact the restaurant directly.\nℹ️ More info: reply *details 1*',
        mediaUrl: 'https://images.example/cafe-one.jpg',
        socialLinks: [{ platform: 'instagram', url: 'https://www.instagram.com/socialcafe/' }],
      },
      {
        body: '🍽️ *2. Other Cafe*\nℹ️ Discovery suggestion only — contact the restaurant directly.\nℹ️ More info: reply *details 2*',
        mediaUrl: 'https://images.example/cafe-two.jpg',
        socialLinks: [{ platform: 'facebook', url: 'https://www.facebook.com/othercafe/' }],
      },
    ]);

    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(payload.interactive.action.cards[0].action.buttons).toEqual([
      { type: 'quick_reply', quick_reply: { id: 'details 1', title: 'Details' } },
      { type: 'url', url: { link: 'https://www.instagram.com/socialcafe/', title: '📷 Instagram' } },
    ]);
    expect(payload.interactive.action.cards[1].action.buttons[1]).toEqual({
      type: 'url',
      url: { link: 'https://www.facebook.com/othercafe/', title: '🔵 Facebook' },
    });
  });

  it('sends the published restaurant preference flow with bounded prefill data', async () => {
    process.env.META_WHATSAPP_RESTAURANT_FLOW_ID = 'published-flow-123';
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    const { MetaWhatsAppOutboundService } = await import('./MetaWhatsAppOutboundService.js');

    const sent = await new MetaWhatsAppOutboundService().sendRestaurantPreferenceFlow(
      'whatsapp:+94777269221',
      {
        flowToken: 'opaque-form-token',
        location: 'Moratuwa',
        dietaryRestrictions: 'Vegetarian',
      }
    );

    expect(sent).toBe(true);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.interactive.type).toBe('flow');
    expect(payload.interactive.action.parameters).toMatchObject({
      flow_id: 'published-flow-123',
      flow_token: 'opaque-form-token',
      flow_action: 'navigate',
      flow_action_payload: {
        screen: 'RESTAURANT_PREFERENCES',
        data: { location: 'Moratuwa', dietary_restrictions: 'Vegetarian' },
      },
    });
  });
});
