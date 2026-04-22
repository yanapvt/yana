/**
 * ToolRepository - Data access layer for tool entities
 * Handles tool_registry and tool_runs
 * Requirements: 16.2, 21.2
 */

import { pool } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export interface Tool {
  toolId: string;
  toolName: string;
  toolVersion: string;
  contract: Record<string, unknown>;
  executionPolicy: Record<string, unknown>;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolRun {
  runId: string;
  correlationId: string;
  sessionId?: string;
  userId?: string;
  toolName: string;
  inputParams: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  errorData?: Record<string, unknown>;
  executionStatus: 'success' | 'failure' | 'pending';
  executionTimeMs?: number;
  attemptNumber: number;
  providerName?: string;
  createdAt: Date;
}

// ============================================================================
// ToolRepository Class
// ============================================================================

export class ToolRepository {
  /**
   * Register a new tool
   * Idempotent: If tool with name exists, updates it
   */
  async registerTool(data: {
    toolName: string;
    toolVersion: string;
    contract: Record<string, unknown>;
    executionPolicy?: Record<string, unknown>;
    isEnabled?: boolean;
  }): Promise<Tool> {
    // Check if tool exists (idempotency - update if exists)
    const existing = await pool.query<Tool>(
      'SELECT * FROM tool_registry WHERE tool_name = $1',
      [data.toolName]
    );

    if (existing.rows.length > 0) {
      const result = await pool.query<Tool>(
        `UPDATE tool_registry
         SET tool_version = $1, contract = $2, execution_policy = $3, is_enabled = $4, updated_at = NOW()
         WHERE tool_name = $5
         RETURNING tool_id, tool_name, tool_version, contract, execution_policy, is_enabled, created_at, updated_at`,
        [
          data.toolVersion,
          JSON.stringify(data.contract),
          JSON.stringify(data.executionPolicy || {}),
          data.isEnabled ?? true,
          data.toolName,
        ]
      );
      return this.mapTool(result.rows[0]);
    }

    const result = await pool.query<Tool>(
      `INSERT INTO tool_registry (tool_name, tool_version, contract, execution_policy, is_enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING tool_id, tool_name, tool_version, contract, execution_policy, is_enabled, created_at, updated_at`,
      [
        data.toolName,
        data.toolVersion,
        JSON.stringify(data.contract),
        JSON.stringify(data.executionPolicy || {}),
        data.isEnabled ?? true,
      ]
    );

    return this.mapTool(result.rows[0]);
  }

  /**
   * Find tool by name
   */
  async findByName(toolName: string): Promise<Tool | null> {
    const result = await pool.query<Tool>(
      `SELECT tool_id, tool_name, tool_version, contract, execution_policy, is_enabled, created_at, updated_at
       FROM tool_registry WHERE tool_name = $1`,
      [toolName]
    );

    return result.rows.length > 0 ? this.mapTool(result.rows[0]) : null;
  }

  /**
   * Find all enabled tools
   */
  async findEnabled(): Promise<Tool[]> {
    const result = await pool.query<Tool>(
      `SELECT tool_id, tool_name, tool_version, contract, execution_policy, is_enabled, created_at, updated_at
       FROM tool_registry WHERE is_enabled = true
       ORDER BY tool_name ASC`
    );

    return result.rows.map((row) => this.mapTool(row));
  }

  /**
   * Enable or disable a tool
   * Idempotent: Can be called multiple times
   */
  async setEnabled(toolName: string, isEnabled: boolean): Promise<void> {
    await pool.query(
      'UPDATE tool_registry SET is_enabled = $1, updated_at = NOW() WHERE tool_name = $2',
      [isEnabled, toolName]
    );
  }

  /**
   * Create a tool run record
   * Idempotent: Uses correlation_id + attempt_number to prevent duplicates
   */
  async createRun(data: {
    correlationId: string;
    sessionId?: string;
    userId?: string;
    toolName: string;
    inputParams: Record<string, unknown>;
    outputData?: Record<string, unknown>;
    errorData?: Record<string, unknown>;
    executionStatus: 'success' | 'failure' | 'pending';
    executionTimeMs?: number;
    attemptNumber?: number;
    providerName?: string;
  }): Promise<ToolRun> {
    const attemptNumber = data.attemptNumber ?? 1;

    // Check if run exists (idempotency)
    const existing = await pool.query<ToolRun>(
      'SELECT * FROM tool_runs WHERE correlation_id = $1 AND tool_name = $2 AND attempt_number = $3',
      [data.correlationId, data.toolName, attemptNumber]
    );

    if (existing.rows.length > 0) {
      return this.mapToolRun(existing.rows[0]);
    }

    const result = await pool.query<ToolRun>(
      `INSERT INTO tool_runs (correlation_id, session_id, user_id, tool_name, input_params, output_data, error_data, execution_status, execution_time_ms, attempt_number, provider_name, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       RETURNING run_id, correlation_id, session_id, user_id, tool_name, input_params, output_data, error_data, execution_status, execution_time_ms, attempt_number, provider_name, created_at`,
      [
        data.correlationId,
        data.sessionId,
        data.userId,
        data.toolName,
        JSON.stringify(data.inputParams),
        data.outputData ? JSON.stringify(data.outputData) : null,
        data.errorData ? JSON.stringify(data.errorData) : null,
        data.executionStatus,
        data.executionTimeMs,
        attemptNumber,
        data.providerName,
      ]
    );

    return this.mapToolRun(result.rows[0]);
  }

  /**
   * Find tool runs by correlation ID
   */
  async findRunsByCorrelationId(correlationId: string): Promise<ToolRun[]> {
    const result = await pool.query<ToolRun>(
      `SELECT run_id, correlation_id, session_id, user_id, tool_name, input_params, output_data, error_data, execution_status, execution_time_ms, attempt_number, provider_name, created_at
       FROM tool_runs WHERE correlation_id = $1
       ORDER BY created_at ASC`,
      [correlationId]
    );

    return result.rows.map((row) => this.mapToolRun(row));
  }

  /**
   * Find tool runs by session ID
   */
  async findRunsBySessionId(sessionId: string, limit = 100): Promise<ToolRun[]> {
    const result = await pool.query<ToolRun>(
      `SELECT run_id, correlation_id, session_id, user_id, tool_name, input_params, output_data, error_data, execution_status, execution_time_ms, attempt_number, provider_name, created_at
       FROM tool_runs WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );

    return result.rows.map((row) => this.mapToolRun(row));
  }

  /**
   * Find tool runs by tool name
   */
  async findRunsByToolName(
    toolName: string,
    limit = 100,
    status?: 'success' | 'failure' | 'pending'
  ): Promise<ToolRun[]> {
    let query = `SELECT run_id, correlation_id, session_id, user_id, tool_name, input_params, output_data, error_data, execution_status, execution_time_ms, attempt_number, provider_name, created_at
       FROM tool_runs WHERE tool_name = $1`;
    const params: any[] = [toolName];

    if (status) {
      query += ' AND execution_status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await pool.query<ToolRun>(query, params);

    return result.rows.map((row) => this.mapToolRun(row));
  }

  // ============================================================================
  // Private Mapping Methods
  // ============================================================================

  private mapTool(row: any): Tool {
    return {
      toolId: row.tool_id,
      toolName: row.tool_name,
      toolVersion: row.tool_version,
      contract: row.contract,
      executionPolicy: row.execution_policy,
      isEnabled: row.is_enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapToolRun(row: any): ToolRun {
    return {
      runId: row.run_id,
      correlationId: row.correlation_id,
      sessionId: row.session_id,
      userId: row.user_id,
      toolName: row.tool_name,
      inputParams: row.input_params,
      outputData: row.output_data,
      errorData: row.error_data,
      executionStatus: row.execution_status,
      executionTimeMs: row.execution_time_ms,
      attemptNumber: row.attempt_number,
      providerName: row.provider_name,
      createdAt: row.created_at,
    };
  }
}
