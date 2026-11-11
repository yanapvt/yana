import crypto from 'node:crypto';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/environment.js';

const { claim, processInbound, sendReply } = vi.hoisted(() => ({
  claim: vi.fn(), processInbound: vi.fn(), sendReply: vi.fn(),
}));
vi.mock('../services/InboundIdempotencyService.js', () => ({
  getInboundIdempotencyService: () => ({ claim }),
}));
vi.mock('./webhook.js', () => ({ processNormalizedInboundMessage: processInbound }));
vi.mock('../services/MetaWhatsAppOutboundService.js', () => ({
  getMetaWhatsAppOutboundService: () => ({ sendWhatsAppReply: sendReply }),
}));
import router from './metaWhatsAppWebhook.js';

describe('Meta WhatsApp transport', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let origin: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    claim.mockResolvedValue('new');
    processInbound.mockImplementation(async (message) => ({ inboundMessage: message, reply: 'Saved dining details' }));
    sendReply.mockResolvedValue(true);
    const app = express();
    app.use(express.json({ verify: (req: any, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
    app.use(router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        origin = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });
  });
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const payload = (message: object) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{
    value: { metadata: { display_phone_number: '15550000000' }, messages: [message] },
  }] }] });
  async function post(body: object, validSignature = true) {
    const serialized = JSON.stringify(body);
    const signature = env.meta.appSecret && validSignature
      ? crypto.createHmac('sha256', env.meta.appSecret).update(serialized).digest('hex')
      : 'invalid';
    return fetch(`${origin}/webhook/meta`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
      body: serialized });
  }

  it('sends text, buttons, Flow replies and voice through the same processor', async () => {
    const messages = [
      { id: 'wamid.text', from: '94770000001', type: 'text', text: { body: 'Dinner nearby' } },
      { id: 'wamid.button', from: '94770000001', type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'details 1', title: 'Details' } } },
      { id: 'wamid.flow', from: '94770000001', type: 'interactive',
        interactive: { type: 'nfm_reply', nfm_reply: { response_json: JSON.stringify({
          flow_token: 'bound-token', location: 'Galle',
        }) } } },
      { id: 'wamid.voice', from: '94770000001', type: 'audio', audio: { id: 'media-1', mime_type: 'audio/ogg' } },
    ];
    for (const message of messages) {
      const response = await post(payload(message));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ accepted: true });
    }
    await vi.waitFor(() => expect(processInbound).toHaveBeenCalledTimes(4));
    await vi.waitFor(() => expect(sendReply).toHaveBeenCalledTimes(4));
    expect(processInbound.mock.calls.map(([message]) => message.messageId)).toEqual(messages.map((message) => message.id));
    expect(processInbound.mock.calls[2][0].content).toMatchObject({ type: 'interactive', interactionType: 'flow_reply' });
    expect(sendReply.mock.calls[3][2]).toEqual({ voice: true });
  });

  it('acknowledges a duplicate without processing or delivery', async () => {
    claim.mockResolvedValue('duplicate');
    const response = await post(payload({ id: 'wamid.duplicate', from: '94770000001', type: 'text', text: { body: 'Hello' } }));
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(processInbound).not.toHaveBeenCalled();
    expect(sendReply).not.toHaveBeenCalled();
  });

  it('ignores a provider status update before claiming or processing it', async () => {
    const response = await post({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.sent' }] } }] }] });
    expect(await response.json()).toMatchObject({ ignored: 'status_webhook' });
    expect(claim).not.toHaveBeenCalled();
    expect(processInbound).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature when a Meta secret is configured', async () => {
    if (!env.meta.appSecret) return;
    const response = await post(payload({ id: 'wamid.invalid', from: '94770000001', type: 'text', text: { body: 'Hello' } }), false);
    expect(response.status).toBe(401);
    expect(claim).not.toHaveBeenCalled();
  });
});
