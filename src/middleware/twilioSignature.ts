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
export function validateTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-twilio-signature'] as string;
  const correlationId = req.headers['x-correlation-id'] as string;

  /**
   * ✅ DEV MODE BYPASS (ADDED)
   * Skip Twilio validation in development environment
   */
  if (process.env.TWILIO_SIGNATURE_BYPASS === 'true') {
    console.warn(`[${correlationId}] ⚠️ DEV MODE: Skipping Twilio signature validation`);
    next();
    return;
  }

  if (!signature) {
    console.error(`[${correlationId}] Missing Twilio signature header`);
    res.status(403).json({ error: 'Missing signature' });
    return;
  }

  const url = getSignatureValidationUrl(req);
  const rawBody: unknown = req.body as unknown;
  const body = isRecord(rawBody) ? rawBody : {};

  // Compute expected signature
  const expectedSignature = computeTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN || env.twilio.authToken,
    url,
    body
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
    console.error(
      `[${correlationId}] Invalid Twilio signature. Expected: ${expectedSignature}, Got: ${signature}`
    );
    res.status(403).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

/**
 * Twilio signs the externally configured webhook URL. When a local app is
 * reached through ngrok or another proxy, localhost is not the signed URL.
 */
export function getSignatureValidationUrl(req: Request): string {
  const publicWebhookUrl = process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim();
  if (publicWebhookUrl) {
    return publicWebhookUrl;
  }

  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}${req.originalUrl}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      .map((key) => `${key}${String(params[key])}`)
      .join('');

  const hmac = crypto.createHmac('sha1', authToken);
  hmac.update(data);
  return hmac.digest('base64');
}
