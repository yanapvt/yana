/**
 * WhatsApp Webhook Routes
 * Handles inbound WhatsApp messages from Twilio
 */

import { Router, Request, Response } from 'express';
import { assignCorrelationId } from '../middleware/correlationId.js';
import { validateTwilioSignature } from '../middleware/twilioSignature.js';
import { webhookRateLimiter } from '../middleware/rateLimiting.js';
import { deduplicateWebhook } from '../middleware/deduplication.js';
import {
  normalizeInboundMessage,
  TwilioWebhookPayload,
} from '../utils/messageNormalizer.js';

const router = Router();

/**
 * POST /webhook/whatsapp
 * Twilio webhook ingress endpoint for inbound WhatsApp messages
 * 
 * Requirements: 1.1, 1.2, 1.5, 1.7, 18.1, 21.1
 * 
 * Flow:
 * 1. Assign Correlation_ID (middleware)
 * 2. Apply rate limiting (middleware)
 * 3. Validate Twilio signature (middleware)
 * 4. Deduplicate webhook delivery (middleware)
 * 5. Normalize message payload
 * 6. Return immediate HTTP 200 acknowledgement
 * 7. Queue message for async processing (TODO)
 */
router.post(
  '/webhook/whatsapp',
  assignCorrelationId,
  webhookRateLimiter,
  validateTwilioSignature,
  deduplicateWebhook,
  async (req: Request, res: Response) => {
    const correlationId = req.headers['x-correlation-id'] as string;
    const payload = req.body as TwilioWebhookPayload;

    try {
      // Normalize the inbound message
      const inboundMessage = normalizeInboundMessage(payload);

      console.log(
        `[${correlationId}] Normalized message from ${inboundMessage.from}: type=${inboundMessage.type}`
      );

      // Emit immediate acknowledgement to Twilio (HTTP 200)
      // This prevents Twilio from retrying while we process the message
      res.status(200).send('');

      // TODO: Queue message for async processing
      // - Load or create session
      // - Process through Orchestrator
      // - Execute LLM decision
      // - Execute tool calls if needed
      // - Render and send WhatsApp response
      
      // For now, just log the message
      console.log(
        `[${correlationId}] Message queued for processing:`,
        JSON.stringify(inboundMessage, null, 2)
      );
    } catch (error) {
      // Log the error but still return 200 to Twilio
      // We don't want Twilio to retry on our internal errors
      console.error(
        `[${correlationId}] Error processing webhook:`,
        error
      );
      
      // If we haven't sent a response yet, send 200
      if (!res.headersSent) {
        res.status(200).send('');
      }
    }
  }
);

export default router;
