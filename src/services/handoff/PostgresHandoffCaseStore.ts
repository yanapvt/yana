import { pool } from '../../db/connection.js';
import type { HandoffCase, HandoffCaseStore, HandoffChannel, HandoffStatus, NearBookingHandoffRequest } from './NearBookingHandoffService.js';

interface HandoffRow {
  handoff_id: string; session_id: string; status: HandoffStatus; channel: HandoffChannel;
  created_at: Date; sla_due_at: Date; operator_id: string | null;
  correlation_id: string;
}

const RETURNING = 'handoff_id, session_id, status, channel, created_at, sla_due_at, operator_id, correlation_id';

export class PostgresHandoffCaseStore implements HandoffCaseStore {
  async createOrGetOpenCase(input: Omit<HandoffCase, 'handoffId' | 'createdAt'> & {
    userId: string; correlationId: string; summary: NearBookingHandoffRequest['summary'];
  }): Promise<{ case: HandoffCase; created: boolean }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.sessionId]);
      const existing = await client.query<HandoffRow>(
        `SELECT ${RETURNING} FROM human_handoffs WHERE session_id=$1 AND status IN ('pending','assigned') ORDER BY created_at DESC LIMIT 1`,
        [input.sessionId]
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { case: mapRow(existing.rows[0]), created: false };
      }
      const inserted = await client.query<HandoffRow>(
        `INSERT INTO human_handoffs
          (session_id,user_id,correlation_id,triggering_condition,session_summary,status,channel,sla_due_at)
         VALUES ($1,$2,$3,'traveler_requested_near_booking_handoff',$4,$5,$6,$7)
         RETURNING ${RETURNING}`,
        [input.sessionId, input.userId, input.correlationId, JSON.stringify(input.summary), input.status, input.channel, input.slaDueAt]
      );
      await client.query('COMMIT');
      return { case: mapRow(inserted.rows[0]), created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<HandoffCase | undefined> {
    const result = await pool.query<HandoffRow>(`SELECT ${RETURNING} FROM human_handoffs WHERE handoff_id=$1`, [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async updateChannel(id: string, channel: HandoffChannel): Promise<HandoffCase> {
    return this.update(id, 'channel', channel);
  }

  async updateStatus(id: string, status: HandoffStatus): Promise<HandoffCase> {
    const result = await pool.query<HandoffRow>(
      `UPDATE human_handoffs
       SET status=$2,
           resolved_at=CASE WHEN $2 IN ('resolved','cancelled') THEN NOW() ELSE resolved_at END
       WHERE handoff_id=$1 RETURNING ${RETURNING}`,
      [id, status]
    );
    if (!result.rows[0]) throw new Error('Handoff not found');
    return mapRow(result.rows[0]);
  }

  async assign(id: string, operatorId: string): Promise<HandoffCase> {
    const result = await pool.query<HandoffRow>(
      `UPDATE human_handoffs SET operator_id=$2,status='assigned',assigned_at=NOW()
       WHERE handoff_id=$1 AND status='pending' RETURNING ${RETURNING}`, [id, operatorId]
    );
    if (!result.rows[0]) throw new Error('Handoff is unavailable for assignment');
    return mapRow(result.rows[0]);
  }

  async findOverdue(now: Date, limit: number): Promise<HandoffCase[]> {
    const result = await pool.query<HandoffRow>(
      `SELECT ${RETURNING} FROM human_handoffs
       WHERE status IN ('pending','assigned') AND sla_due_at <= $1 ORDER BY sla_due_at LIMIT $2`, [now, limit]
    );
    return result.rows.map(mapRow);
  }

  private async update(id: string, column: 'channel', value: HandoffChannel): Promise<HandoffCase> {
    const result = await pool.query<HandoffRow>(
      `UPDATE human_handoffs SET ${column}=$2 WHERE handoff_id=$1 RETURNING ${RETURNING}`, [id, value]
    );
    if (!result.rows[0]) throw new Error('Handoff not found');
    return mapRow(result.rows[0]);
  }
}

function mapRow(row: HandoffRow): HandoffCase {
  return { handoffId: row.handoff_id, sessionId: row.session_id, status: row.status, channel: row.channel,
    createdAt: row.created_at, slaDueAt: row.sla_due_at, operatorId: row.operator_id ?? undefined,
    correlationId: row.correlation_id };
}
