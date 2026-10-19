import { describe, expect, it, vi } from 'vitest';
import { OpenWaContactService } from './OpenWaContactService.js';

const config = { baseUrl: 'http://openwa.example', apiKey: 'test-key', sessionId: 'session-1' };

describe('OpenWaContactService', () => {
  it('reads the WhatsApp push name for one contact', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'Saved Contact', pushName: 'Jeremy McShane' }) });
    const service = new OpenWaContactService(config, fetcher);

    expect(await service.getWhatsAppDisplayName('whatsapp:+94771234567')).toBe('Jeremy McShane');
    expect(fetcher).toHaveBeenCalledWith(
      'http://openwa.example/api/sessions/session-1/contacts/94771234567%40c.us',
      expect.objectContaining({ method: 'GET', headers: { 'X-API-Key': 'test-key', Accept: 'application/json' } })
    );
  });

  it('falls back without delaying the reply when lookup fails', async () => {
    const service = new OpenWaContactService(config, vi.fn().mockRejectedValue(new Error('offline')));
    expect(await service.getWhatsAppDisplayName('whatsapp:+94771234567')).toBeNull();
    expect(await service.getWhatsAppDisplayName('whatsapp:group@g.us')).toBeNull();
  });
});
