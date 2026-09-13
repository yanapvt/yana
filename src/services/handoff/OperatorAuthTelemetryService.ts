import { pool } from '../../db/connection.js';
export type AuthEvent = 'login'|'logout'|'session_rejected'|'oidc_callback';
export class OperatorAuthTelemetryService {
  constructor(private readonly retentionDays:number) {}
  async record(input:{correlationId:string;operatorId?:string;event:AuthEvent;outcome:'success'|'failure';method:'local'|'oidc'|'session';reasonCode?:string}) {
    await pool.query(`INSERT INTO operator_auth_events(correlation_id,operator_id,event_type,outcome,auth_method,reason_code) VALUES($1,$2,$3,$4,$5,$6)`,[input.correlationId,input.operatorId??null,input.event,input.outcome,input.method,input.reasonCode??null]);
    await this.enforceRetention();
  }
  async enforceRetention(now=new Date()) { const result=await pool.query(`DELETE FROM operator_auth_events WHERE created_at<$1-($2*INTERVAL '1 day')`,[now,this.retentionDays]); return result.rowCount??0; }
}
