/**
 * Correlation ID Middleware
 * Assigns a unique Correlation_ID to every inbound request for end-to-end traceability
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../config/logger.js';

/**
 * Assigns a unique Correlation_ID to each request
 * The ID is stored in the request headers for downstream processing
 */
export function assignCorrelationId(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Generate a unique correlation ID using UUID v4 format
  const correlationId = crypto.randomUUID();

  // Store in request headers for downstream access
  req.headers['x-correlation-id'] = correlationId;

  // Also add to response headers for client visibility
  res.setHeader('X-Correlation-ID', correlationId);

  logger.debug('Middleware', 'New request', {
    correlationId,
    method: req.method,
    path: req.path,
    ip: req.ip,
  });

  next();
}
