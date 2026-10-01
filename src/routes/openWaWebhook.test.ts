import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { claim, processInbound, buildReply, sendReply, sendMessages } = vi.hoisted(() => ({
  claim: vi.fn(),
  processInbound: vi.fn(),
  buildReply: vi.fn(),
  sendReply: vi.fn(),
  sendMessages: vi.fn(),
}));
vi.mock('../services/InboundIdempotencyService.js', () => ({ getInboundIdempotencyService: () => ({ claim }) }));
vi.mock('./webhook.js', () => ({ processNormalizedInboundMessage: processInbound, buildWebhookReply: buildReply }));
vi.mock('../services/OpenWaOutboundService.js', () => ({
  getOpenWaOutboundService: () => ({ sendWhatsAppReply: sendReply, sendWhatsAppMessages: sendMessages }),
}));
import router from './openWaWebhook.js';

describe('OpenWA webhook reliability', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>; let baseUrl: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    processInbound.mockResolvedValue({ reply: 'safe reply', inboundMessage: { inputType: 'text' } });
    buildReply.mockResolvedValue('safe reply');
    sendReply.mockResolvedValue(true);
    sendMessages.mockResolvedValue(true);
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
  it('enriches search results and dispatches image cards through OpenWA', async () => {
    buildReply.mockResolvedValue([
      { body: 'Hotel matches' },
      { body: 'Hotel 1 — reply book 1', mediaUrl: 'https://images.example/hotel-1.jpg' },
    ]);
    claim.mockResolvedValue('new');

    const response = await post(payload);
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(sendMessages).toHaveBeenCalledWith(
      'openwa:test-user@c.us',
      expect.arrayContaining([expect.objectContaining({ mediaUrl: 'https://images.example/hotel-1.jpg' })]),
      { voice: false }
    ));
    expect(sendReply).not.toHaveBeenCalled();
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
