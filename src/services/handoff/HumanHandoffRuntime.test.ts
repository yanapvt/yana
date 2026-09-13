import { describe, expect, it, vi } from 'vitest';
import type { HumanHandoffConfig } from '../../config/humanHandoff.js';
import { HumanHandoffRuntime } from './HumanHandoffRuntime.js';

const config: HumanHandoffConfig = {
  enabled: true, nativeGroupEnabled: false, fallbackQueueEnabled: true,
  slaMinutes: 30, queueName: 'travel-concierge', operatorIdentitiesJson: '[]', slaPollSeconds: 60,
  queueProcessingEnabled: false, queueWorkerId: 'test-worker', queueLeaseSeconds: 60,
  queueMaxAttempts: 5, queueBackoffSeconds: 30, queuePollSeconds: 10,
  alertQueueDepth: 100, alertOldestMinutes: 15, stagingDrillEnabled: false,
  staffPublicationEnabled: false, staffPublicationProvider: 'none', providerTimeoutMs: 10000, alertDeliveryEnabled: false, alertDeliveryProvider: 'none',
};
const selection = {
  selectedHotelId: 'public-place', selectedFromBatchIndex: 0, selectedDisplayNumber: 1,
  selectedAt: '2026-09-13T00:00:00Z',
  selectedHotelSnapshot: { id: 'public-place', name: 'Safe Stay', source: 'google_places' as const },
};

describe('HumanHandoffRuntime', () => {
  it('does not resolve identities or create cases while disabled', async () => {
    const service = { requestHandoff: vi.fn(), escalateOverdue: vi.fn() };
    const identities = { resolve: vi.fn() };
    const runtime = new HumanHandoffRuntime({ ...config, enabled: false }, service as any, identities);
    const result = await runtime.requestHotelHandoff({ whatsappUserId: 'whatsapp:+1', correlationId: 'corr', travelerConsented: true, criteria: {}, selectedHotel: selection });
    expect(result.status).toBe('disabled');
    expect(identities.resolve).not.toHaveBeenCalled();
  });

  it('uses resolved UUID identities and forwards only the minimal stay summary', async () => {
    const service = { requestHandoff: vi.fn().mockResolvedValue({ status: 'handed_off' }), escalateOverdue: vi.fn() };
    const identities = { resolve: vi.fn().mockResolvedValue({ userId: 'user-uuid', sessionId: 'session-uuid' }) };
    const runtime = new HumanHandoffRuntime(config, service as any, identities);
    await runtime.requestHotelHandoff({
      whatsappUserId: 'whatsapp:+1', correlationId: 'corr-1', travelerConsented: true,
      criteria: { checkinDate: '2026-10-01', checkoutDate: '2026-10-03', guests: 2, additionalPreferences: 'private secret' },
      selectedHotel: selection,
    });
    expect(service.requestHandoff).toHaveBeenCalledWith({
      userId: 'user-uuid', sessionId: 'session-uuid', correlationId: 'corr-1',
      travelerConsented: true, authoritativeRecheckPassed: true, travelerIntendsToProceed: true,
      summary: { service: 'hotel', selectedStayName: 'Safe Stay', dates: '2026-10-01/2026-10-03', guestCount: 2 },
    });
    expect(JSON.stringify(service.requestHandoff.mock.calls)).not.toContain('private secret');
  });

  it('fails closed when durable UUID identity resolution is unavailable', async () => {
    const service = { requestHandoff: vi.fn(), escalateOverdue: vi.fn() };
    const runtime = new HumanHandoffRuntime(config, service as any, { resolve: vi.fn().mockResolvedValue(undefined) });
    const result = await runtime.requestHotelHandoff({ whatsappUserId: 'whatsapp:+1', correlationId: 'corr', travelerConsented: true, criteria: {}, selectedHotel: selection });
    expect(result.status).toBe('delivery_unavailable');
    expect(service.requestHandoff).not.toHaveBeenCalled();
  });

  it('restarts SLA processing from the durable service without process-local case state', async () => {
    const first = { requestHandoff: vi.fn(), escalateOverdue: vi.fn().mockResolvedValue(1) };
    const second = { requestHandoff: vi.fn(), escalateOverdue: vi.fn().mockResolvedValue(2) };
    expect(await new HumanHandoffRuntime(config, first as any, { resolve: vi.fn() }).runSlaCycle()).toBe(1);
    expect(await new HumanHandoffRuntime(config, second as any, { resolve: vi.fn() }).runSlaCycle()).toBe(2);
  });
});
