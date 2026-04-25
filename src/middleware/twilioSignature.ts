/**
 * Twilio Webhook Signature Validation Middleware
 * Validates incoming webhook requests from Twilio using HMAC-SHA1 signature
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/environment.js';
import { logger } from '../config/logger.js';

/**
 * Validates Twilio webhook signature
 * Rejects requests with invalid signatures and logs the rejection
 */
export function validateTwilioSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const signature = req.headers['x-twilio-signature'] as string;
  const correlationId = req.headers['x-correlation-id'] as string;

  /**
   * ✅ DEV MODE BYPASS (ADDED)
   * Skip Twilio validation in development environment
   */
  if (env.nodeEnv === 'development') {
    logger.warn('TwilioSignature', 'Skipping Twilio signature validation in development', {
      correlationId,
      nodeEnv: env.nodeEnv,
    });
    next();
    return;
  }

  if (!signature) {
    logger.error('TwilioSignature', 'Missing Twilio signature header', {
      correlationId,
    });
    res.status(403).json({ error: 'Missing signature' });
    return;
  }

  logger.debug('TwilioSignature', 'Validating Twilio signature', {
    correlationId,
    signatureLength: signature.length,
  });

  // Construct the full URL (Twilio uses the full URL for signature validation)
  const protocol = req.protocol;
  const host = req.get('host');
  const url = `${protocol}://${host}${req.originalUrl}`;

  // Compute expected signature
  const expectedSignature = computeTwilioSignature(
    env.twilio.authToken,
    url,
    req.body
  );

  // Compare signatures using timing-safe comparison
  let isValid = false;
  try {
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length === expectedBuffer.length) {
      isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    }
  } catch (error) {
    isValid = false;
  }

  if (!isValid) {
    logger.error('TwilioSignature', 'Invalid Twilio signature', {
      correlationId,
      expectedSignature,
      providedSignature: signature,
    });
    res.status(403).json({ error: 'Invalid signature' });
    return;
  }

  logger.debug('TwilioSignature', 'Twilio signature validation successful', {
    correlationId,
  });

  next();
}

/**
 * Computes the expected Twilio signature using HMAC-SHA1
 */
function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join('');

  const hmac = crypto.createHmac('sha1', authToken);
  hmac.update(data);
  return hmac.digest('base64');
}