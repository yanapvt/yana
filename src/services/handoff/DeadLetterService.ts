import { pool } from '../../db/connection.js';

export interface DeadLetterView { notificationId: string; handoffId: string; type: string; attemptCount: number; errorCode?: string; deadLetteredAt: Date; replayCount: number; }
export interface DeadLetterStore {
  list(limit: number, actorId: string): Promise<DeadLetterView[]>;
  replay(notificationId: string, actorId: string, now: Date): Promise<boolean>;
}
export class DeadLetterService {
  constructor(private readonly store: DeadLetterStore, private readonly clock: () => Date = () => new Date()) {}
  list(limit: number, actorId: string) { return this.store.list(Math.min(Math.max(limit, 1), 100), actorId); }
  replay(id: string, actorId: string) { return this.store.replay(id, actorId, this.clock()); }
}
export class PostgresDeadLetterStore implements DeadLetterStore {
  async list(limit: number, actorId: string): Promise<DeadLetterView[]> {
    const result = await pool.query<any>(`SELECT notification_id,content->>'handoffId' handoff_id,notification_type,attempt_count,last_error_code,dead_lettered_at,replay_count
      FROM notifications WHERE status='dead_letter' AND notification_type IN ('human_handoff_requested','human_handoff_sla_escalation') ORDER BY dead_lettered_at DESC LIMIT $1`, [limit]);
    await pool.query(`INSERT INTO audit_logs(correlation_id,action_type,execution_status,metadata) VALUES($1,'handoff_dead_letter_inspected','success',jsonb_build_object('actorId',$1::text,'count',$2::int))`, [actorId, result.rows.length]);
    return result.rows.map((r: any) => ({ notificationId: r.notification_id, handoffId: r.handoff_id, type: r.notification_type, attemptCount: r.attempt_count,
      errorCode: r.last_error_code ?? undefined, deadLetteredAt: r.dead_lettered_at, replayCount: r.replay_count }));
  }
  async replay(id: string, actorId: string, now: Date): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`UPDATE notifications SET status='scheduled',next_attempt_at=$2,dead_lettered_at=NULL,last_error_code=NULL,replay_count=replay_count+1,replayed_at=$2,replayed_by=$3
        WHERE notification_id=$1 AND status='dead_letter' RETURNING notification_id`, [id, now, actorId]);
      if (result.rowCount === 1) await client.query(`INSERT INTO audit_logs(correlation_id,action_type,execution_status,metadata)
        SELECT notification_id,'handoff_dead_letter_replayed','success',jsonb_build_object('notificationId',notification_id,'actorId',$2::text)
        FROM notifications WHERE notification_id=$1`, [id, actorId]);
      await client.query('COMMIT'); return result.rowCount === 1;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
