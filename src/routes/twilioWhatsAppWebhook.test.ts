import crypto from 'node:crypto';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { claim, processInbound, buildReply, deliverReply } = vi.hoisted(() => ({
  claim: vi.fn(), processInbound: vi.fn(), buildReply: vi.fn(), deliverReply: vi.fn(),
}));
vi.mock('../services/InboundIdempotencyService.js', () => ({
  getInboundIdempotencyService: () => ({ claim }),
}));
vi.mock('./webhook.js', () => ({
  processNormalizedInboundMessage: processInbound, buildWebhookReply: buildReply,
  deliverWebhookReplyThroughTwilio: deliverReply, toTwiml: (reply: string) => `<Response>${reply}</Response>`,
}));
import router from './twilioWhatsAppWebhook.js';

describe('Twilio WhatsApp transport', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let origin: string;
  const priorToken = process.env.TWILIO_AUTH_TOKEN;
  const priorBypass = process.env.TWILIO_SIGNATURE_BYPASS;
  const priorPublicUrl = process.env.TWILIO_WEBHOOK_PUBLIC_URL;
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.TWILIO_AUTH_TOKEN = 'test-signature-token';
    process.env.TWILIO_SIGNATURE_BYPASS = 'false';
    process.env.TWILIO_WEBHOOK_PUBLIC_URL = '';
    claim.mockResolvedValue('new');
    processInbound.mockImplementation(async (message) => ({ inboundMessage: message, reply: 'Safe reply' }));
    buildReply.mockResolvedValue('Safe reply');
    deliverReply.mockResolvedValue(true);
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        origin = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });
  });
  afterEach(async () => {
    if (priorToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = priorToken;
    if (priorBypass === undefined) delete process.env.TWILIO_SIGNATURE_BYPASS;
    else process.env.TWILIO_SIGNATURE_BYPASS = priorBypass;
    if (priorPublicUrl === undefined) delete process.env.TWILIO_WEBHOOK_PUBLIC_URL;
    else process.env.TWILIO_WEBHOOK_PUBLIC_URL = priorPublicUrl;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function post(fields: Record<string, string>, signed = true) {
    const url = `${origin}/webhook/whatsapp`;
    const data = url + Object.keys(fields).sort().map((key) => `${key}${fields[key]}`).join('');
    const signature = signed ? crypto.createHmac('sha1', 'test-signature-token').update(data).digest('base64') : 'invalid';
    return fetch(url, { method: 'POST', headers: {
      'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature,
    }, body: new URLSearchParams(fields) });
  }

  it('sends text, buttons and voice to one normalized processor', async () => {
    const base = { From: 'whatsapp:+94770000001', To: 'whatsapp:+15550000000' };
    for (const fields of [
      { ...base, MessageSid: 'SM-text', Body: 'Dinner nearby' },
      { ...base, MessageSid: 'SM-button', ButtonPayload: 'details 1', ButtonText: 'Details' },
      { ...base, MessageSid: 'SM-voice', NumMedia: '1', MediaUrl0: 'https://example.test/voice.ogg',
        MediaContentType0: 'audio/ogg' },
    ]) {
      expect((await post(fields)).status).toBe(200);
    }
    expect(processInbound).toHaveBeenCalledTimes(3);
    expect(processInbound.mock.calls.map(([message]) => message.messageId)).toEqual(['SM-text', 'SM-button', 'SM-voice']);
    expect(processInbound.mock.calls[1][0].content).toMatchObject({ type: 'interactive', selectedId: 'details 1' });
    expect(processInbound.mock.calls[2][0]).toMatchObject({ inputType: 'voice', content: { type: 'audio' } });
    expect(deliverReply).toHaveBeenCalledTimes(3);
  });

  it('keeps signature validation and durable duplicate claims ahead of processing', async () => {
    const fields = { MessageSid: 'SM-duplicate', From: 'whatsapp:+94770000001',
      To: 'whatsapp:+15550000000', Body: 'Hello' };
    expect((await post(fields, false)).status).toBe(403);
    expect(claim).not.toHaveBeenCalled();
    claim.mockResolvedValue('duplicate');
    expect((await post(fields)).status).toBe(200);
    expect(processInbound).not.toHaveBeenCalled();
    expect(deliverReply).not.toHaveBeenCalled();
  });
});
