/**
 * Twilio Webhook Signature Validation Middleware
 * Validates incoming webhook requests from Twilio using HMAC-SHA1 signature
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/environment.js';

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

  if (!signature) {
    console.error(`[${correlationId}] Missing Twilio signature header`);
    res.status(403).json({ error: 'Missing signature' });
    return;
  }

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
  // Note: timingSafeEqual requires buffers of equal length
  let isValid = false;
  try {
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    
    // Only compare if lengths match (otherwise definitely invalid)
    if (signatureBuffer.length === expectedBuffer.length) {
      isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    }
  } catch (error) {
    // If comparison fails for any reason, signature is invalid
    isValid = false;
  }

  if (!isValid) {
    console.error(
      `[${correlationId}] Invalid Twilio signature. Expected: ${expectedSignature}, Got: ${signature}`
    );
    res.status(403).json({ error: 'Invalid signature' });
    return;
  }

  // Signature is valid, proceed to next middleware
  next();
}

/**
 * Computes the expected Twilio signature using HMAC-SHA1
 * @param authToken - Twilio auth token
 * @param url - Full URL of the webhook endpoint
 * @param params - Request body parameters
 * @returns Base64-encoded HMAC-SHA1 signature
 */
function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>
): string {
  // Sort parameters alphabetically and concatenate
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join('');

  // Compute HMAC-SHA1 signature
  const hmac = crypto.createHmac('sha1', authToken);
  hmac.update(data);
  return hmac.digest('base64');
}
