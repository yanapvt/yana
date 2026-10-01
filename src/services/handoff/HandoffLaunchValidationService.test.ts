import { describe, expect, it, vi } from 'vitest';
import { HandoffLaunchValidationService } from './HandoffLaunchValidationService.js';

describe('HandoffLaunchValidationService', () => {
  it('plans every launch scenario with zero external effects', () => {
    const report = new HandoffLaunchValidationService({ run: vi.fn() }).plan();
    expect(report.results).toHaveLength(11);
    expect(report).toMatchObject({ status: 'planned', evidence: 'simulated', bookingAttempted: false, paymentAttempted: false, travelerContactAttempted: false });
  });
  it('requires an exact staging-only safety confirmation', async () => {
    const service = new HandoffLaunchValidationService({ run: vi.fn() });
    await expect(service.run({ enabled: true, environment: 'production', confirm: 'MR14_SYNTHETIC_ONLY' })).rejects.toThrow('safety guard');
  });
  it('passes deterministic synthetic journeys only when no external effect occurs', async () => {
    const run = vi.fn().mockResolvedValue({ passed: true, externalEffects: 0 });
    const report = await new HandoffLaunchValidationService({ run }).run({ enabled: true, environment: 'staging', confirm: 'MR14_SYNTHETIC_ONLY' });
    expect(report.status).toBe('passed');
    expect(run).toHaveBeenCalledWith('safe_closure', 'synthetic-mr14');
  });
  it('records failure and continues through the remaining validation matrix', async () => {
    const run = vi.fn().mockResolvedValueOnce({ passed: false, externalEffects: 0 }).mockResolvedValue({ passed: true, externalEffects: 0 });
    const report = await new HandoffLaunchValidationService({ run }).run({ enabled: true, environment: 'staging', confirm: 'MR14_SYNTHETIC_ONLY' });
    expect(report.status).toBe('failed');
    expect(run).toHaveBeenCalledTimes(11);
  });
});
