import { createHash } from 'node:crypto';
import type { CanonicalConversationEvent } from '../types/core.js';
import { PersistenceError } from '../storage/Persistence.js';
import { PostgresJourneyEventCheckpointRepository,
  type JourneyEventCheckpoint, type JourneyEventCheckpointRepository } from '../storage/JourneyEventCheckpointRepository.js';
import { getStateStore, type StateStore } from './StateStore.js';

const CACHE_TTL_SECONDS = 24 * 60 * 60;

/** PostgreSQL is authoritative; Redis holds the latest event processed at ingress. */
export class JourneyEventCheckpointService {
  constructor(
    private readonly repository: JourneyEventCheckpointRepository = new PostgresJourneyEventCheckpointRepository(),
    private readonly store: StateStore = getStateStore()
  ) {}

  async accept(event: CanonicalConversationEvent): Promise<boolean> {
    if (!event.sessionId) throw new PersistenceError();
    const checkpoint = project(event);
    let accepted: boolean | void;
    try { accepted = await this.repository.saveAccepted(checkpoint, auditPayload(event.payload), event.metadata); }
    catch { throw new PersistenceError(); }
    if (accepted === false) return false;
    const latest = await this.repository.findByUserId(event.userId).catch(() => null);
    if (latest) await this.store.setJson(this.key(event.userId), { ...latest,
      lastProcessedEventId: latest.eventId }, CACHE_TTL_SECONDS).catch(() => undefined);
    return true;
  }

  async recover(userId: string): Promise<JourneyEventCheckpoint | null> {
    let checkpoint: JourneyEventCheckpoint | null;
    try { checkpoint = await this.repository.findByUserId(userId); }
    catch { throw new PersistenceError(); }
    if (checkpoint) await this.store.setJson(this.key(userId), { ...checkpoint,
      lastProcessedEventId: checkpoint.eventId }, CACHE_TTL_SECONDS).catch(() => undefined);
    return checkpoint;
  }

  private key(userId: string): string {
    return `journey:last-accepted:${createHash('sha256').update(userId).digest('hex')}`;
  }
}

function project(event: CanonicalConversationEvent): JourneyEventCheckpoint {
  const { eventId, sourceEventId, idempotencyKey, correlationId, userId, channel, eventType,
    conversationId, sessionId, workflowId, expectedStateVersion, stateVersion, contextId,
    occurredAt, receivedAt } = event;
  return { eventId, sourceEventId, idempotencyKey, correlationId, userId, channel, eventType,
    conversationId, sessionId, workflowId, expectedStateVersion, stateVersion, contextId,
    occurredAt, receivedAt };
}

function auditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const content = payload.content;
  if (!content || typeof content !== 'object') return { ...payload };
  const safe = { ...(content as Record<string, unknown>) };
  if ('audioUrl' in safe) safe.audioUrl = '[redacted media URL]';
  if ('mediaUrl' in safe) safe.mediaUrl = '[redacted media URL]';
  return { ...payload, content: safe };
}
