import { describe, expect, it, vi } from 'vitest';
import { loadHumanHandoffConfig } from '../../config/humanHandoff.js';
import { HandoffOperationsService } from './HandoffOperationsService.js';

function setup(patch: Record<string, unknown> = {}) {
  const config = { ...loadHumanHandoffConfig({}), enabled: true, operatorToken: 'token', ...patch };
  const cases = { list: vi.fn().mockResolvedValue({ items: [], nextCursor: 'next' }), detail: vi.fn(), openCaseMetrics: vi.fn().mockResolvedValue({ openCases: 2, slaBreaches: 1 }), ping: vi.fn() };
  const queue = { metrics: vi.fn().mockResolvedValue({ ready: 3, processing: 1, retrying: 1, deadLetters: 0, completed: 4, oldestReadyAgeSeconds: 30 }) };
  return { service: new HandoffOperationsService(config, cases, queue as any), cases, queue };
}

describe('HandoffOperationsService', () => {
  it('bounds pagination and returns an opaque continuation', async () => {
    const { service, cases } = setup();
    expect(await service.list(1000, 'cursor')).toEqual({ items: [], nextCursor: 'next' });
    expect(cases.list).toHaveBeenCalledWith(100, 'cursor');
  });
  it('combines queue, case and SLA metrics', async () => {
    expect(await setup().service.metrics()).toEqual(expect.objectContaining({ ready: 3, openCases: 2, slaBreaches: 1 }));
  });
  it('logs only aggregate operational metrics', async () => {
    const config = { ...loadHumanHandoffConfig({}), enabled: true, operatorToken: 'token' };
    const cases = { list: vi.fn(), detail: vi.fn(), openCaseMetrics: vi.fn().mockResolvedValue({ openCases: 1, slaBreaches: 1 }), ping: vi.fn() };
    const queue = { metrics: vi.fn().mockResolvedValue({ ready: 2, processing: 0, retrying: 0, deadLetters: 0, completed: 3, oldestReadyAgeSeconds: 20 }) };
    const audit = { info: vi.fn() };
    await new HandoffOperationsService(config, cases, queue as any, () => new Date(), audit).metrics();
    expect(audit.info).toHaveBeenCalledWith('handoff_operational_metrics', expect.objectContaining({ ready: 2, slaBreaches: 1 }));
    expect(JSON.stringify(audit.info.mock.calls)).not.toMatch(/selectedStay|token|password/i);
  });
  it('fails readiness at configured depth, age, or dead letters', async () => {
    const { service } = setup({ alertQueueDepth: 4, alertOldestMinutes: 1 });
    const result = await service.readiness();
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('queue_depth_threshold_exceeded');
  });
  it('fails closed when storage is unavailable', async () => {
    const { service, cases } = setup(); cases.ping.mockRejectedValue(new Error('password=secret'));
    expect(await service.readiness()).toEqual({ ready: false, reasons: ['handoff_database_unavailable'] });
  });
  it('keeps the deterministic staging drill disabled and incapable of booking or charging', () => {
    expect(setup().service.stagingDrill()).toEqual({ status: 'disabled', bookingAttempted: false, paymentAttempted: false, steps: [] });
    const result = setup({ stagingDrillEnabled: true }).service.stagingDrill();
    expect(result).toMatchObject({ status: 'passed', bookingAttempted: false, paymentAttempted: false });
  });
});
