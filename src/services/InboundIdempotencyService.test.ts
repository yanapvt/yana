import { describe, expect, it, vi } from 'vitest';
import { InboundIdempotencyService } from './InboundIdempotencyService.js';
function unavailableRedis() { return { connect: vi.fn(), isConnected: () => false } as any; }
describe('InboundIdempotencyService durable fallback', () => {
  it('uses an atomic shared claim during Redis outage and across concurrent instances', async () => {
    const claims = new Set<string>(); const durable = { claim: vi.fn(async ({ messageIdHash }: any) => { const fresh = !claims.has(messageIdHash); claims.add(messageIdHash); return fresh; }) };
    const decisions = await Promise.all([new InboundIdempotencyService(unavailableRedis(), durable).claim('twilio', 'same', 'a', 'repeatable_external_effect'), new InboundIdempotencyService(unavailableRedis(), durable).claim('twilio', 'same', 'b', 'repeatable_external_effect')]);
    expect(decisions.sort()).toEqual(['duplicate', 'new']);
  });
  it('retains the claim after an application restart', async () => {
    const claims = new Set<string>(); const durable = { claim: async ({ messageIdHash }: any) => { const fresh = !claims.has(messageIdHash); claims.add(messageIdHash); return fresh; } };
    expect(await new InboundIdempotencyService(unavailableRedis(), durable).claim('twilio', 'restart', 'a', 'repeatable_external_effect')).toBe('new');
    expect(await new InboundIdempotencyService(unavailableRedis(), durable).claim('twilio', 'restart', 'b', 'repeatable_external_effect')).toBe('duplicate');
  });
  it('reports unavailable when both stores fail', async () => { const durable = { claim: vi.fn().mockRejectedValue(new Error('down')) }; expect(await new InboundIdempotencyService(unavailableRedis(), durable).claim('twilio', 'x', 'c', 'repeatable_external_effect')).toBe('unavailable'); });
  it('fails open only for explicitly read-only work', async () => { const durable = { claim: vi.fn().mockRejectedValue(new Error('down')) }; expect(await new InboundIdempotencyService(unavailableRedis(), durable).claim('internal', 'x', 'c', 'read_only')).toBe('new'); });
});
