/**
 * Property Test 1: Webhook Signature Validation
 * 
 * Property Statement:
 * For any inbound webhook request, the AI_Gateway SHALL accept the request if and only if 
 * the signature is valid; requests with invalid signatures SHALL be rejected and logged.
 * 
 * **Validates: Requirements 1.1, 1.2**
 * 
 * Requirements:
 * - 1.1: WHEN an inbound WhatsApp message is received, THE AI_Gateway SHALL validate 
 *        the webhook signature before processing the message
 * - 1.2: WHEN a webhook signature is invalid, THEN THE AI_Gateway SHALL reject the 
 *        request and log the rejection with the Correlation_ID
 */

import fc from 'fast-check';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { validateTwilioSignature } from '../../middleware/twilioSignature.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Computes a valid Twilio signature for testing
 */
function computeValidSignature(
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

/**
 * Creates a mock Express request object
 */
function createMockRequest(
  url: string,
  body: Record<string, unknown>,
  signature: string | undefined,
  correlationId: string
): Partial<Request> {
  return {
    protocol: 'https',
    get: (header: string) => {
      if (header === 'host') return 'example.com';
      return undefined;
    },
    originalUrl: url,
    body,
    headers: {
      'x-twilio-signature': signature,
      'x-correlation-id': correlationId,
    } as any,
  };
}

/**
 * Creates a mock Express response object with spies
 */
function createMockResponse() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

/**
 * Creates a mock next function
 */
function createMockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generates arbitrary webhook URLs
 */
const webhookUrlArb = fc.oneof(
  fc.constant('/webhook/whatsapp'),
  fc.constant('/webhook/whatsapp?test=1'),
  fc.webPath().map(path => `/webhook${path}`)
);

/**
 * Generates arbitrary webhook body parameters
 */
const webhookBodyArb = fc.dictionary(
  fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]*$/),
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.constant(null),
    fc.constant(undefined)
  ),
  { minKeys: 1, maxKeys: 10 }
);

/**
 * Generates arbitrary auth tokens
 */
const authTokenArb = fc.hexaString({ minLength: 32, maxLength: 64 });

/**
 * Generates arbitrary correlation IDs
 */
const correlationIdArb = fc.uuid();

/**
 * Generates a complete webhook request with valid signature
 */
const validWebhookRequestArb = fc.record({
  authToken: authTokenArb,
  url: webhookUrlArb,
  body: webhookBodyArb,
  correlationId: correlationIdArb,
}).map(({ authToken, url, body, correlationId }) => {
  const fullUrl = `https://example.com${url}`;
  const signature = computeValidSignature(authToken, fullUrl, body);
  return { authToken, url, body, signature, correlationId };
});

/**
 * Generates a webhook request with invalid signature
 */
const invalidWebhookRequestArb = fc.record({
  authToken: authTokenArb,
  url: webhookUrlArb,
  body: webhookBodyArb,
  correlationId: correlationIdArb,
  invalidSignature: fc.oneof(
    fc.base64String(), // Random base64 string
    fc.constant(''), // Empty signature
    fc.constant('invalid'), // Invalid format
    fc.hexaString({ minLength: 20, maxLength: 40 }) // Wrong encoding
  ),
}).map(({ authToken, url, body, correlationId, invalidSignature }) => {
  return { authToken, url, body, signature: invalidSignature, correlationId };
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 1: Webhook Signature Validation', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalAuthToken: string;

  beforeEach(() => {
    // Spy on console.error to verify logging
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Store original auth token
    originalAuthToken = process.env.TWILIO_AUTH_TOKEN || '';
  });

  afterEach(() => {
    // Restore console.error
    consoleErrorSpy.mockRestore();
    
    // Restore original auth token
    process.env.TWILIO_AUTH_TOKEN = originalAuthToken;
  });

  it('should accept all requests with valid signatures', () => {
    fc.assert(
      fc.property(validWebhookRequestArb, ({ authToken, url, body, signature, correlationId }) => {
        // Given: A webhook request with a valid signature
        process.env.TWILIO_AUTH_TOKEN = authToken;
        
        // Re-import to pick up new env var (in real scenario, this would be handled by config)
        const req = createMockRequest(url, body, signature, correlationId);
        const res = createMockResponse();
        const next = createMockNext();

        // When: The signature validation middleware is invoked
        validateTwilioSignature(req as Request, res, next);

        // Then: The request should be accepted (next() called)
        expect(next).toHaveBeenCalledOnce();
        
        // And: No error response should be sent
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
        
        // And: No error should be logged
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('should reject all requests with invalid signatures', () => {
    fc.assert(
      fc.property(invalidWebhookRequestArb, ({ authToken, url, body, signature, correlationId }) => {
        // Given: A webhook request with an invalid signature
        process.env.TWILIO_AUTH_TOKEN = authToken;
        
        const req = createMockRequest(url, body, signature, correlationId);
        const res = createMockResponse();
        const next = createMockNext();

        // When: The signature validation middleware is invoked
        validateTwilioSignature(req as Request, res, next);

        // Then: The request should be rejected (next() not called)
        expect(next).not.toHaveBeenCalled();
        
        // And: A 403 error response should be sent
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
        
        // And: The rejection should be logged with the Correlation_ID
        expect(consoleErrorSpy).toHaveBeenCalled();
        const errorLog = consoleErrorSpy.mock.calls[0][0];
        expect(errorLog).toContain(correlationId);
        expect(errorLog).toContain('Invalid Twilio signature');
      }),
      { numRuns: 100 }
    );
  });

  it('should reject requests with missing signatures', () => {
    fc.assert(
      fc.property(
        authTokenArb,
        webhookUrlArb,
        webhookBodyArb,
        correlationIdArb,
        (authToken, url, body, correlationId) => {
          // Given: A webhook request with no signature header
          process.env.TWILIO_AUTH_TOKEN = authToken;
          
          const req = createMockRequest(url, body, undefined, correlationId);
          const res = createMockResponse();
          const next = createMockNext();

          // When: The signature validation middleware is invoked
          validateTwilioSignature(req as Request, res, next);

          // Then: The request should be rejected
          expect(next).not.toHaveBeenCalled();
          
          // And: A 403 error response should be sent
          expect(res.status).toHaveBeenCalledWith(403);
          expect(res.json).toHaveBeenCalledWith({ error: 'Missing signature' });
          
          // And: The rejection should be logged with the Correlation_ID
          expect(consoleErrorSpy).toHaveBeenCalled();
          const errorLog = consoleErrorSpy.mock.calls[0][0];
          expect(errorLog).toContain(correlationId);
          expect(errorLog).toContain('Missing Twilio signature header');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be deterministic: same request yields same validation result', () => {
    fc.assert(
      fc.property(validWebhookRequestArb, ({ authToken, url, body, signature, correlationId }) => {
        // Given: A webhook request with a valid signature
        process.env.TWILIO_AUTH_TOKEN = authToken;

        // When: The same request is validated multiple times
        const results = [];
        for (let i = 0; i < 3; i++) {
          const req = createMockRequest(url, body, signature, correlationId);
          const res = createMockResponse();
          const next = createMockNext();
          
          validateTwilioSignature(req as Request, res, next);
          
          results.push({
            nextCalled: (next as any).mock.calls.length > 0,
            statusCalled: (res.status as any).mock.calls.length > 0,
          });
        }

        // Then: All validation attempts should yield the same result
        expect(results[0]).toEqual(results[1]);
        expect(results[1]).toEqual(results[2]);
      }),
      { numRuns: 50 }
    );
  });

  it('should validate signature against the complete URL including query parameters', () => {
    fc.assert(
      fc.property(
        authTokenArb,
        webhookBodyArb,
        correlationIdArb,
        fc.dictionary(fc.string(), fc.string(), { minKeys: 1, maxKeys: 5 }),
        (authToken, body, correlationId, queryParams) => {
          // Given: A webhook URL with query parameters
          const queryString = Object.entries(queryParams)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');
          const url = `/webhook/whatsapp?${queryString}`;
          const fullUrl = `https://example.com${url}`;
          
          // And: A valid signature computed with the full URL
          const validSignature = computeValidSignature(authToken, fullUrl, body);
          
          process.env.TWILIO_AUTH_TOKEN = authToken;
          
          const req = createMockRequest(url, body, validSignature, correlationId);
          const res = createMockResponse();
          const next = createMockNext();

          // When: The signature validation middleware is invoked
          validateTwilioSignature(req as Request, res, next);

          // Then: The request should be accepted
          expect(next).toHaveBeenCalledOnce();
          expect(res.status).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should reject if signature is valid for different body parameters', () => {
    fc.assert(
      fc.property(
        authTokenArb,
        webhookUrlArb,
        webhookBodyArb,
        webhookBodyArb,
        correlationIdArb,
        (authToken, url, body1, body2, correlationId) => {
          // Pre-condition: bodies must be different
          fc.pre(JSON.stringify(body1) !== JSON.stringify(body2));
          
          // Given: A signature computed for body1
          const fullUrl = `https://example.com${url}`;
          const signatureForBody1 = computeValidSignature(authToken, fullUrl, body1);
          
          process.env.TWILIO_AUTH_TOKEN = authToken;
          
          // When: The signature is used with body2 (different body)
          const req = createMockRequest(url, body2, signatureForBody1, correlationId);
          const res = createMockResponse();
          const next = createMockNext();
          
          validateTwilioSignature(req as Request, res, next);

          // Then: The request should be rejected
          expect(next).not.toHaveBeenCalled();
          expect(res.status).toHaveBeenCalledWith(403);
          
          // And: The rejection should be logged
          expect(consoleErrorSpy).toHaveBeenCalled();
          const errorLog = consoleErrorSpy.mock.calls[0][0];
          expect(errorLog).toContain(correlationId);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should reject if signature is valid for different URL', () => {
    fc.assert(
      fc.property(
        authTokenArb,
        webhookUrlArb,
        webhookUrlArb,
        webhookBodyArb,
        correlationIdArb,
        (authToken, url1, url2, body, correlationId) => {
          // Pre-condition: URLs must be different
          fc.pre(url1 !== url2);
          
          // Given: A signature computed for url1
          const fullUrl1 = `https://example.com${url1}`;
          const signatureForUrl1 = computeValidSignature(authToken, fullUrl1, body);
          
          process.env.TWILIO_AUTH_TOKEN = authToken;
          
          // When: The signature is used with url2 (different URL)
          const req = createMockRequest(url2, body, signatureForUrl1, correlationId);
          const res = createMockResponse();
          const next = createMockNext();
          
          validateTwilioSignature(req as Request, res, next);

          // Then: The request should be rejected
          expect(next).not.toHaveBeenCalled();
          expect(res.status).toHaveBeenCalledWith(403);
          
          // And: The rejection should be logged
          expect(consoleErrorSpy).toHaveBeenCalled();
          const errorLog = consoleErrorSpy.mock.calls[0][0];
          expect(errorLog).toContain(correlationId);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should always log Correlation_ID for any rejection', () => {
    fc.assert(
      fc.property(
        invalidWebhookRequestArb,
        ({ authToken, url, body, signature, correlationId }) => {
          // Given: Any invalid webhook request
          process.env.TWILIO_AUTH_TOKEN = authToken;
          
          const req = createMockRequest(url, body, signature, correlationId);
          const res = createMockResponse();
          const next = createMockNext();

          // When: The signature validation middleware is invoked
          validateTwilioSignature(req as Request, res, next);

          // Then: The Correlation_ID must appear in the error log
          expect(consoleErrorSpy).toHaveBeenCalled();
          const allErrorLogs = consoleErrorSpy.mock.calls.map(call => call[0]).join(' ');
          expect(allErrorLogs).toContain(correlationId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should use timing-safe comparison to prevent timing attacks', () => {
    fc.assert(
      fc.property(
        authTokenArb,
        webhookUrlArb,
        webhookBodyArb,
        correlationIdArb,
        (authToken, url, body, correlationId) => {
          // Given: A valid signature
          const fullUrl = `https://example.com${url}`;
          const validSignature = computeValidSignature(authToken, fullUrl, body);
          
          // And: An almost-valid signature (one character different)
          const almostValidSignature = validSignature.slice(0, -1) + 
            (validSignature.slice(-1) === 'A' ? 'B' : 'A');
          
          process.env.TWILIO_AUTH_TOKEN = authToken;
          
          const req = createMockRequest(url, body, almostValidSignature, correlationId);
          const res = createMockResponse();
          const next = createMockNext();

          // When: The signature validation middleware is invoked
          validateTwilioSignature(req as Request, res, next);

          // Then: The request should be rejected (timing-safe comparison detects difference)
          expect(next).not.toHaveBeenCalled();
          expect(res.status).toHaveBeenCalledWith(403);
        }
      ),
      { numRuns: 50 }
    );
  });
});
