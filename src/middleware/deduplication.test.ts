import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const claim = vi.fn();
vi.mock('../services/InboundIdempotencyService.js', () => ({ getInboundIdempotencyService: () => ({ claim }) }));
import { deduplicateWebhook } from './deduplication.js';

describe('deduplicateWebhook', () => {
  const next = vi.fn() as NextFunction;
  const response = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as unknown as Response;
  const request = { headers: { 'x-correlation-id': 'corr' }, body: { MessageSid: 'SM-1' } } as unknown as Request;
  beforeEach(() => vi.clearAllMocks());
  it('allows an atomically claimed message', async () => { claim.mockResolvedValue('new'); deduplicateWebhook(request, response, next); await vi.waitFor(() => expect(next).toHaveBeenCalledOnce()); });
  it('acknowledges a duplicate without processing it', async () => { claim.mockResolvedValue('duplicate'); deduplicateWebhook(request, response, next); await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(200)); expect(next).not.toHaveBeenCalled(); });
  it('fails closed when both shared stores are unavailable', async () => { claim.mockResolvedValue('unavailable'); deduplicateWebhook(request, response, next); await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(503)); expect(next).not.toHaveBeenCalled(); });
  it('fails closed when the provider message id is absent', () => { deduplicateWebhook({ ...request, body: {} } as Request, response, next); expect(response.status).toHaveBeenCalledWith(503); expect(next).not.toHaveBeenCalled(); });
});
