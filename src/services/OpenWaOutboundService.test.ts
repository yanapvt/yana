import { describe, expect, it, vi } from 'vitest';
import { OpenWaOutboundService } from './OpenWaOutboundService.js';

describe('OpenWaOutboundService', () => {
  const config = { baseUrl: 'http://openwa.local', apiKey: 'test-key', sessionId: 'test-session' };
  it('sends through the configured session without exposing credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const service = new OpenWaOutboundService(config, fetcher);
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
});
