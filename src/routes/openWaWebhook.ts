import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { assignCorrelationId } from '../middleware/correlationId.js';
import { webhookRateLimiter } from '../middleware/rateLimiting.js';
import { env } from '../config/environment.js';
import { processNormalizedInboundMessage } from './webhook.js';
import { getOpenWaOutboundService } from '../services/OpenWaOutboundService.js';
import { getStateStore } from '../services/StateStore.js';
import {
  isOpenWaOutboundEcho,
  normalizeOpenWaInboundMessage,
  type OpenWaWebhookPayload,
} from '../utils/openWaMessageNormalizer.js';

const router = Router();
const MESSAGE_ID_TTL_SECONDS = 24 * 60 * 60;

router.post(
  '/webhook/openwa',
  assignCorrelationId,
  webhookRateLimiter,
  async (req: Request, res: Response) => {
    const correlationId = req.headers['x-correlation-id'] as string;

    try {
      if (!isValidOpenWaWebhook(req)) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }

      const payload = req.body as OpenWaWebhookPayload;
      if (isOpenWaOutboundEcho(payload)) {
        res.status(200).json({ ok: true, ignored: 'outbound_echo' });
        return;
      }

      const inboundMessage = normalizeOpenWaInboundMessage(payload);
      const duplicate = await isDuplicateOpenWaMessage(
        getOpenWaDeduplicationKey(req) || inboundMessage.messageId,
        correlationId
      );

      if (duplicate) {
        console.log(
          `[${correlationId}] Ignoring duplicate OpenWA message: ${inboundMessage.messageId}`
        );
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }

      console.log(
        `[${correlationId}] OpenWA message from ${inboundMessage.from}: type=${inboundMessage.type}`
      );
      console.log(
        `[${correlationId}] OpenWA payload summary:`,
        JSON.stringify(buildOpenWaPayloadSummary(payload), null, 2)
      );

      res.status(200).json({ ok: true, accepted: true });
      void processOpenWaInboundAsync(inboundMessage, correlationId);
    } catch (error) {
      console.error(`[${correlationId}] Error processing OpenWA webhook:`, error);
      res.status(200).json({
        ok: false,
        reply: "Sorry, I hit a temporary issue while replying. Please send that again and I'll pick it up.",
      });
    }
  }
);

async function processOpenWaInboundAsync(
  inboundMessage: ReturnType<typeof normalizeOpenWaInboundMessage>,
  correlationId: string
): Promise<void> {
  try {
    const processed = await processNormalizedInboundMessage(inboundMessage, correlationId);
    const delivered = await getOpenWaOutboundService().sendWhatsAppReply(
      inboundMessage.from,
      processed.reply,
      { voice: processed.inboundMessage.inputType === 'voice' }
    );

    if (!delivered) {
      console.warn(
        `[${correlationId}] OpenWA accepted inbound message but outbound reply was not delivered`
      );
    }
  } catch (error) {
    console.error(`[${correlationId}] Error processing OpenWA message after acknowledgement:`, error);
  }
}

function buildOpenWaPayloadSummary(payload: OpenWaWebhookPayload): Record<string, unknown> {
  const data = payload.data && typeof payload.data === 'object'
    ? (payload.data as Record<string, unknown>)
    : {};
  const nestedPayload = data.payload && typeof data.payload === 'object'
    ? (data.payload as Record<string, unknown>)
    : {};
  const message = data.message && typeof data.message === 'object'
    ? (data.message as Record<string, unknown>)
    : {};
  const selected = Object.keys(nestedPayload).length > 0
    ? nestedPayload
    : Object.keys(message).length > 0
      ? message
      : data;
  const media = selected.media && typeof selected.media === 'object'
    ? (selected.media as Record<string, unknown>)
    : {};

  return {
    event: payload.event,
    type: payload.type,
    dataKeys: Object.keys(data),
    selectedKeys: Object.keys(selected),
    messageId: selected.id || selected.messageId,
    from: selected.from || selected.chatId || selected.sender,
    messageType: selected.type,
    hasBody: typeof selected.body === 'string' && selected.body.length > 0,
    hasText: typeof selected.text === 'string' && selected.text.length > 0,
    mimetype: selected.mimetype || selected.mimeType || media.mimetype || media.mimeType,
    hasMediaUrl: Boolean(selected.mediaUrl || selected.url),
    mediaKeys: Object.keys(media),
    mediaOmitted: media.omitted,
    mediaSizeBytes: media.sizeBytes,
  };
}

function isValidOpenWaWebhook(req: Request): boolean {
  if (!env.openwa.webhookSecret) {
    return true;
  }

  const signature = getOpenWaSignature(req);
  if (!signature) {
    return false;
  }

  const body = JSON.stringify(req.body ?? {});
  const expected = crypto
    .createHmac('sha256', env.openwa.webhookSecret)
    .update(body)
    .digest('hex');

  const normalizedSignature = signature.replace(/^sha256=/i, '');
  return timingSafeEqual(normalizedSignature, expected);
}

function getOpenWaSignature(req: Request): string | undefined {
  const value =
    req.header('x-openwa-signature') ||
    req.header('x-signature') ||
    req.header('x-hub-signature-256');
  return value?.trim();
}

function getOpenWaDeduplicationKey(req: Request): string | undefined {
  const idempotencyKey = req.header('x-openwa-idempotency-key')?.trim();
  if (idempotencyKey && !/_unknown(?:_|$)/i.test(idempotencyKey)) {
    return idempotencyKey;
  }

  return req.header('x-openwa-delivery-id')?.trim();
}

function timingSafeEqual(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

async function isDuplicateOpenWaMessage(
  messageId: string,
  correlationId: string
): Promise<boolean> {
  if (!messageId) {
    return false;
  }

  try {
    const stateStore = getStateStore();
    if (!stateStore.isConnected()) {
      await stateStore.connect();
    }

    const result = await stateStore.getClient().set(
      `webhook:openwa:message:${messageId}`,
      correlationId,
      {
        NX: true,
        EX: MESSAGE_ID_TTL_SECONDS,
      }
    );

    return result === null;
  } catch (error) {
    console.error(`[${correlationId}] OpenWA deduplication failed:`, error);
    return false;
  }
}

export default router;
