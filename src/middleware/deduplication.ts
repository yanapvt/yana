/**
 * Deduplication Middleware
 * Prevents duplicate webhook processing using Redis-backed message ID tracking
 * 
 * Validates: Requirements 21.1
 */

import { Request, Response, NextFunction } from 'express';
import { getStateStore } from '../services/StateStore.js';
import { TwilioWebhookPayload } from '../utils/messageNormalizer.js';

/**
 * Default TTL for processed message IDs (24 hours in seconds)
 * This should be longer than Twilio's retry window
 */
const DEFAULT_MESSAGE_ID_TTL = 24 * 60 * 60;

/**
 * Deduplication middleware for inbound webhook deliveries
 * 
 * Flow:
 * 1. Extract MessageSid from webhook payload
 * 2. Check Redis for existence of this message ID
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

  if (!messageId) {
    console.warn(
      `[${correlationId}] No MessageSid found in webhook payload, skipping deduplication`
    );
    next();
    return;
  }

  // Check for duplicate and store if new
  checkAndStoreMessageId(messageId, correlationId)
    .then((isDuplicate) => {
      if (isDuplicate) {
        console.log(
          `[${correlationId}] Duplicate message detected: ${messageId}, skipping processing`
        );
        // Return success to Twilio without processing
        res.status(200).send('');
      } else {
        console.log(
          `[${correlationId}] New message: ${messageId}, proceeding with processing`
        );
        // Proceed to next middleware
        next();
      }
    })
    .catch((error) => {
      console.error(
        `[${correlationId}] Deduplication check failed for ${messageId}:`,
        error
      );
      // On Redis failure, proceed with processing to avoid blocking legitimate messages
      // This is a fail-open approach for reliability
      console.warn(
        `[${correlationId}] Proceeding with processing despite deduplication failure`
      );
      next();
    });
}

/**
 * Check if message ID exists in Redis, and store it if not
 * @param messageId - The message ID to check
 * @param correlationId - Correlation ID for logging
 * @returns True if message is a duplicate, false if new
 */
async function checkAndStoreMessageId(
  messageId: string,
  correlationId: string
): Promise<boolean> {
  const stateStore = getStateStore();

  // Ensure connection
  if (!stateStore.isConnected()) {
    await stateStore.connect();
  }

  const key = getMessageIdKey(messageId);

  // Use SET NX (set if not exists) with expiry
  // This is atomic and prevents race conditions
  const client = stateStore.getClient();
  const result = await client.set(key, correlationId, {
    NX: true, // Only set if key doesn't exist
    EX: DEFAULT_MESSAGE_ID_TTL, // Set expiry in seconds
  });

  // If result is null, key already existed (duplicate)
  // If result is 'OK', key was set (new message)
  return result === null;
}

/**
 * Generate Redis key for message ID tracking
 */
function getMessageIdKey(messageId: string): string {
  return `webhook:message:${messageId}`;
}
