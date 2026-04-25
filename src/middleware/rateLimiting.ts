/**
 * Rate Limiting and Abuse Detection Middleware
 * Protects the webhook endpoint from excessive requests
 */

import rateLimit from 'express-rate-limit';
import { logger } from '../config/logger.js';

/**
 * Rate limiter for webhook endpoints
 * Limits requests per phone number to prevent abuse
 */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30, // Limit each phone number to 30 requests per minute
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Use phone number from request body as key
  keyGenerator: (req) => {
    const from = req.body?.From || req.ip;
    return from;
  },
  // Skip successful requests from counting against the limit
  skipSuccessfulRequests: false,
  // Skip failed requests from counting against the limit
  skipFailedRequests: false,
  handler: (req, res) => {
    const correlationId = req.headers['x-correlation-id'] as string;
    const from = req.body?.From || req.ip;
    logger.warn('RateLimiter', 'Rate limit exceeded', {
      correlationId,
      from,
      windowMs: 60,
      maxRequests: 30,
    });
    res.status(429).json({ error: 'Too many requests, please try again later' });
  },
});
