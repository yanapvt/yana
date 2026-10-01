import { pool } from '../../db/connection.js';
import type { AgentQueueNotifier } from './NearBookingHandoffService.js';

/** Writes minimal queue work items; an authenticated operator worker consumes them. */
export class PostgresAgentQueueNotifier implements AgentQueueNotifier {
  readonly capabilities: { queueNotification: boolean };

  constructor(enabled: boolean) {
    this.capabilities = { queueNotification: enabled };
  }

  async notify(input: { handoffId: string; queueName: string; correlationId: string }): Promise<void> {
    await this.enqueue('human_handoff_requested', input);
  }

  async escalate(input: { handoffId: string; queueName: string; correlationId: string }): Promise<void> {
    await this.enqueue('human_handoff_sla_escalation', input);
  }

  private async enqueue(
    type: 'human_handoff_requested' | 'human_handoff_sla_escalation',
    input: { handoffId: string; queueName: string; correlationId: string }
  ): Promise<void> {
    if (!this.capabilities.queueNotification) throw new Error('Agent queue notification is disabled');
    await pool.query(
      `INSERT INTO notifications
        (user_id,session_id,notification_type,scheduled_at,status,content,metadata)
       SELECT user_id,session_id,$2,NOW(),'scheduled',$3,$4
       FROM human_handoffs WHERE handoff_id=$1
       ON CONFLICT DO NOTHING RETURNING notification_id`,
      [input.handoffId, type, JSON.stringify({ handoffId: input.handoffId, queueName: input.queueName }),
        JSON.stringify({ correlationId: input.correlationId })]
    );
  }
}
