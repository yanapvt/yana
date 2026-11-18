import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { normalizeInboundMessage } from '../utils/messageNormalizer.js';
import { createInboundConversationEvent } from '../orchestration/CanonicalConversationEvent.js';
import { FixtureStateStore } from '../tests/fixtures/sessionStorage.js';
import type { JourneyEventCheckpoint, JourneyEventCheckpointRepository } from '../storage/JourneyEventCheckpointRepository.js';
import { JourneyEventCheckpointService } from './JourneyEventCheckpointService.js';

const userId = 'whatsapp:+94770000001';
const cacheKey = `journey:last-accepted:${createHash('sha256').update(userId).digest('hex')}`;
function event() {
  return { ...createInboundConversationEvent(normalizeInboundMessage({ MessageSid: 'SM-checkpoint',
    From: userId, To: 'whatsapp:+14155238886', Body: 'Continue' }), 'correlation-checkpoint'),
    sessionId: 'session:journey-1' };
}

describe('accepted event checkpoint', () => {
  it('recovers the last accepted header from durable storage after Redis loss', async () => {
    const records = new Map<string, JourneyEventCheckpoint>();
    const repository: JourneyEventCheckpointRepository = {
      saveAccepted: async (checkpoint) => { records.set(checkpoint.userId, structuredClone(checkpoint)); },
      findByUserId: async (id) => structuredClone(records.get(id) ?? null),
    };
    const firstCache = new FixtureStateStore();
    const checkpoint = new JourneyEventCheckpointService(repository, firstCache as any);
    const accepted = event();
    await checkpoint.accept(accepted);
    expect(records.get(userId)).toMatchObject({ eventId: accepted.eventId,
      workflowId: null, sourceEventId: 'SM-checkpoint', correlationId: 'correlation-checkpoint' });
    expect(JSON.stringify(records.get(userId))).not.toContain('Continue');
    expect(await firstCache.getJson(cacheKey)).toMatchObject({ lastProcessedEventId: accepted.eventId });
    firstCache.clear();
    const restartedCache = new FixtureStateStore();
    const restored = await new JourneyEventCheckpointService(repository, restartedCache as any).recover(userId);
    expect(restored?.eventId).toBe(accepted.eventId);
    expect(await restartedCache.getJson(cacheKey)).toMatchObject({ lastProcessedEventId: accepted.eventId });
    expect(JSON.stringify(restored)).not.toContain('rawPayload');
  });

  it('keeps PostgreSQL authoritative when Redis cannot accept a projection', async () => {
    let durable: JourneyEventCheckpoint | null = null;
    const repository: JourneyEventCheckpointRepository = {
      saveAccepted: async (checkpoint) => { durable = checkpoint; },
      findByUserId: async () => durable,
    };
    const unavailable = new FixtureStateStore();
    unavailable.setJson = async () => { throw new Error('Redis unavailable'); };
    const checkpoint = new JourneyEventCheckpointService(repository, unavailable as any);
    await checkpoint.accept(event());
    expect((await checkpoint.recover(userId))?.eventId).toBe(durable!.eventId);
  });

  it('does not publish a cache marker when the durable acceptance write fails', async () => {
    const cache = new FixtureStateStore();
    const checkpoint = new JourneyEventCheckpointService({
      saveAccepted: async () => { throw new Error('PostgreSQL unavailable'); },
      findByUserId: async () => null,
    }, cache as any);
    await expect(checkpoint.accept(event())).rejects.toMatchObject({ status: 'failed' });
    expect(await cache.getJson(cacheKey)).toBeNull();
  });

  it('passes a redacted original payload to durable audit while caching only event headers', async () => {
    const cache = new FixtureStateStore();
    let auditedPayload: Record<string, unknown> | undefined;
    let auditedMetadata: Record<string, unknown> | undefined;
    let durable: JourneyEventCheckpoint | null = null;
    const checkpoint = new JourneyEventCheckpointService({
      saveAccepted: async (header, payload, metadata) => {
        durable = header;
        auditedPayload = payload;
        auditedMetadata = metadata;
      },
      findByUserId: async () => durable,
    }, cache as any);
    const accepted = { ...event(), payload: { content: { type: 'audio',
      audioUrl: 'https://provider.example/private-audio', contentType: 'audio/ogg' } },
      metadata: { inputType: 'voice' } };
    await checkpoint.accept(accepted);
    expect(auditedPayload).toEqual({ content: { type: 'audio',
      audioUrl: '[redacted media URL]', contentType: 'audio/ogg' } });
    expect(auditedMetadata).toEqual({ inputType: 'voice' });
    expect(await cache.getJson(cacheKey)).toMatchObject({
      eventId: accepted.eventId, correlationId: accepted.correlationId,
    });
    expect(JSON.stringify(await cache.getJson(cacheKey))).not.toContain('private-audio');
  });

  it('rejects a second delivery with the same stable idempotency key', async () => {
    const acceptedKeys = new Set<string>();
    const checkpoint = new JourneyEventCheckpointService({
      saveAccepted: async (header) => {
        if (acceptedKeys.has(header.idempotencyKey)) return false;
        acceptedKeys.add(header.idempotencyKey);
        return true;
      },
      findByUserId: async () => null,
    }, new FixtureStateStore() as any);
    const first = event();
    const redelivery = event();
    expect(first.eventId).not.toBe(redelivery.eventId);
    expect(first.idempotencyKey).toBe(redelivery.idempotencyKey);
    expect(await checkpoint.accept(first)).toBe(true);
    expect(await checkpoint.accept(redelivery)).toBe(false);
    expect(acceptedKeys.size).toBe(1);
  });
});
