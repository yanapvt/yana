import { pool } from '../../db/connection.js';

export interface AlertAdapter { deliver(alert: { alertId: string; reason: string }): Promise<void>; }
export interface AlertStore {
  schedule(key: string, reason: string): Promise<boolean>;
  claim(now: Date): Promise<{ alertId: string; reason: string; attemptCount: number } | undefined>;
  complete(id: string, now: Date): Promise<void>;
  retry(id: string, next: Date, code: string): Promise<void>;
}
export class HandoffAlertService {
  constructor(private readonly enabled: boolean, private readonly store: AlertStore, private readonly adapter: AlertAdapter,
    private readonly backoffSeconds = 30, private readonly clock: () => Date = () => new Date()) {}
  schedule(key: string, reason: string) { return this.enabled ? this.store.schedule(key, reason) : Promise.resolve(false); }
  async processOne(): Promise<'disabled'|'idle'|'delivered'|'retry_scheduled'> {
    if (!this.enabled) return 'disabled';
    const item = await this.store.claim(this.clock()); if (!item) return 'idle';
    try { await this.adapter.deliver({ alertId: item.alertId, reason: item.reason }); await this.store.complete(item.alertId, this.clock()); return 'delivered'; }
    catch (error) { const code = safeCode(error); const delay = this.backoffSeconds * 2 ** Math.min(item.attemptCount, 8); await this.store.retry(item.alertId, new Date(this.clock().getTime() + delay * 1000), code); return 'retry_scheduled'; }
  }
}
export class HttpAlertAdapter implements AlertAdapter {
  constructor(private readonly endpoint: string, private readonly token?: string, private readonly request: typeof fetch = fetch) {}
  async deliver(alert: { alertId: string; reason: string }): Promise<void> {
    const response = await this.request(this.endpoint, { method: 'POST', headers: { 'content-type':'application/json','idempotency-key':alert.alertId,
      ...(this.token ? { authorization:`Bearer ${this.token}` } : {}) }, body: JSON.stringify(alert) });
    if (!response.ok) throw Object.assign(new Error('alert failed'), { code: 'ALERT_PROVIDER_FAILED' });
  }
}
export class PostgresAlertStore implements AlertStore {
  async schedule(key: string, reason: string): Promise<boolean> { const r=await pool.query(`INSERT INTO handoff_operational_alerts(alert_key,reason) VALUES($1,$2) ON CONFLICT(alert_key) DO NOTHING RETURNING alert_id`,[key,reason]); return r.rowCount===1; }
  async claim(now: Date) { const r=await pool.query<any>(`UPDATE handoff_operational_alerts SET status='processing',attempt_count=attempt_count+1,lease_expires_at=$1+INTERVAL '60 seconds',updated_at=$1 WHERE alert_id=(SELECT alert_id FROM handoff_operational_alerts WHERE ((status IN ('scheduled','failed') AND next_attempt_at<=$1) OR (status='processing' AND lease_expires_at<=$1)) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING alert_id,reason,attempt_count`,[now]); const x=r.rows[0]; return x?{alertId:x.alert_id,reason:x.reason,attemptCount:x.attempt_count}:undefined; }
  async complete(id:string,now:Date){await pool.query(`UPDATE handoff_operational_alerts SET status='delivered',delivered_at=$2,lease_expires_at=NULL,updated_at=$2 WHERE alert_id=$1 AND status='processing'`,[id,now]);}
  async retry(id:string,next:Date,code:string){await pool.query(`UPDATE handoff_operational_alerts SET status='failed',next_attempt_at=$2,last_error_code=$3,lease_expires_at=NULL,updated_at=NOW() WHERE alert_id=$1 AND status='processing'`,[id,next,code]);}
}
function safeCode(error:unknown):string { const code=typeof error==='object'&&error!==null&&'code'in error?String((error as any).code):'ALERT_FAILED'; return /^[A-Z0-9_]{1,100}$/.test(code)?code:'ALERT_FAILED'; }
