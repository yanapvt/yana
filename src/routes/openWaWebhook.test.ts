import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { claim, processInbound, sendReply } = vi.hoisted(() => ({ claim: vi.fn(), processInbound: vi.fn(), sendReply: vi.fn() }));
vi.mock('../services/InboundIdempotencyService.js', () => ({ getInboundIdempotencyService: () => ({ claim }) }));
vi.mock('./webhook.js', () => ({ processNormalizedInboundMessage: processInbound }));
vi.mock('../services/OpenWaOutboundService.js', () => ({ getOpenWaOutboundService: () => ({ sendWhatsAppReply: sendReply }) }));
import router from './openWaWebhook.js';

describe('OpenWA webhook reliability', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>; let baseUrl: string;
  beforeEach(async () => {
    vi.clearAllMocks(); processInbound.mockResolvedValue({ reply: 'safe reply', inboundMessage: { inputType: 'text' } }); sendReply.mockResolvedValue(true);
    const app = express(); app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = Buffer.from(buf); } })); app.use(router);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { const address = server.address() as any; baseUrl = `http://127.0.0.1:${address.port}`; resolve(); }); });
  });
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const payload = { event: 'message', data: { id: 'stable-message-1', from: 'test-user@c.us', body: 'hello', type: 'chat' } };
  async function post(body: unknown) { return fetch(`${baseUrl}/webhook/openwa`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }

  it('accepts one stable delivery and dispatches one outbound reply', async () => {
    claim.mockResolvedValue('new'); const response = await post(payload); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ accepted: true });
    await vi.waitFor(() => expect(sendReply).toHaveBeenCalledOnce());
  });
  it('acknowledges a duplicate without processing or replying', async () => {
    claim.mockResolvedValue('duplicate'); const response = await post(payload); expect(await response.json()).toMatchObject({ duplicate: true });
    expect(processInbound).not.toHaveBeenCalled(); expect(sendReply).not.toHaveBeenCalled();
  });
  it('returns 503 when shared idempotency is unavailable', async () => {
    claim.mockResolvedValue('unavailable'); const response = await post(payload); expect(response.status).toBe(503); expect(processInbound).not.toHaveBeenCalled();
  });
  it('returns 503 rather than inventing an id for a delivery without a stable id', async () => {
    claim.mockResolvedValue('unavailable'); const response = await post({ event: 'message', data: { from: 'test-user@c.us', body: 'hello' } }); expect(response.status).toBe(503);
    expect(claim).not.toHaveBeenCalled(); expect(processInbound).not.toHaveBeenCalled(); expect(sendReply).not.toHaveBeenCalled();
  });
});
