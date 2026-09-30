import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { assignCorrelationId } from '../middleware/correlationId.js';
import { webhookRateLimiter } from '../middleware/rateLimiting.js';
import { env } from '../config/environment.js';
import { buildWebhookReply, processNormalizedInboundMessage } from './webhook.js';
import { getOpenWaOutboundService } from '../services/OpenWaOutboundService.js';
import { getInboundIdempotencyService, type IdempotencyDecision } from '../services/InboundIdempotencyService.js';
import {
  isOpenWaOutboundEcho,
  normalizeOpenWaInboundMessage,
  type OpenWaWebhookPayload,
} from '../utils/openWaMessageNormalizer.js';

const router = Router();

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
      const deduplication = await claimOpenWaMessage(
        getOpenWaDeduplicationKey(req) || inboundMessage.messageId,
        correlationId
      );

      if (deduplication === 'unavailable') {
        res.status(503).json({ ok: false, error: 'Webhook idempotency unavailable' });
        return;
      }
      if (deduplication === 'duplicate') {
        console.log('openwa_webhook_duplicate', { correlationId, redacted: true });
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }

      console.log('openwa_webhook_accepted', {
        correlationId,
        ...buildOpenWaPayloadSummary(payload),
        redacted: true,
      });

      res.status(200).json({ ok: true, accepted: true });
      void processOpenWaInboundAsync(inboundMessage, correlationId);
    } catch (error) {
      console.error('openwa_webhook_rejected', { correlationId, category: 'invalid_or_unavailable' });
      res.status(503).json({ ok: false, error: 'Webhook processing unavailable' });
    }
  }
);

async function processOpenWaInboundAsync(
  inboundMessage: ReturnType<typeof normalizeOpenWaInboundMessage>,
  correlationId: string
): Promise<void> {
  try {
    const processed = await processNormalizedInboundMessage(inboundMessage, correlationId);
    const outbound = getOpenWaOutboundService();
    const enrichedReply = await buildWebhookReply(
      inboundMessage.from,
      processed.reply,
      false,
      correlationId
    );
    const delivered = typeof enrichedReply === 'string'
      ? await outbound.sendWhatsAppReply(inboundMessage.from, enrichedReply, {
          voice: processed.inboundMessage.inputType === 'voice',
        })
      : await outbound.sendWhatsAppMessages(inboundMessage.from, enrichedReply, {
          voice: processed.inboundMessage.inputType === 'voice',
        });

    if (!delivered) {
      console.warn(
        `[${correlationId}] OpenWA accepted inbound message but outbound reply was not delivered`
      );
    }
  } catch {
    console.error('openwa_webhook_async_failure', { correlationId, category: 'processing_or_delivery' });
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
    dataFieldCount: Object.keys(data).length,
    selectedFieldCount: Object.keys(selected).length,
    messageType: selected.type,
    hasBody: typeof selected.body === 'string' && selected.body.length > 0,
    hasText: typeof selected.text === 'string' && selected.text.length > 0,
    hasMimeType: Boolean(selected.mimetype || selected.mimeType || media.mimetype || media.mimeType),
    hasMediaUrl: Boolean(selected.mediaUrl || selected.url),
    mediaFieldCount: Object.keys(media).length,
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

  const body = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
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

async function claimOpenWaMessage(
  messageId: string,
  correlationId: string
): Promise<IdempotencyDecision> {
  if (!messageId) {
    return 'unavailable';
  }
  return getInboundIdempotencyService().claim('openwa', messageId, correlationId, 'repeatable_external_effect');
}

export default router;
