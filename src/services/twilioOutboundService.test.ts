import { describe, expect, it, vi } from 'vitest';
import { TwilioOutboundService } from './twilioOutboundService.js';

describe('TwilioOutboundService', () => {
  it('does not send a late text reply after its workflow is invalidated', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = new TwilioOutboundService();
    expect(await service.sendWhatsAppReply('whatsapp:+15550000000', 'Old result', {
      shouldContinue: () => false,
    })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
