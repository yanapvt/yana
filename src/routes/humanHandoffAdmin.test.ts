import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHumanHandoffAdminRouter } from './humanHandoffAdmin.js';
import { hashOperatorCredential, OperatorIdentityService } from '../services/handoff/OperatorIdentityService.js';

let server: Server | undefined;
afterEach(() => server?.close());

function start(runtime: any): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(createHumanHandoffAdminRouter(() => runtime));
  return new Promise((resolve) => {
    server = app.listen(0, () => resolve(`http://127.0.0.1:${(server!.address() as any).port}`));
  });
}

const handoffId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const operatorId = '33333333-3333-4333-8333-333333333333';
function runtime(role: 'viewer'|'operator'|'admin', extra: any = {}) {
  const identities = JSON.stringify([{ id: actorId, tokenSha256: hashOperatorCredential('right'), roles: [role], revoked: false }]);
  return { config: { enabled: true, operatorIdentitiesJson: identities }, operatorAuth: new OperatorIdentityService(identities), ...extra };
}

describe('human handoff operator routes', () => {
  it('is hidden while disabled and rejects an invalid token', async () => {
    const runtime = { config: { enabled: false }, service: {} };
    let base = await start(runtime);
    expect((await fetch(`${base}/admin/handoffs/sla/run`, { method: 'POST' })).status).toBe(404);
    server!.close();
    Object.assign(runtime, { config: { enabled: true }, operatorAuth: new OperatorIdentityService('[]') });
    base = await start(runtime);
    expect((await fetch(`${base}/admin/handoffs/sla/run`, { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  });

  it('validates UUIDs and performs authorized assignment without exposing summaries', async () => {
    const service = { assign: vi.fn().mockResolvedValue({ status: 'updated', case: {
      handoffId, sessionId: actorId, status: 'assigned', channel: 'agent_queue', operatorId,
      createdAt: new Date('2026-09-13T00:00:00Z'), slaDueAt: new Date('2026-09-13T00:30:00Z'),
    } }) };
    const base = await start(runtime('operator', { service }));
    const bad = await fetch(`${base}/admin/handoffs/not-a-uuid/assign`, { method: 'POST', headers: { authorization: 'Bearer right', 'content-type': 'application/json' }, body: '{}' });
    expect(bad.status).toBe(400);
    const response = await fetch(`${base}/admin/handoffs/${handoffId}/assign`, {
      method: 'POST', headers: { authorization: 'Bearer right', 'content-type': 'application/json' },
      body: JSON.stringify({ actorId, operatorId }),
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('summary');
    expect(service.assign).toHaveBeenCalledWith(handoffId, actorId, operatorId);
  });

  it('requires operator identity and returns paginated minimal case views', async () => {
    const operations = { list: vi.fn().mockResolvedValue({ items: [{ handoffId, status: 'pending', channel: 'agent_queue', service: 'hotel' }], nextCursor: 'opaque' }) };
    const base = await start(runtime('viewer', { service: {}, operations }));
    const headers = { authorization: 'Bearer right' };
    const response = await fetch(`${base}/admin/handoffs?limit=10`, { headers });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nextCursor).toBe('opaque');
    expect(JSON.stringify(body)).not.toMatch(/session_summary|correlationId|provider|token/i);
    expect(operations.list).toHaveBeenCalledWith(10, undefined);
  });

  it('enforces roles and permits one audited admin dead-letter replay', async () => {
    const deadLetters = { replay: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false), list: vi.fn() };
    let base = await start(runtime('viewer', { service: {}, deadLetters }));
    const request = () => fetch(`${base}/admin/handoffs/dead-letters/${handoffId}/replay`, { method:'POST', headers:{ authorization:'Bearer right' } });
    expect((await request()).status).toBe(403);
    server!.close(); base = await start(runtime('admin', { service: {}, deadLetters }));
    expect((await request()).status).toBe(202); expect((await request()).status).toBe(409);
    expect(deadLetters.replay).toHaveBeenCalledWith(handoffId, actorId);
  });
});
