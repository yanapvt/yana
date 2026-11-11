import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { assignCorrelationId } from '../middleware/correlationId.js';
import { webhookRateLimiter } from '../middleware/rateLimiting.js';
import { env } from '../config/environment.js';
import { processNormalizedInboundMessage } from './webhook.js';
import { getMetaWhatsAppMediaService } from '../services/MetaWhatsAppMediaService.js';
import { getMetaWhatsAppOutboundService } from '../services/MetaWhatsAppOutboundService.js';
import { getInboundIdempotencyService } from '../services/InboundIdempotencyService.js';
import {
  isMetaStatusWebhook,
  normalizeMetaWhatsAppInboundMessage,
  type MetaWhatsAppWebhookPayload,
} from '../utils/metaWhatsAppMessageNormalizer.js';

const router = Router();

router.get('/webhook/meta', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.meta.verifyToken && typeof challenge === 'string') {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).send('Forbidden');
});

router.post(
  '/webhook/meta',
  assignCorrelationId,
  webhookRateLimiter,
  async (req: Request, res: Response) => {
    const correlationId = req.headers['x-correlation-id'] as string;

    try {
      if (!isValidMetaSignature(req)) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }

      const payload = req.body as MetaWhatsAppWebhookPayload;
      if (isMetaStatusWebhook(payload)) {
        res.status(200).json({ ok: true, ignored: 'status_webhook' });
        return;
      }

      const inboundMessage = normalizeMetaWhatsAppInboundMessage(payload, {
        mediaUrlForId: (mediaId) => getMetaWhatsAppMediaService().buildProxyUrl(mediaId),
      });
      const deduplication = inboundMessage.messageId
        ? await getInboundIdempotencyService().claim('meta', inboundMessage.messageId, correlationId, 'repeatable_external_effect')
        : 'unavailable';
      if (deduplication === 'unavailable') {
        res.status(503).json({ ok: false, error: 'Webhook idempotency unavailable' });
        return;
      }
      if (deduplication === 'duplicate') {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }

      console.log(
        `[${correlationId}] Meta WhatsApp message from ${inboundMessage.from}: type=${inboundMessage.type}`
      );

      res.status(200).json({ ok: true, accepted: true });
      void processMetaInboundAsync(inboundMessage, correlationId);
    } catch (error) {
      console.error(`[${correlationId}] Error processing Meta WhatsApp webhook:`, error);
      res.status(200).json({ ok: false });
    }
  }
);

async function processMetaInboundAsync(
  inboundMessage: ReturnType<typeof normalizeMetaWhatsAppInboundMessage>,
  correlationId: string
): Promise<void> {
  try {
    const processed = await processNormalizedInboundMessage(inboundMessage, correlationId);
    const delivered = await getMetaWhatsAppOutboundService().sendWhatsAppReply(
      inboundMessage.from,
      processed.reply,
      { voice: processed.inboundMessage.inputType === 'voice' }
    );

    if (!delivered) {
      console.warn(
        `[${correlationId}] Meta WhatsApp accepted inbound message but outbound reply was not delivered`
      );
    }
  } catch (error) {
    console.error(`[${correlationId}] Error processing Meta WhatsApp message:`, error);
  }
}

function isValidMetaSignature(req: Request): boolean {
  if (!env.meta.appSecret) {
    return true;
  }

  const signature = req.header('x-hub-signature-256')?.replace(/^sha256=/i, '');
  if (!signature) {
    return false;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const body = rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const expected = crypto
    .createHmac('sha256', env.meta.appSecret)
    .update(body)
    .digest('hex');

  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export default router;
