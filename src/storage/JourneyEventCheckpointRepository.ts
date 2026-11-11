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
