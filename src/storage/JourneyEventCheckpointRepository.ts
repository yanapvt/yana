import { pool } from '../db/connection.js';
import type { CanonicalConversationEvent } from '../types/core.js';

export type JourneyEventCheckpoint = Pick<CanonicalConversationEvent,
  'eventId' | 'sourceEventId' | 'idempotencyKey' | 'correlationId' | 'userId' |
  'channel' | 'eventType' | 'conversationId' | 'sessionId' | 'workflowId' |
  'expectedStateVersion' | 'stateVersion' | 'contextId' |
  'occurredAt' | 'receivedAt'>;

export interface JourneyEventCheckpointRepository {
  saveAccepted(event: JourneyEventCheckpoint, payload?: Record<string, unknown>,
    metadata?: CanonicalConversationEvent['metadata']): Promise<boolean | void>;
  findByUserId(userId: string): Promise<JourneyEventCheckpoint | null>;
}

export interface ConversationContinuation {
  topic: string | null;
  pendingQuestion: { text: string; expectedAnswerType?: string; workflowId?: string;
    remaining?: Array<{ text: string; expectedAnswerType?: string }> } | null;
  outboundQuestion?: { eventId: string; question: NonNullable<ConversationContinuation['pendingQuestion']>;
    status: 'attempted' | 'provider_accepted' | 'sent' | 'delivered' | 'failed';
    providerMessageId?: string; priorQuestion?: ConversationContinuation['pendingQuestion'] } | null;
  revision: number;
  generation: number;
  eventId: string | null;
}

export interface ConversationContinuationRepository {
  find(userId: string, conversationId: string): Promise<ConversationContinuation | null>;
  save(userId: string, conversationId: string, acceptedEventId: string,
    state: Pick<ConversationContinuation, 'topic' | 'pendingQuestion' | 'outboundQuestion'>,
    advanceGeneration: boolean): Promise<ConversationContinuation | null>;
  updateOutbound(userId: string, conversationId: string, eventId: string,
    status: NonNullable<ConversationContinuation['outboundQuestion']>['status'],
    providerMessageId?: string): Promise<ConversationContinuation | null>;
  updateOutboundByProviderId(providerMessageId: string,
    status: 'sent' | 'delivered' | 'failed'): Promise<{ userId: string; state: ConversationContinuation } | null>;
}

/** Extends the existing accepted-event checkpoint; no second session store. */
export class PostgresConversationContinuationRepository implements ConversationContinuationRepository {
  async find(userId: string, conversationId: string): Promise<ConversationContinuation | null> {
    const result = await pool.query<{
      conversation_topic: string | null; pending_question: ConversationContinuation['pendingQuestion'];
      outbound_question: ConversationContinuation['outboundQuestion'];
      conversation_revision: number; conversation_generation: number;
      conversation_state_event_id: string | null;
    }>(`SELECT conversation_topic,pending_question,outbound_question,conversation_revision,
        conversation_generation,conversation_state_event_id
        FROM journey_event_checkpoints WHERE user_key=$1 AND conversation_id=$2`,
    [userId, conversationId]);
    return result.rows[0] ? continuationFromRow(result.rows[0]) : null;
  }

  async save(userId: string, conversationId: string, acceptedEventId: string,
    state: Pick<ConversationContinuation, 'topic' | 'pendingQuestion' | 'outboundQuestion'>,
    advanceGeneration: boolean): Promise<ConversationContinuation | null> {
    const result = await pool.query<{
      conversation_topic: string | null; pending_question: ConversationContinuation['pendingQuestion'];
      outbound_question: ConversationContinuation['outboundQuestion'];
      conversation_revision: number; conversation_generation: number;
      conversation_state_event_id: string | null;
    }>(`UPDATE journey_event_checkpoints SET conversation_topic=$4,pending_question=$5::jsonb,
        outbound_question=$7::jsonb,
        conversation_revision=conversation_revision+1,
        conversation_generation=conversation_generation+CASE WHEN $6 THEN 1 ELSE 0 END,
        conversation_state_event_id=$3
        WHERE user_key=$1 AND conversation_id=$2 AND event_id=$3
         RETURNING conversation_topic,pending_question,outbound_question,conversation_revision,
          conversation_generation,conversation_state_event_id`,
    [userId, conversationId, acceptedEventId, state.topic,
      state.pendingQuestion ? JSON.stringify(state.pendingQuestion) : null, advanceGeneration,
      state.outboundQuestion ? JSON.stringify(state.outboundQuestion) : null]);
    return result.rows[0] ? continuationFromRow(result.rows[0]) : null;
  }
  async updateOutbound(userId: string, conversationId: string, eventId: string,
    status: NonNullable<ConversationContinuation['outboundQuestion']>['status'],
    providerMessageId?: string): Promise<ConversationContinuation | null> {
    const result = await pool.query<{
      conversation_topic: string | null; pending_question: ConversationContinuation['pendingQuestion'];
      outbound_question: ConversationContinuation['outboundQuestion']; conversation_revision: number;
      conversation_generation: number; conversation_state_event_id: string | null;
    }>(`UPDATE journey_event_checkpoints SET
      pending_question=CASE WHEN $4='failed' AND pending_question=outbound_question->'question'
        THEN outbound_question->'priorQuestion'
        WHEN event_id=$3::uuid AND $4 IN ('provider_accepted','sent','delivered')
        THEN outbound_question->'question' ELSE pending_question END,
      outbound_question=jsonb_set(jsonb_set(outbound_question,'{status}',to_jsonb($4::text)),
        '{providerMessageId}',to_jsonb(COALESCE($5::text,outbound_question->>'providerMessageId'))),
      conversation_revision=conversation_revision+1
      WHERE user_key=$1 AND conversation_id=$2 AND outbound_question->>'eventId'=$3
        AND (outbound_question->>'status'='attempted'
          OR outbound_question->>'status'='provider_accepted' AND $4 IN ('sent','delivered','failed')
          OR outbound_question->>'status'='sent' AND $4 IN ('delivered','failed'))
      RETURNING conversation_topic,pending_question,outbound_question,conversation_revision,
        conversation_generation,conversation_state_event_id`,
    [userId, conversationId, eventId, status, providerMessageId ?? null]);
    return result.rows[0] ? continuationFromRow(result.rows[0]) : null;
  }
  async updateOutboundByProviderId(providerMessageId: string,
    status: 'sent' | 'delivered' | 'failed'): Promise<{ userId: string; state: ConversationContinuation } | null> {
    const result = await pool.query<{
      user_key: string; conversation_topic: string | null;
      pending_question: ConversationContinuation['pendingQuestion'];
      outbound_question: ConversationContinuation['outboundQuestion']; conversation_revision: number;
      conversation_generation: number; conversation_state_event_id: string | null;
    }>(`UPDATE journey_event_checkpoints SET
      pending_question=CASE WHEN $2='failed' AND pending_question=outbound_question->'question'
        THEN outbound_question->'priorQuestion' ELSE pending_question END,
      outbound_question=jsonb_set(outbound_question,'{status}',to_jsonb($2::text)),
      conversation_revision=conversation_revision+1
      WHERE outbound_question->>'providerMessageId'=$1
        AND (outbound_question->>'status'='provider_accepted' AND $2 IN ('sent','delivered','failed')
          OR outbound_question->>'status'='sent' AND $2 IN ('delivered','failed'))
      RETURNING user_key,conversation_topic,pending_question,outbound_question,conversation_revision,
        conversation_generation,conversation_state_event_id`, [providerMessageId, status]);
    return result.rows[0] ? { userId: result.rows[0].user_key,
      state: continuationFromRow(result.rows[0]) } : null;
  }
}

function continuationFromRow(row: {
  conversation_topic: string | null; pending_question: ConversationContinuation['pendingQuestion'];
  outbound_question?: ConversationContinuation['outboundQuestion'];
  conversation_revision: number; conversation_generation: number;
  conversation_state_event_id: string | null;
}): ConversationContinuation {
  return { topic: row.conversation_topic, pendingQuestion: row.pending_question,
    outboundQuestion: row.outbound_question ?? null,
    revision: row.conversation_revision, generation: row.conversation_generation,
    eventId: row.conversation_state_event_id };
}

export class PostgresJourneyEventCheckpointRepository implements JourneyEventCheckpointRepository {
  async saveAccepted(event: JourneyEventCheckpoint, payload: Record<string, unknown> = {},
    metadata: CanonicalConversationEvent['metadata'] = {}): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ event_sequence: string }>(
        `INSERT INTO journey_inbound_events
         (event_id,user_key,source_event_id,idempotency_key,correlation_id,channel,event_type,
          conversation_id,session_id,workflow_id,expected_state_version,state_version,context_id,
          payload,metadata,occurred_at,received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT DO NOTHING RETURNING event_sequence`,
        [event.eventId, event.userId, event.sourceEventId, event.idempotencyKey,
          event.correlationId, event.channel, event.eventType, event.conversationId,
          event.sessionId, event.workflowId, event.expectedStateVersion, event.stateVersion,
          event.contextId, JSON.stringify(payload), JSON.stringify(metadata),
          event.occurredAt, event.receivedAt]
      );
      if (!inserted.rows[0]) { await client.query('ROLLBACK'); return false; }
      await client.query(
      `INSERT INTO journey_event_checkpoints
       (user_key,event_id,source_event_id,idempotency_key,correlation_id,channel,event_type,
        conversation_id,session_id,workflow_id,expected_state_version,state_version,context_id,
        occurred_at,received_at,last_sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (user_key) DO UPDATE SET
         event_id=EXCLUDED.event_id, source_event_id=EXCLUDED.source_event_id,
         idempotency_key=EXCLUDED.idempotency_key, correlation_id=EXCLUDED.correlation_id,
         channel=EXCLUDED.channel, event_type=EXCLUDED.event_type,
         conversation_id=EXCLUDED.conversation_id, session_id=EXCLUDED.session_id,
         workflow_id=EXCLUDED.workflow_id, expected_state_version=EXCLUDED.expected_state_version,
         state_version=EXCLUDED.state_version, context_id=EXCLUDED.context_id,
         occurred_at=EXCLUDED.occurred_at, received_at=EXCLUDED.received_at,
         last_sequence=EXCLUDED.last_sequence, accepted_at=NOW()
       WHERE journey_event_checkpoints.last_sequence < EXCLUDED.last_sequence`,
      [event.userId, event.eventId, event.sourceEventId, event.idempotencyKey,
        event.correlationId, event.channel, event.eventType, event.conversationId,
        event.sessionId, event.workflowId, event.expectedStateVersion, event.stateVersion,
        event.contextId, event.occurredAt, event.receivedAt, inserted.rows[0].event_sequence]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async findByUserId(userId: string): Promise<JourneyEventCheckpoint | null> {
    const result = await pool.query<{
      event_id: string; source_event_id: string; idempotency_key: string; correlation_id: string;
      channel: JourneyEventCheckpoint['channel']; event_type: JourneyEventCheckpoint['eventType'];
      conversation_id: string; session_id: string; workflow_id: string | null;
      expected_state_version: number | null; state_version: number | null; context_id: string | null;
      occurred_at: Date; received_at: Date;
    }>(`SELECT event_id,source_event_id,idempotency_key,correlation_id,channel,event_type,
        conversation_id,session_id,workflow_id,expected_state_version,state_version,context_id,occurred_at,received_at
        FROM journey_event_checkpoints WHERE user_key=$1`, [userId]);
    const row = result.rows[0];
    return row ? { userId, eventId: row.event_id, sourceEventId: row.source_event_id,
      idempotencyKey: row.idempotency_key.trim(), correlationId: row.correlation_id,
      channel: row.channel, eventType: row.event_type, conversationId: row.conversation_id,
      sessionId: row.session_id, workflowId: row.workflow_id,
      expectedStateVersion: row.expected_state_version, stateVersion: row.state_version,
      contextId: row.context_id,
      occurredAt: row.occurred_at, receivedAt: row.received_at } : null;
  }
}
