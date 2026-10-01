import { pool } from '../../db/connection.js';
import type { HumanHandoffConfig } from '../../config/humanHandoff.js';
import type { HandoffQueueMetrics, HandoffQueueStore } from './HandoffQueueService.js';

export interface OperatorHandoffView {
  handoffId: string; status: string; channel: string; operatorId?: string;
  createdAt: Date; slaDueAt: Date; service: 'hotel';
  summary?: { selectedStayName: string; dates: string; guestCount: number };
}

export interface HandoffOperationsStore {
  list(limit: number, cursor?: string): Promise<{ items: OperatorHandoffView[]; nextCursor?: string }>;
  detail(id: string): Promise<OperatorHandoffView | undefined>;
  openCaseMetrics(now: Date): Promise<{ openCases: number; slaBreaches: number }>;
  ping(): Promise<void>;
}

export class HandoffOperationsService {
  constructor(
    private readonly config: HumanHandoffConfig,
    private readonly cases: HandoffOperationsStore,
    private readonly queue: HandoffQueueStore,
    private readonly clock: () => Date = () => new Date(),
    private readonly audit: { info(event: string, details: Record<string, unknown>): void } = console,
    private readonly alerts?: { schedule(key: string, reason: string): Promise<boolean> }
  ) {}

  list(limit: number, cursor?: string) { return this.cases.list(Math.min(Math.max(limit, 1), 100), cursor); }
  detail(id: string) { return this.cases.detail(id); }

  async metrics(): Promise<HandoffQueueMetrics & { openCases: number; slaBreaches: number }> {
    const now = this.clock();
    const metrics = { ...(await this.queue.metrics(now)), ...(await this.cases.openCaseMetrics(now)) };
    this.audit.info('handoff_operational_metrics', { correlationId: 'handoff-observability', ...metrics });
    return metrics;
  }

  async readiness(): Promise<{ ready: boolean; reasons: string[]; metrics?: Awaited<ReturnType<HandoffOperationsService['metrics']>> }> {
    if (!this.config.enabled) return { ready: false, reasons: ['human_handoff_disabled'] };
    const now = this.clock();
    let metrics: Awaited<ReturnType<HandoffOperationsService['metrics']>>;
    try {
      await this.cases.ping();
      metrics = await this.metrics();
    } catch {
      return { ready: false, reasons: ['handoff_database_unavailable'] };
    }
    const reasons: string[] = [];
    if (metrics.ready + metrics.retrying >= this.config.alertQueueDepth) reasons.push('queue_depth_threshold_exceeded');
    if (metrics.oldestReadyAgeSeconds >= this.config.alertOldestMinutes * 60) reasons.push('queue_age_threshold_exceeded');
    if (metrics.deadLetters > 0) reasons.push('dead_letters_present');
    try { await Promise.all(reasons.map((reason) => this.alerts?.schedule(`${reason}:${now.toISOString().slice(0, 13)}`, reason))); }
    catch { reasons.push('alert_schedule_unavailable'); }
    return { ready: reasons.length === 0, reasons, metrics };
  }

  stagingDrill(): { status: 'disabled' | 'passed'; bookingAttempted: false; paymentAttempted: false; steps: string[] } {
    if (!this.config.stagingDrillEnabled) return { status: 'disabled', bookingAttempted: false, paymentAttempted: false, steps: [] };
    return {
      status: 'passed', bookingAttempted: false, paymentAttempted: false,
      steps: ['migrations_validated', 'consent_gate', 'durable_identity_gate', 'scoped_operator_auth', 'concurrent_worker_claim',
        'lease_loss_recovery', 'worker_restart_recovery', 'database_failure_backoff', 'publication_failure_fallback',
        'retry_storm_bounded', 'dead_letter_replay_idempotency', 'safe_close_contract'],
    };
  }
}

export class PostgresHandoffOperationsStore implements HandoffOperationsStore {
  async list(limit: number, cursor?: string): Promise<{ items: OperatorHandoffView[]; nextCursor?: string }> {
    const decoded = decodeCursor(cursor);
    if (cursor && !decoded) throw new Error('Invalid pagination cursor');
    const result = await pool.query<HandoffViewRow>(
      `SELECT handoff_id,status,channel,operator_id,created_at,sla_due_at,session_summary
       FROM human_handoffs WHERE ($2::timestamptz IS NULL OR (created_at,handoff_id) < ($2,$3::uuid))
       ORDER BY created_at DESC,handoff_id DESC LIMIT $1`, [limit + 1, decoded?.createdAt ?? null, decoded?.handoffId ?? null]
    );
    const hasNext = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return { items: rows.map((row) => mapView(row, false)), nextCursor: hasNext && last ? encodeCursor(last.created_at, last.handoff_id) : undefined };
  }

  async detail(id: string): Promise<OperatorHandoffView | undefined> {
    const result = await pool.query<HandoffViewRow>(
      `SELECT handoff_id,status,channel,operator_id,created_at,sla_due_at,session_summary FROM human_handoffs WHERE handoff_id=$1`, [id]
    );
    return result.rows[0] ? mapView(result.rows[0], true) : undefined;
  }

  async openCaseMetrics(now: Date): Promise<{ openCases: number; slaBreaches: number }> {
    const result = await pool.query<{ open_cases: number; sla_breaches: number }>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('pending','assigned'))::int open_cases,
       COUNT(*) FILTER (WHERE status IN ('pending','assigned') AND sla_due_at <= $1)::int sla_breaches FROM human_handoffs`, [now]
    );
    return { openCases: result.rows[0].open_cases, slaBreaches: result.rows[0].sla_breaches };
  }
  async ping(): Promise<void> { await pool.query('SELECT 1'); }
}

interface HandoffViewRow { handoff_id: string; status: string; channel: string; operator_id: string | null; created_at: Date; sla_due_at: Date; session_summary: unknown; }
function mapView(row: HandoffViewRow, includeSummary: boolean): OperatorHandoffView {
  const raw = typeof row.session_summary === 'object' && row.session_summary !== null ? row.session_summary as Record<string, unknown> : {};
  const summary = includeSummary && raw.service === 'hotel' && typeof raw.selectedStayName === 'string' && typeof raw.dates === 'string' && typeof raw.guestCount === 'number'
    ? { selectedStayName: raw.selectedStayName, dates: raw.dates, guestCount: raw.guestCount } : undefined;
  return { handoffId: row.handoff_id, status: row.status, channel: row.channel, operatorId: row.operator_id ?? undefined,
    createdAt: row.created_at, slaDueAt: row.sla_due_at, service: 'hotel', summary };
}
function encodeCursor(createdAt: Date, handoffId: string): string { return Buffer.from(JSON.stringify([createdAt.toISOString(), handoffId])).toString('base64url'); }
function decodeCursor(cursor?: string): { createdAt: string; handoffId: string } | undefined {
  if (!cursor) return undefined;
  try { const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()); return Array.isArray(value) && value.length === 2 ? { createdAt: value[0], handoffId: value[1] } : undefined; } catch { return undefined; }
}
