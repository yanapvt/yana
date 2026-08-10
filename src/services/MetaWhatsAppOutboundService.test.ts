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
      { type: 'quick_reply', quick_reply: { id: 'book 1', title: 'Book' } },
      { type: 'quick_reply', quick_reply: { id: 'details 1', title: 'Details' } },
    ]);
    expect(payload.interactive.action.cards[1].action.buttons).toEqual([
      { type: 'quick_reply', quick_reply: { id: 'book 2', title: 'Book' } },
      { type: 'quick_reply', quick_reply: { id: 'details 2', title: 'Details' } },
    ]);
    expect(payload.interactive.action.cards[0].body.text).not.toContain('View on Google Maps');
    expect(payload.interactive.action.cards[0].body.text).not.toContain('Book now');
    expect(payload.interactive.action.cards[0].body.text.length).toBeLessThan(160);
    expect(payload.interactive.action.cards[1].body.text.length).toBeLessThan(160);
  });
});
