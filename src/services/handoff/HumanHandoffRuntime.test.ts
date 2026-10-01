import { describe, expect, it, vi } from 'vitest';
import type { HumanHandoffConfig } from '../../config/humanHandoff.js';
import { HumanHandoffRuntime } from './HumanHandoffRuntime.js';
const config = { enabled: true, nativeGroupEnabled: false, fallbackQueueEnabled: true, slaMinutes: 30, queueName: 'travel-concierge', operatorIdentitiesJson: '[]', slaPollSeconds: 60, queueProcessingEnabled: false, queueWorkerId: 'test', queueLeaseSeconds: 60, queueMaxAttempts: 5, queueBackoffSeconds: 30, queuePollSeconds: 10, alertQueueDepth: 100, alertOldestMinutes: 15, stagingDrillEnabled: false, staffPublicationEnabled: false, staffPublicationProvider: 'none', providerTimeoutMs: 10000, alertDeliveryEnabled: false, alertDeliveryProvider: 'none', operatorDashboardEnabled: false, operatorDashboardSessionMinutes: 30, operatorDashboardSecureCookies: true, operatorDashboardSessionStore: 'memory', operatorDashboardLocalTokenEnabled: false, operatorOidcEnabled: false, operatorOidcRoleClaim: 'roles', operatorOidcRoleMappingJson: '{}', operatorAuthRetentionDays: 30 } as HumanHandoffConfig;
const selection = { selectedHotelId: 'public-place', selectedFromBatchIndex: 0, selectedDisplayNumber: 1, selectedAt: '2026-09-13T00:00:00Z', selectedHotelSnapshot: { id: 'public-place', name: 'Safe Stay', source: 'google_places' as const } };
const receipt = { receiptId: '00000000-0000-4000-8000-000000000001', provider: 'liteapi', issuedAt: '2026-09-13T00:00:00Z', expiresAt: '2026-09-13T00:10:00Z' };
function runtime(service: any, identities: any, receiptStatus = 'valid', override = config) { return new HumanHandoffRuntime(override, service, identities, undefined, undefined, undefined, undefined, undefined, { consume: vi.fn().mockResolvedValue(receiptStatus) } as any); }

describe('HumanHandoffRuntime', () => {
  it('does not resolve identities or receipts while disabled', async () => {
    const service = { requestHandoff: vi.fn(), escalateOverdue: vi.fn() }; const identities = { resolve: vi.fn() };
    expect((await runtime(service, identities, 'valid', { ...config, enabled: false }).requestHotelHandoff({ whatsappUserId: 'whatsapp:+1', correlationId: 'corr', travelerConsented: true, criteria: {}, selectedHotel: selection })).status).toBe('disabled');
    expect(identities.resolve).not.toHaveBeenCalled();
  });
  it('validates the receipt and forwards only the minimal stay summary', async () => {
    const service = { requestHandoff: vi.fn().mockResolvedValue({ status: 'handed_off' }), escalateOverdue: vi.fn() };
    const identities = { resolve: vi.fn().mockResolvedValue({ userId: 'user-uuid', sessionId: 'session-uuid' }) };
    await runtime(service, identities).requestHotelHandoff({ whatsappUserId: 'whatsapp:+1', correlationId: 'corr-1', travelerConsented: true, criteria: { checkinDate: '2026-10-01', checkoutDate: '2026-10-03', guests: 2, additionalPreferences: 'private secret' }, selectedHotel: selection, recheckReceipt: receipt });
    expect(service.requestHandoff).toHaveBeenCalledWith({ userId: 'user-uuid', sessionId: 'session-uuid', correlationId: 'corr-1', travelerConsented: true, travelerIntendsToProceed: true, summary: { service: 'hotel', selectedStayName: 'Safe Stay', dates: '2026-10-01/2026-10-03', guestCount: 2 } });
    expect(JSON.stringify(service.requestHandoff.mock.calls)).not.toContain('private secret');
  });
  it.each(['missing', 'stale', 'mismatch', 'replayed'])('rejects a %s receipt before any case side effect', async (status) => {
    const service = { requestHandoff: vi.fn(), escalateOverdue: vi.fn() }; const identities = { resolve: vi.fn() };
    expect((await runtime(service, identities, status).requestHotelHandoff({ whatsappUserId: 'whatsapp:+1', correlationId: 'corr', travelerConsented: true, criteria: {}, selectedHotel: selection, recheckReceipt: receipt })).status).toBe('not_ready');
    expect(identities.resolve).not.toHaveBeenCalled(); expect(service.requestHandoff).not.toHaveBeenCalled();
  });
  it('fails closed when durable identity resolution is unavailable', async () => {
    const service = { requestHandoff: vi.fn(), escalateOverdue: vi.fn() };
    expect((await runtime(service, { resolve: vi.fn().mockResolvedValue(undefined) }).requestHotelHandoff({ whatsappUserId: 'whatsapp:+1', correlationId: 'corr', travelerConsented: true, criteria: {}, selectedHotel: selection, recheckReceipt: receipt })).status).toBe('delivery_unavailable');
  });
  it('restarts SLA processing from the durable service', async () => { const service = { requestHandoff: vi.fn(), escalateOverdue: vi.fn().mockResolvedValue(2) }; expect(await runtime(service, { resolve: vi.fn() }).runSlaCycle()).toBe(2); });
});
