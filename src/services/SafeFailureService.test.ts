import { describe, expect, it, vi } from 'vitest';
import { attemptSafeFallback, handleTravelFailure, logSafeOperatorFailure } from './SafeFailureService.js';

describe('SafeFailureService', () => {
  it.each([
    [Object.assign(new Error('upstream timed out with token rate-secret'), { code: 'ETIMEDOUT' }), 'timeout'],
    [Object.assign(new Error('malformed response contained booking-token'), { code: 'SCHEMA_ERROR' }), 'malformed_response'],
    [Object.assign(new Error('provider outage API_KEY=secret'), { code: 'SERVICE_UNAVAILABLE' }), 'provider_outage'],
  ])('returns deterministic redacted traveler messages', (error, category) => {
    const logger = { error: vi.fn() };
    const result = handleTravelFailure('hotel', 'corr-safe-1', error, logger);
    expect(result.category).toBe(category);
    expect(result.reply).toContain('Your details are saved');
    expect(result.reply).not.toMatch(/rate-secret|booking-token|API_KEY|server logs|stack/i);
    expect(logger.error).toHaveBeenCalledWith('travel_service_operation_failed', {
      correlationId: 'corr-safe-1', service: 'hotel', category, retryable: category !== 'malformed_response',
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/rate-secret|booking-token|API_KEY/);
  });

  it('uses a valid alternative provider after timeout and malformed output', async () => {
    const state = { criteria: 'preserved' };
    const result = await attemptSafeFallback([
      vi.fn().mockRejectedValue(new Error('timeout secret-token')),
      vi.fn().mockResolvedValue({ malformed: true }),
      vi.fn().mockResolvedValue({ results: ['safe'] }),
    ], (value) => Array.isArray((value as { results?: unknown }).results));
    expect(result).toEqual({ success: true, value: { results: ['safe'] }, providerIndex: 2 });
    expect(state).toEqual({ criteria: 'preserved' });
  });

  it('fails closed when every fallback fails without mutating conversation state', async () => {
    const state = { stage: 'searching', criteria: { location: 'Galle' } };
    const before = structuredClone(state);
    const result = await attemptSafeFallback([
      vi.fn().mockRejectedValue(new Error('credential=secret')),
      vi.fn().mockResolvedValue({ invalid: true }),
    ], () => false);
    expect(result).toEqual({ success: false });
    expect(state).toEqual(before);
  });

  it('logs only normalized failure metadata for operational fallbacks', () => {
    const logger = { error: vi.fn() };
    logSafeOperatorFailure(
      logger,
      'webhook_delivery_failed',
      'corr-safe-2',
      new Error('Authorization: Bearer secret-token'),
      { channel: 'whatsapp' }
    );
    expect(logger.error).toHaveBeenCalledWith('webhook_delivery_failed', {
      channel: 'whatsapp', correlationId: 'corr-safe-2', category: 'unexpected',
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-token');
  });
});
