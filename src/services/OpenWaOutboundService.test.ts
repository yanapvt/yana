import { describe, expect, it, vi } from 'vitest';
import { OpenWaOutboundService } from './OpenWaOutboundService.js';

describe('OpenWaOutboundService', () => {
  const config = { baseUrl: 'http://openwa.local', apiKey: 'test-key', sessionId: 'test-session' };
  it('sends through the configured session without exposing credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const service = new OpenWaOutboundService(config, fetcher, console, async () => undefined);
    expect(await service.sendWhatsAppText('whatsapp:+15550000000', 'hello')).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('http://openwa.local/api/sessions/test-session/messages/send-text', expect.objectContaining({ method: 'POST' }));
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('openwa:unknown');
  });
  it('does not retry an ambiguous send failure and logs only a safe category', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('credential-and-phone-data'));
    const logger = { warn: vi.fn(), error: vi.fn() };
    const service = new OpenWaOutboundService(config, fetcher, logger);
    expect(await service.sendWhatsAppText('whatsapp:+15550000000', 'hello')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('credential-and-phone-data');
  });
  it('fails safely when configuration is incomplete', async () => {
    const fetcher = vi.fn(); const service = new OpenWaOutboundService({}, fetcher);
    expect(await service.sendWhatsAppText('whatsapp:+15550000000', 'hello')).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends result cards as captioned images instead of detached text and blank images', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const service = new OpenWaOutboundService(config, fetcher, console, async () => undefined);

    expect(await service.sendWhatsAppMessages('whatsapp:+15550000000', [
      {
        body: '🏨 *1. Test Hotel*\n✅ Request this stay: reply *book 1*\nℹ️ More info: reply *details 1*',
        mediaUrl: 'https://images.example/hotel.jpg',
      },
    ])).toBe(true);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith(
      'http://openwa.local/api/sessions/test-session/messages/send-image',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chatId: '15550000000@c.us',
          url: 'https://images.example/hotel.jpg',
          caption: '🏨 *1. Test Hotel*',
        }),
      })
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      'http://openwa.local/api/sessions/test-session/messages/send-text'
    );
    expect(String((fetcher.mock.calls[1]?.[1] as RequestInit)?.body)).toContain('book 1');
  });

  it('falls back to the complete text card when an image send is rejected', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 422 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const service = new OpenWaOutboundService(config, fetcher, console, async () => undefined);

    expect(await service.sendWhatsAppMessages('whatsapp:+15550000000', [
      { body: 'Hotel card with book 1 and details 1', mediaUrl: 'https://images.example/hotel.jpg' },
    ])).toBe(true);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      'http://openwa.local/api/sessions/test-session/messages/send-text'
    );
  });
});
