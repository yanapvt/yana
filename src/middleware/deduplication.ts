/**
 * Deduplication Middleware
 * Prevents duplicate webhook processing using Redis-backed message ID tracking
 * Optional in development - can run without Redis
 * 
 * Validates: Requirements 21.1
 */

import { Request, Response, NextFunction } from 'express';
import { getStateStore } from '../services/StateStore.js';
import { logger } from '../config/logger.js';
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
 * 2. Check Redis for existence of this message ID (if enabled)
 * 3. If exists and Redis enabled, skip processing and return success (200)
 * 4. If not exists and Redis enabled, store message ID in Redis with TTL and proceed
 * 5. If Redis disabled, always proceed (no deduplication)
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
  const stateStore = getStateStore();

  // If Redis is disabled, skip deduplication entirely
  if (!stateStore.isEnabled()) {
    logger.debug('Deduplication', 'Redis disabled, skipping deduplication', {
      correlationId,
    });
    next();
    return;
  }

  // Extract message ID from Twilio payload
  const messageId = payload.MessageSid;

  if (!messageId) {
    logger.warn('Deduplication', 'No MessageSid found in webhook payload', {
      correlationId,
    });
    next();
    return;
  }

  logger.debug('Deduplication', 'Checking for duplicate message', {
    correlationId,
    messageId,
  });

  // Check for duplicate and store if new
  checkAndStoreMessageId(messageId, correlationId)
    .then((isDuplicate) => {
      if (isDuplicate) {
        logger.warn('Deduplication', 'Duplicate message detected', {
          correlationId,
          messageId,
        });
        // Return success to Twilio without processing
        res.status(200).send('');
      } else {
        logger.debug('Deduplication', 'New message, proceeding with processing', {
          correlationId,
          messageId,
        });
        // Proceed to next middleware
        next();
      }
    })
    .catch((error) => {
      logger.error('Deduplication', 'Deduplication check failed', {
        correlationId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      // On Redis failure, proceed with processing to avoid blocking legitimate messages
      // This is a fail-open approach for reliability
      logger.warn('Deduplication', 'Proceeding despite deduplication failure', {
        correlationId,
      });
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
    logger.debug('Deduplication', 'Connecting to Redis for deduplication check', {
      correlationId,
    });
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
