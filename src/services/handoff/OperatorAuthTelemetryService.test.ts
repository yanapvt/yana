import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db/connection.js', () => ({ pool: { query: mocks.query } }));

import { OperatorAuthTelemetryService } from './OperatorAuthTelemetryService.js';

describe('OperatorAuthTelemetryService', () => {
  beforeEach(() => mocks.query.mockReset());

  it('persists only privacy-minimized authentication metadata', async () => {
    mocks.query.mockResolvedValue({ rowCount: 1 });
    const service = new OperatorAuthTelemetryService(30);
    await service.record({
      correlationId: '11111111-1111-4111-8111-111111111111',
      operatorId: '22222222-2222-4222-8222-222222222222',
      event: 'login', outcome: 'failure', method: 'oidc', reasonCode: 'nonce_mismatch',
    });
    const [, values] = mocks.query.mock.calls[0];
    expect(values).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'login', 'failure', 'oidc', 'nonce_mismatch',
    ]);
    expect(JSON.stringify(values)).not.toContain('token');
  });

  it('enforces the configured retention window', async () => {
    mocks.query.mockResolvedValue({ rowCount: 4 });
    const service = new OperatorAuthTelemetryService(14);
    const now = new Date('2026-09-13T00:00:00.000Z');
    await expect(service.enforceRetention(now)).resolves.toBe(4);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM operator_auth_events'), [now, 14]);
  });
});
