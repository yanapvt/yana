import { Router, type Request, type Response } from 'express';
import { getConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import { assignCorrelationId } from '../middleware/correlationId.js';
import { deduplicateWebhook } from '../middleware/deduplication.js';
import { webhookRateLimiter } from '../middleware/rateLimiting.js';
import { validateTwilioSignature } from '../middleware/twilioSignature.js';
import { logSafeOperatorFailure } from '../services/SafeFailureService.js';
import {
  normalizeInboundMessage,
  type TwilioWebhookPayload,
} from '../utils/messageNormalizer.js';
import {
  buildWebhookReply,
  deliverWebhookReplyThroughTwilio,
  processNormalizedInboundMessage,
  toTwiml,
} from './webhook.js';

const router = Router();

/** Twilio transport boundary. Domain routing belongs to the control plane. */
router.post(
  '/webhook/whatsapp',
  assignCorrelationId,
  webhookRateLimiter,
  validateTwilioSignature,
  deduplicateWebhook,
  async (req: Request, res: Response) => {
    const correlationId = req.headers['x-correlation-id'] as string;

    try {
      const inboundMessage = normalizeInboundMessage(req.body as TwilioWebhookPayload);
      const processed = await processNormalizedInboundMessage(inboundMessage, correlationId, true);
      const reply = await buildWebhookReply(
        processed.inboundMessage.from,
        processed.reply,
        processed.inboundMessage.inputType === 'voice',
        correlationId
      );
      const delivered = await deliverWebhookReplyThroughTwilio(
        processed.inboundMessage.from,
        processed.inboundMessage.to,
        reply,
        correlationId
      );

      if (delivered) {
        if (processed.canonicalEvent) await getConversationControlPlane().recordOutboundQuestion(
          processed.canonicalEvent, 'provider_accepted');
        res.type('text/xml').status(200).send(
          '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
        );
        return;
      }

      res.type('text/xml').status(200).send(toTwiml(reply));
      if (processed.canonicalEvent) await getConversationControlPlane().recordOutboundQuestion(
        processed.canonicalEvent, 'provider_accepted');
    } catch (error) {
      logSafeOperatorFailure(console, 'webhook_processing_failed', correlationId, error);
      if (!res.headersSent) {
        res.type('text/xml').status(200).send(
          toTwiml("Sorry, I hit a temporary issue while replying. Please send that again and I'll pick it up.")
        );
      }
    }
  }
);

export default router;
