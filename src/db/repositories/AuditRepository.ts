/**
 * AuditRepository - Data access layer for audit entities
 * Handles audit_logs and decision_logs
 * Requirements: 16.2, 21.2
 */

import { pool } from '../connection.js';
import { ErrorCategory } from '../../types/core.js';

// ============================================================================
// Types
// ============================================================================

export interface AuditLog {
  logId: string;
  correlationId: string;
  sessionId?: string;
  userId?: string;
  phoneHash?: string;
  actionType: string;
  modelUsed?: string;
  toolUsed?: string;
  providerUsed?: string;
  executionStatus: 'success' | 'failure' | 'pending';
  latencyMs?: number;
  errorCode?: string;
  errorCategory?: ErrorCategory;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface DecisionLog {
  decisionId: string;
  correlationId: string;
  sessionId: string;
  userId: string;
  intent?: string;
  parameters: Record<string, unknown>;
  missingFields: string[];
  suggestedAction?: string;
  confidence?: number;
  reasoning?: string;
  modelUsed?: string;
  createdAt: Date;
}

// ============================================================================
// AuditRepository Class
// ============================================================================

export class AuditRepository {
  /**
   * Create an audit log entry
   * Idempotent: Uses correlation_id + action_type + timestamp to prevent exact duplicates
   */
  async createAuditLog(data: {
    correlationId: string;
    sessionId?: string;
    userId?: string;
    phoneHash?: string;
    actionType: string;
    modelUsed?: string;
    toolUsed?: string;
    providerUsed?: string;
    executionStatus: 'success' | 'failure' | 'pending';
    latencyMs?: number;
    errorCode?: string;
    errorCategory?: ErrorCategory;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLog> {
    const result = await pool.query<AuditLog>(
      `INSERT INTO audit_logs (correlation_id, session_id, user_id, phone_hash, action_type, model_used, tool_used, provider_used, execution_status, latency_ms, error_code, error_category, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       RETURNING log_id, correlation_id, session_id, user_id, phone_hash, action_type, model_used, tool_used, provider_used, execution_status, latency_ms, error_code, error_category, metadata, created_at`,
      [
        data.correlationId,
        data.sessionId,
        data.userId,
        data.phoneHash,
        data.actionType,
        data.modelUsed,
        data.toolUsed,
        data.providerUsed,
        data.executionStatus,
        data.latencyMs,
        data.errorCode,
        data.errorCategory,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );

    return this.mapAuditLog(result.rows[0]);
  }

  /**
   * Find audit logs by correlation ID
   */
  async findByCorrelationId(correlationId: string): Promise<AuditLog[]> {
    const result = await pool.query<AuditLog>(
      `SELECT log_id, correlation_id, session_id, user_id, phone_hash, action_type, model_used, tool_used, provider_used, execution_status, latency_ms, error_code, error_category, metadata, created_at
       FROM audit_logs WHERE correlation_id = $1
       ORDER BY created_at ASC`,
      [correlationId]
    );

    return result.rows.map((row) => this.mapAuditLog(row));
  }

  /**
   * Find audit logs by session ID
   */
  async findBySessionId(sessionId: string, limit = 100): Promise<AuditLog[]> {
    const result = await pool.query<AuditLog>(
      `SELECT log_id, correlation_id, session_id, user_id, phone_hash, action_type, model_used, tool_used, provider_used, execution_status, latency_ms, error_code, error_category, metadata, created_at
       FROM audit_logs WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );

    return result.rows.map((row) => this.mapAuditLog(row));
  }

  /**
   * Find audit logs by user ID
   */
  async findByUserId(userId: string, limit = 100): Promise<AuditLog[]> {
    const result = await pool.query<AuditLog>(
      `SELECT log_id, correlation_id, session_id, user_id, phone_hash, action_type, model_used, tool_used, provider_used, execution_status, latency_ms, error_code, error_category, metadata, created_at
       FROM audit_logs WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => this.mapAuditLog(row));
  }

  /**
   * Find audit logs by action type
   */
  async findByActionType(
    actionType: string,
    limit = 100,
    status?: 'success' | 'failure' | 'pending'
  ): Promise<AuditLog[]> {
    let query = `SELECT log_id, correlation_id, session_id, user_id, phone_hash, action_type, model_used, tool_used, provider_used, execution_status, latency_ms, error_code, error_category, metadata, created_at
       FROM audit_logs WHERE action_type = $1`;
    const params: any[] = [actionType];

    if (status) {
      query += ' AND execution_status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await pool.query<AuditLog>(query, params);

    return result.rows.map((row) => this.mapAuditLog(row));
  }

  /**
   * Find audit logs by error category
   */
  async findByErrorCategory(errorCategory: ErrorCategory, limit = 100): Promise<AuditLog[]> {
    const result = await pool.query<AuditLog>(
      `SELECT log_id, correlation_id, session_id, user_id, phone_hash, action_type, model_used, tool_used, provider_used, execution_status, latency_ms, error_code, error_category, metadata, created_at
       FROM audit_logs WHERE error_category = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [errorCategory, limit]
    );

    return result.rows.map((row) => this.mapAuditLog(row));
  }

  /**
   * Create a decision log entry
   * Idempotent: Uses correlation_id to prevent duplicate decision logs
   */
  async createDecisionLog(data: {
    correlationId: string;
    sessionId: string;
    userId: string;
    intent?: string;
    parameters?: Record<string, unknown>;
    missingFields?: string[];
    suggestedAction?: string;
    confidence?: number;
    reasoning?: string;
    modelUsed?: string;
  }): Promise<DecisionLog> {
    // Check if decision log exists (idempotency)
    const existing = await pool.query<DecisionLog>(
      'SELECT * FROM decision_logs WHERE correlation_id = $1',
      [data.correlationId]
    );

    if (existing.rows.length > 0) {
      return this.mapDecisionLog(existing.rows[0]);
    }

    const result = await pool.query<DecisionLog>(
      `INSERT INTO decision_logs (correlation_id, session_id, user_id, intent, parameters, missing_fields, suggested_action, confidence, reasoning, model_used, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       RETURNING decision_id, correlation_id, session_id, user_id, intent, parameters, missing_fields, suggested_action, confidence, reasoning, model_used, created_at`,
      [
        data.correlationId,
        data.sessionId,
        data.userId,
        data.intent,
        JSON.stringify(data.parameters || {}),
        JSON.stringify(data.missingFields || []),
        data.suggestedAction,
        data.confidence,
        data.reasoning,
        data.modelUsed,
      ]
    );

    return this.mapDecisionLog(result.rows[0]);
  }

  /**
   * Find decision log by correlation ID
   */
  async findDecisionByCorrelationId(correlationId: string): Promise<DecisionLog | null> {
    const result = await pool.query<DecisionLog>(
      `SELECT decision_id, correlation_id, session_id, user_id, intent, parameters, missing_fields, suggested_action, confidence, reasoning, model_used, created_at
       FROM decision_logs WHERE correlation_id = $1`,
      [correlationId]
    );

    return result.rows.length > 0 ? this.mapDecisionLog(result.rows[0]) : null;
  }

  /**
   * Find decision logs by session ID
   */
  async findDecisionsBySessionId(sessionId: string, limit = 100): Promise<DecisionLog[]> {
    const result = await pool.query<DecisionLog>(
      `SELECT decision_id, correlation_id, session_id, user_id, intent, parameters, missing_fields, suggested_action, confidence, reasoning, model_used, created_at
       FROM decision_logs WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );

    return result.rows.map((row) => this.mapDecisionLog(row));
  }

  /**
   * Find decision logs by user ID
   */
  async findDecisionsByUserId(userId: string, limit = 100): Promise<DecisionLog[]> {
    const result = await pool.query<DecisionLog>(
      `SELECT decision_id, correlation_id, session_id, user_id, intent, parameters, missing_fields, suggested_action, confidence, reasoning, model_used, created_at
       FROM decision_logs WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => this.mapDecisionLog(row));
  }

  // ============================================================================
  // Private Mapping Methods
  // ============================================================================

  private mapAuditLog(row: any): AuditLog {
    return {
      logId: row.log_id,
      correlationId: row.correlation_id,
      sessionId: row.session_id,
      userId: row.user_id,
      phoneHash: row.phone_hash,
      actionType: row.action_type,
      modelUsed: row.model_used,
      toolUsed: row.tool_used,
      providerUsed: row.provider_used,
      executionStatus: row.execution_status,
      latencyMs: row.latency_ms,
      errorCode: row.error_code,
      errorCategory: row.error_category as ErrorCategory | undefined,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }

  private mapDecisionLog(row: any): DecisionLog {
    return {
      decisionId: row.decision_id,
      correlationId: row.correlation_id,
      sessionId: row.session_id,
      userId: row.user_id,
      intent: row.intent,
      parameters: row.parameters,
      missingFields: row.missing_fields,
      suggestedAction: row.suggested_action,
      confidence: row.confidence ? parseFloat(row.confidence) : undefined,
      reasoning: row.reasoning,
      modelUsed: row.model_used,
      createdAt: row.created_at,
    };
  }
}
