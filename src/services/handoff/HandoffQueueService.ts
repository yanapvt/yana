import { pool } from '../../db/connection.js';

export type HandoffQueueEventType = 'human_handoff_requested' | 'human_handoff_sla_escalation';

export interface HandoffQueueItem {
  notificationId: string;
  handoffId: string;
  type: HandoffQueueEventType;
  correlationId: string;
  attemptCount: number;
  scheduledAt: Date;
  leaseOwner?: string;
  leaseExpiresAt?: Date;
}

export interface HandoffQueueMetrics {
  ready: number;
  processing: number;
  retrying: number;
  deadLetters: number;
  completed: number;
  oldestReadyAgeSeconds: number;
}

export interface HandoffQueueStore {
  leaseNext(workerId: string, now: Date, leaseSeconds: number): Promise<HandoffQueueItem | undefined>;
  complete(notificationId: string, workerId: string, now: Date): Promise<boolean>;
  retry(notificationId: string, workerId: string, nextAttemptAt: Date, errorCode: string): Promise<boolean>;
  deadLetter(notificationId: string, workerId: string, now: Date, errorCode: string): Promise<boolean>;
  metrics(now: Date): Promise<HandoffQueueMetrics>;
}

export interface HandoffQueueHandler {
  handle(item: HandoffQueueItem): Promise<void>;
}

export interface QueueAudit {
  info(event: string, details: Record<string, unknown>): void;
  error(event: string, details: Record<string, unknown>): void;
}

export class HandoffQueueService {
  constructor(
    private readonly store: HandoffQueueStore,
    private readonly handler: HandoffQueueHandler,
    private readonly options: { workerId: string; leaseSeconds: number; maxAttempts: number; backoffSeconds: number },
    private readonly clock: () => Date = () => new Date(),
    private readonly audit: QueueAudit = console
  ) {}

  async processOne(): Promise<'idle' | 'completed' | 'retry_scheduled' | 'dead_lettered'> {
    const now = this.clock();
    const item = await this.store.leaseNext(this.options.workerId, now, this.options.leaseSeconds);
    if (!item) return 'idle';
    const safe = { notificationId: item.notificationId, handoffId: item.handoffId, correlationId: item.correlationId, attempt: item.attemptCount };
    try {
      await this.handler.handle(item);
      if (!(await this.store.complete(item.notificationId, this.options.workerId, this.clock()))) return 'idle';
      this.audit.info('handoff_queue_completed', safe);
      return 'completed';
    } catch (error) {
      const errorCode = classifyError(error);
      if (item.attemptCount >= this.options.maxAttempts) {
        await this.store.deadLetter(item.notificationId, this.options.workerId, this.clock(), errorCode);
        this.audit.error('handoff_queue_dead_lettered', { ...safe, errorCode });
        return 'dead_lettered';
      }
      const delaySeconds = this.options.backoffSeconds * 2 ** Math.max(0, item.attemptCount - 1);
      const nextAttemptAt = new Date(this.clock().getTime() + delaySeconds * 1000);
      await this.store.retry(item.notificationId, this.options.workerId, nextAttemptAt, errorCode);
      this.audit.error('handoff_queue_retry_scheduled', { ...safe, errorCode, delaySeconds });
      return 'retry_scheduled';
    }
  }

  async getMetrics(): Promise<HandoffQueueMetrics> {
    return this.store.metrics(this.clock());
  }
}

export class PostgresHandoffQueueStore implements HandoffQueueStore {
  async leaseNext(workerId: string, now: Date, leaseSeconds: number): Promise<HandoffQueueItem | undefined> {
    const result = await pool.query<QueueRow>(
      `WITH candidate AS (
         SELECT notification_id FROM notifications
         WHERE notification_type IN ('human_handoff_requested','human_handoff_sla_escalation')
           AND ((status IN ('scheduled','failed') AND COALESCE(next_attempt_at,scheduled_at) <= $2)
             OR (status='processing' AND lease_expires_at <= $2))
         ORDER BY COALESCE(next_attempt_at,scheduled_at), created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE notifications n
       SET status='processing',lease_owner=$1,lease_expires_at=$2 + ($3 * INTERVAL '1 second'),attempt_count=attempt_count+1
       FROM candidate WHERE n.notification_id=candidate.notification_id
       RETURNING n.notification_id,n.notification_type,n.content,n.metadata,n.attempt_count,n.scheduled_at,n.lease_owner,n.lease_expires_at`,
      [workerId, now, leaseSeconds]
    );
    return result.rows[0] ? mapQueueRow(result.rows[0]) : undefined;
  }

  async complete(id: string, owner: string, now: Date): Promise<boolean> {
    return this.transition(id, owner,
      `status='sent',sent_at=$3,processed_at=$3,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL`, [now]);
  }

  async retry(id: string, owner: string, next: Date, code: string): Promise<boolean> {
    return this.transition(id, owner,
      `status='failed',next_attempt_at=$3,last_error_code=$4,lease_owner=NULL,lease_expires_at=NULL`, [next, code]);
  }

  async deadLetter(id: string, owner: string, now: Date, code: string): Promise<boolean> {
    return this.transition(id, owner,
      `status='dead_letter',dead_lettered_at=$3,last_error_code=$4,lease_owner=NULL,lease_expires_at=NULL`, [now, code]);
  }

  async metrics(now: Date): Promise<HandoffQueueMetrics> {
    const result = await pool.query<MetricRow>(
      `SELECT
         COUNT(*) FILTER (WHERE (status='scheduled' AND COALESCE(next_attempt_at,scheduled_at) <= $1)
           OR (status='processing' AND lease_expires_at <= $1))::int AS ready,
         COUNT(*) FILTER (WHERE status='processing' AND lease_expires_at > $1)::int AS processing,
         COUNT(*) FILTER (WHERE status='failed')::int AS retrying,
         COUNT(*) FILTER (WHERE status='dead_letter')::int AS dead_letters,
         COUNT(*) FILTER (WHERE status='sent')::int AS completed,
         COALESCE(EXTRACT(EPOCH FROM ($1 - MIN(scheduled_at) FILTER (WHERE status IN ('scheduled','failed') OR (status='processing' AND lease_expires_at <= $1)))),0)::float AS oldest_ready_age_seconds
       FROM notifications WHERE notification_type IN ('human_handoff_requested','human_handoff_sla_escalation')`, [now]
    );
    const row = result.rows[0];
    return { ready: row.ready, processing: row.processing, retrying: row.retrying, deadLetters: row.dead_letters,
      completed: row.completed, oldestReadyAgeSeconds: Math.max(0, row.oldest_ready_age_seconds) };
  }

  private async transition(id: string, owner: string, setClause: string, values: unknown[]): Promise<boolean> {
    const result = await pool.query(
      `UPDATE notifications SET ${setClause} WHERE notification_id=$1 AND status='processing' AND lease_owner=$2 RETURNING notification_id`,
      [id, owner, ...values]
    );
    return result.rowCount === 1;
  }
}

interface QueueRow {
  notification_id: string; notification_type: HandoffQueueEventType; content: unknown; metadata: unknown;
  attempt_count: number; scheduled_at: Date; lease_owner: string | null; lease_expires_at: Date | null;
}
interface MetricRow { ready: number; processing: number; retrying: number; dead_letters: number; completed: number; oldest_ready_age_seconds: number; }

function mapQueueRow(row: QueueRow): HandoffQueueItem {
  const content = record(row.content); const metadata = record(row.metadata);
  return {
    notificationId: row.notification_id,
    handoffId: typeof content.handoffId === 'string' ? content.handoffId : '',
    type: row.notification_type,
    correlationId: typeof metadata.correlationId === 'string' ? metadata.correlationId : row.notification_id,
    attemptCount: row.attempt_count,
    scheduledAt: row.scheduled_at,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
  };
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function classifyError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'HANDLER_FAILED';
  return /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'HANDLER_FAILED';
}
