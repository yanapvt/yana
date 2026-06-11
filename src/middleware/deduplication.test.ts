/**
 * Deduplication Middleware Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { deduplicateWebhook } from './deduplication.js';
import { getStateStore, closeStateStore } from '../services/StateStore.js';

describe('Deduplication Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let stateStore: ReturnType<typeof getStateStore>;

  beforeEach(async () => {
    // Initialize StateStore
    stateStore = getStateStore();
    await stateStore.connect();
    await stateStore.flushAll();

    // Setup mock request
    mockReq = {
      headers: {
        'x-correlation-id': 'test-correlation-id',
      },
      body: {
        MessageSid: 'SM1234567890abcdef',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        Body: 'Test message',
      },
    };

    // Setup mock response
    mockRes = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    // Setup mock next function
    mockNext = vi.fn();
  });

  afterEach(async () => {
    await closeStateStore();
  });

  it('should allow first message through and call next()', async () => {
    deduplicateWebhook(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    // Wait for async operation
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockNext).toHaveBeenCalledOnce();
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockRes.send).not.toHaveBeenCalled();
  });

  it('should block duplicate message and return 200', async () => {
    // First call - should proceed
    deduplicateWebhook(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockNext).toHaveBeenCalledOnce();

    // Reset mocks
    vi.clearAllMocks();

    // Second call with same MessageSid - should be blocked
    deduplicateWebhook(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.send).toHaveBeenCalledWith('');
  });

  it('should allow different messages through', async () => {
    // First message
    deduplicateWebhook(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockNext).toHaveBeenCalledOnce();

    // Reset mocks
    vi.clearAllMocks();

    // Second message with different MessageSid
    mockReq.body = {
      ...mockReq.body,
      MessageSid: 'SM0987654321fedcba',
    };

    deduplicateWebhook(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockNext).toHaveBeenCalledOnce();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should proceed when MessageSid is missing', async () => {
    mockReq.body = {
      From: 'whatsapp:+1234567890',
      To: 'whatsapp:+0987654321',
      Body: 'Test message',
      // No MessageSid
    };

    deduplicateWebhook(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    // Should call next immediately (synchronously) when MessageSid is missing
    expect(mockNext).toHaveBeenCalledOnce();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should store correlation ID with message ID in Redis', async () => {
    const messageSid = 'SM1234567890abcdef';
    const correlationId = 'test-correlation-id';

    deduplicateWebhook(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check Redis directly
    const client = stateStore.getClient();
    const storedValue = await client.get(`webhook:message:${messageSid}`);

    expect(storedValue).toBe(correlationId);
  });

  it('should set TTL on message ID in Redis', async () => {
    const messageSid = 'SM1234567890abcdef';

    deduplicateWebhook(
      mockReq as Request,
      mockRes as Response,
      mockNext
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check TTL in Redis
    const client = stateStore.getClient();
    const ttl = await client.ttl(`webhook:message:${messageSid}`);

    // TTL should be set (positive value)
    // Should be close to 24 hours (86400 seconds)
    expect(ttl).toBeGreaterThan(86000);
    expect(ttl).toBeLessThanOrEqual(86400);
  });
});
