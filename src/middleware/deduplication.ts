/**
 * Deduplication Middleware
 * Prevents duplicate webhook processing using shared atomic message claims
 * 
 * Validates: Requirements 21.1
 */

import { Request, Response, NextFunction } from 'express';
import { getInboundIdempotencyService, type InboundEffectClass } from '../services/InboundIdempotencyService.js';
import { TwilioWebhookPayload } from '../utils/messageNormalizer.js';

/**
 * Default TTL for processed message IDs (24 hours in seconds)
 * This should be longer than Twilio's retry window
 */
/**
 * Deduplication middleware for inbound webhook deliveries
 * 
 * Flow:
 * 1. Extract MessageSid from webhook payload
 * 2. Claim the ID atomically in shared storage
 * 3. If exists, skip processing and return success (200)
 * 4. If not exists, store message ID in Redis with TTL and proceed
 * 
 * Requirements: 21.1
 */
export function deduplicateWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const correlationId = req.headers['x-correlation-id'] as string;
  const payload = req.body as TwilioWebhookPayload;

  // Extract message ID from Twilio payload
  const messageId = payload.MessageSid;

  const effectClass: InboundEffectClass = 'repeatable_external_effect';
  if (!messageId) {
    console.warn(
      `[${correlationId}] No MessageSid found in side-effecting webhook payload; failing closed`
    );
    res.status(503).send('Webhook idempotency unavailable');
    return;
  }

  // Check for duplicate and store if new
  getInboundIdempotencyService().claim('twilio', messageId, correlationId, effectClass)
    .then((decision) => {
      if (decision === 'duplicate') {
        console.log(
          `[${correlationId}] Duplicate message detected: ${messageId}, skipping processing`
        );
        // Return success to Twilio without processing
        res.status(200).send('');
      } else if (decision === 'new') {
        console.log(
          `[${correlationId}] New message: ${messageId}, proceeding with processing`
        );
        // Proceed to next middleware
        next();
      } else {
        console.error(`[${correlationId}] Idempotency stores unavailable; failing closed`, { effectClass });
        res.status(503).send('Webhook idempotency unavailable');
      }
    })
    .catch((error) => {
      console.error(
        `[${correlationId}] Deduplication check failed for ${messageId}:`,
        error
      );
      res.status(503).send('Webhook idempotency unavailable');
    });
}
