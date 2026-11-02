import { describe, expect, it, vi } from 'vitest';
const { synthesize } = vi.hoisted(() => ({ synthesize: vi.fn() }));
vi.mock('./TextToSpeechService.js', () => ({
  getTextToSpeechService: () => ({ synthesize }),
}));
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

  it('keeps a platform-labelled social profile in the complete OpenWA text card', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const service = new OpenWaOutboundService(config, fetcher, console, async () => undefined);

    await service.sendWhatsAppMessages('whatsapp:+15550000000', [{
      body: '🍽️ *1. Social Cafe*\n📷 Instagram: https://www.instagram.com/socialcafe/',
      mediaUrl: 'https://images.example/cafe.jpg',
      socialLinks: [{ platform: 'instagram', url: 'https://www.instagram.com/socialcafe/' }],
    }]);

    const textPayload = JSON.parse(String((fetcher.mock.calls[1]?.[1] as RequestInit).body));
    expect(textPayload.text).toContain('📷 Instagram: https://www.instagram.com/socialcafe/');
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

  it('stops a sequential result batch before sending the next card when it is invalidated', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const shouldContinue = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const service = new OpenWaOutboundService(config, fetcher, console, async () => undefined);

    expect(await service.sendWhatsAppMessages('whatsapp:+15550000000', [
      { body: 'Hotel result introduction' },
      { body: 'Hotel 1' },
      { body: 'Hotel 2' },
    ], { shouldContinue })).toBe(true);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0]?.[1] as RequestInit).body)).toContain('Hotel result introduction');
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('Hotel 1');
  });

  it('sends synthesized speech as audio after a voice-note reply', async () => {
    synthesize.mockResolvedValueOnce({
      mediaUrl: 'https://yana.example/media/tts/reply.ogg',
      contentType: 'audio/ogg; codecs=opus',
      audioData: Buffer.from('ogg voice bytes'),
    });
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    const service = new OpenWaOutboundService(config, fetcher, console, async () => undefined);

    expect(await service.sendWhatsAppReply('whatsapp:+15550000000', 'Your trip is ready', { voice: true })).toBe(true);
    expect(synthesize).toHaveBeenCalledWith('Your trip is ready', { voiceNote: true });
    expect(fetcher).toHaveBeenCalledWith(
      'http://openwa.local/api/sessions/test-session/messages/send-audio',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chatId: '15550000000@c.us',
          base64: Buffer.from('ogg voice bytes').toString('base64'),
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
        }),
      })
    );
  });

  it('keeps the text reply when audio delivery is rejected without retrying it', async () => {
    synthesize.mockResolvedValueOnce({
      mediaUrl: 'https://yana.example/media/tts/reply.ogg',
      contentType: 'audio/ogg; codecs=opus',
      audioData: Buffer.from('ogg voice bytes'),
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 201 }))
      .mockResolvedValueOnce(new Response('{}', { status: 422 }));
    const logger = { warn: vi.fn(), error: vi.fn() };
    const service = new OpenWaOutboundService(config, fetcher, logger, async () => undefined);

    expect(await service.sendWhatsAppReply('whatsapp:+15550000000', 'Your trip is ready', { voice: true })).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith('openwa_audio_send_failed', {
      category: 'http', status: 422, retryAttempted: false,
    });
  });

  it('reports Google authentication failure without exposing credentials', async () => {
    synthesize.mockRejectedValueOnce(Object.assign(new Error('secret details'), { code: 16 }));
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    const logger = { warn: vi.fn(), error: vi.fn() };
    const service = new OpenWaOutboundService(config, fetcher, logger);

    expect(await service.sendWhatsAppReply('whatsapp:+15550000000', 'Hello', { voice: true })).toBe(true);
    expect(logger.error).toHaveBeenCalledWith('openwa_audio_send_failed', {
      category: 'authentication', retryAttempted: false,
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret details');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not synthesize a text-only reply', async () => {
    synthesize.mockClear();
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    const service = new OpenWaOutboundService(config, fetcher, console, async () => undefined);
    expect(await service.sendWhatsAppReply('whatsapp:+15550000000', 'Hello')).toBe(true);
    expect(synthesize).not.toHaveBeenCalled();
  });
});
