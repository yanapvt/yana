/**
 * HumanHandoffRepository - Data access layer for human handoff entities
 * Handles human_handoffs table for operator escalations
 * Requirements: 13.1, 13.5, 16.2
 */

import { pool } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export interface HumanHandoff {
  handoffId: string;
  sessionId: string;
  userId: string;
  correlationId: string;
  triggeringCondition: string;
  operatorId?: string;
  sessionSummary: Record<string, unknown>;
  status: 'pending' | 'assigned' | 'resolved' | 'cancelled';
  createdAt: Date;
  assignedAt?: Date;
  resolvedAt?: Date;
}

export interface CreateHumanHandoffData {
  sessionId: string;
  userId: string;
  correlationId: string;
  triggeringCondition: string;
  sessionSummary: Record<string, unknown>;
  status?: 'pending' | 'assigned' | 'resolved' | 'cancelled';
}

// ============================================================================
// HumanHandoffRepository Class
// ============================================================================

export class HumanHandoffRepository {
  /**
   * Create a new human handoff record
   */
  async createHandoff(data: CreateHumanHandoffData): Promise<HumanHandoff> {
    const result = await pool.query<HumanHandoff>(
      `INSERT INTO human_handoffs (session_id, user_id, correlation_id, triggering_condition, session_summary, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING handoff_id, session_id, user_id, correlation_id, triggering_condition, operator_id, session_summary, status, created_at, assigned_at, resolved_at`,
      [
        data.sessionId,
        data.userId,
        data.correlationId,
        data.triggeringCondition,
        JSON.stringify(data.sessionSummary),
        data.status || 'pending',
      ]
    );

    return this.mapHandoff(result.rows[0]);
  }

  /**
   * Find handoff by ID
   */
  async findById(handoffId: string): Promise<HumanHandoff | null> {
    const result = await pool.query<HumanHandoff>(
      `SELECT handoff_id, session_id, user_id, correlation_id, triggering_condition, operator_id, session_summary, status, created_at, assigned_at, resolved_at
       FROM human_handoffs WHERE handoff_id = $1`,
      [handoffId]
    );

    return result.rows.length > 0 ? this.mapHandoff(result.rows[0]) : null;
  }

  /**
   * Find handoffs by session ID
   */
  async findBySessionId(sessionId: string): Promise<HumanHandoff[]> {
    const result = await pool.query<HumanHandoff>(
      `SELECT handoff_id, session_id, user_id, correlation_id, triggering_condition, operator_id, session_summary, status, created_at, assigned_at, resolved_at
       FROM human_handoffs
       WHERE session_id = $1
       ORDER BY created_at DESC`,
      [sessionId]
    );

    return result.rows.map((row) => this.mapHandoff(row));
  }

  /**
   * Find pending handoffs (for operator assignment)
   */
  async findPending(limit = 50): Promise<HumanHandoff[]> {
    const result = await pool.query<HumanHandoff>(
      `SELECT handoff_id, session_id, user_id, correlation_id, triggering_condition, operator_id, session_summary, status, created_at, assigned_at, resolved_at
       FROM human_handoffs
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => this.mapHandoff(row));
  }

  /**
   * Assign handoff to operator
   */
  async assignToOperator(handoffId: string, operatorId: string): Promise<HumanHandoff> {
    const result = await pool.query<HumanHandoff>(
      `UPDATE human_handoffs
       SET operator_id = $1, status = 'assigned', assigned_at = NOW()
       WHERE handoff_id = $2
       RETURNING handoff_id, session_id, user_id, correlation_id, triggering_condition, operator_id, session_summary, status, created_at, assigned_at, resolved_at`,
      [operatorId, handoffId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    return this.mapHandoff(result.rows[0]);
  }

  /**
   * Resolve handoff
   */
  async resolveHandoff(handoffId: string): Promise<HumanHandoff> {
    const result = await pool.query<HumanHandoff>(
      `UPDATE human_handoffs
       SET status = 'resolved', resolved_at = NOW()
       WHERE handoff_id = $1
       RETURNING handoff_id, session_id, user_id, correlation_id, triggering_condition, operator_id, session_summary, status, created_at, assigned_at, resolved_at`,
      [handoffId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    return this.mapHandoff(result.rows[0]);
  }

  /**
   * Cancel handoff
   */
  async cancelHandoff(handoffId: string): Promise<HumanHandoff> {
    const result = await pool.query<HumanHandoff>(
      `UPDATE human_handoffs
       SET status = 'cancelled'
       WHERE handoff_id = $1
       RETURNING handoff_id, session_id, user_id, correlation_id, triggering_condition, operator_id, session_summary, status, created_at, assigned_at, resolved_at`,
      [handoffId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    return this.mapHandoff(result.rows[0]);
  }

  // ============================================================================
  // Private Mapping Methods
  // ============================================================================

  private mapHandoff(row: any): HumanHandoff {
    return {
      handoffId: row.handoff_id,
      sessionId: row.session_id,
      userId: row.user_id,
      correlationId: row.correlation_id,
      triggeringCondition: row.triggering_condition,
      operatorId: row.operator_id || undefined,
      sessionSummary: row.session_summary,
      status: row.status,
      createdAt: row.created_at,
      assignedAt: row.assigned_at || undefined,
      resolvedAt: row.resolved_at || undefined,
    };
  }
}
