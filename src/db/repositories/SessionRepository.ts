/**
 * SessionRepository - Data access layer for session entities
 * Handles sessions and session_state
 * Requirements: 16.2, 21.2
 */

import { pool } from '../connection.js';
import type { SessionState } from '../../types/core.js';

// ============================================================================
// Types
// ============================================================================

export interface Session {
  sessionId: string;
  userId: string;
  phoneNumber: string;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
}

export interface SessionStateData {
  sessionId: string;
  currentIntent?: string;
  currentStep?: string;
  activeSchema?: string;
  schemaVersion?: string;
  missingFields: string[];
  collectedFields: Record<string, unknown>;
  pendingOptions: unknown[];
  bookingProgress?: Record<string, unknown>;
  paymentProgress?: Record<string, unknown>;
  conversationHistory: unknown[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// SessionRepository Class
// ============================================================================

export class SessionRepository {
  /**
   * Create a new session with initial state
   * Idempotent: If session exists for user, updates last activity and returns existing session
   */
  async createSession(userId: string, phoneNumber: string): Promise<Session> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check for existing active session (idempotency)
      const existingSession = await client.query<Session>(
        `SELECT session_id, user_id, phone_number, created_at, updated_at, last_activity_at
         FROM sessions
         WHERE user_id = $1 AND last_activity_at > NOW() - INTERVAL '1 hour'
         ORDER BY last_activity_at DESC
         LIMIT 1`,
        [userId]
      );

      if (existingSession.rows.length > 0) {
        // Update last activity
        await client.query(
          'UPDATE sessions SET last_activity_at = NOW(), updated_at = NOW() WHERE session_id = $1',
          [existingSession.rows[0].session_id]
        );
        await client.query('COMMIT');
        return this.mapSession(existingSession.rows[0]);
      }

      // Create new session
      const sessionResult = await client.query<Session>(
        `INSERT INTO sessions (user_id, phone_number, created_at, updated_at, last_activity_at)
         VALUES ($1, $2, NOW(), NOW(), NOW())
         RETURNING session_id, user_id, phone_number, created_at, updated_at, last_activity_at`,
        [userId, phoneNumber]
      );

      const session = sessionResult.rows[0];

      // Create initial session state
      await client.query(
        `INSERT INTO session_state (session_id, missing_fields, collected_fields, pending_options, conversation_history, created_at, updated_at)
         VALUES ($1, '[]', '{}', '[]', '[]', NOW(), NOW())`,
        [session.session_id]
      );

      await client.query('COMMIT');
      return this.mapSession(session);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Find session by ID
   */
  async findById(sessionId: string): Promise<Session | null> {
    const result = await pool.query<Session>(
      `SELECT session_id, user_id, phone_number, created_at, updated_at, last_activity_at
       FROM sessions WHERE session_id = $1`,
      [sessionId]
    );

    return result.rows.length > 0 ? this.mapSession(result.rows[0]) : null;
  }

  /**
   * Find active session for user
   */
  async findActiveByUserId(userId: string): Promise<Session | null> {
    const result = await pool.query<Session>(
      `SELECT session_id, user_id, phone_number, created_at, updated_at, last_activity_at
       FROM sessions
       WHERE user_id = $1 AND last_activity_at > NOW() - INTERVAL '1 hour'
       ORDER BY last_activity_at DESC
       LIMIT 1`,
      [userId]
    );

    return result.rows.length > 0 ? this.mapSession(result.rows[0]) : null;
  }

  /**
   * Update session last activity
   * Idempotent: Can be called multiple times safely
   */
  async updateLastActivity(sessionId: string): Promise<void> {
    await pool.query(
      'UPDATE sessions SET last_activity_at = NOW(), updated_at = NOW() WHERE session_id = $1',
      [sessionId]
    );
  }

  /**
   * Get session state
   */
  async getState(sessionId: string): Promise<SessionStateData | null> {
    const result = await pool.query<SessionStateData>(
      `SELECT session_id, current_intent, current_step, active_schema, schema_version,
              missing_fields, collected_fields, pending_options, booking_progress,
              payment_progress, conversation_history, created_at, updated_at
       FROM session_state WHERE session_id = $1`,
      [sessionId]
    );

    return result.rows.length > 0 ? this.mapSessionState(result.rows[0]) : null;
  }

  /**
   * Update session state
   * Idempotent: Updates only provided fields
   */
  async updateState(
    sessionId: string,
    updates: Partial<Omit<SessionStateData, 'sessionId' | 'createdAt' | 'updatedAt'>>
  ): Promise<SessionStateData> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.currentIntent !== undefined) {
      fields.push(`current_intent = $${paramIndex++}`);
      values.push(updates.currentIntent);
    }
    if (updates.currentStep !== undefined) {
      fields.push(`current_step = $${paramIndex++}`);
      values.push(updates.currentStep);
    }
    if (updates.activeSchema !== undefined) {
      fields.push(`active_schema = $${paramIndex++}`);
      values.push(updates.activeSchema);
    }
    if (updates.schemaVersion !== undefined) {
      fields.push(`schema_version = $${paramIndex++}`);
      values.push(updates.schemaVersion);
    }
    if (updates.missingFields !== undefined) {
      fields.push(`missing_fields = $${paramIndex++}`);
      values.push(JSON.stringify(updates.missingFields));
    }
    if (updates.collectedFields !== undefined) {
      fields.push(`collected_fields = $${paramIndex++}`);
      values.push(JSON.stringify(updates.collectedFields));
    }
    if (updates.pendingOptions !== undefined) {
      fields.push(`pending_options = $${paramIndex++}`);
      values.push(JSON.stringify(updates.pendingOptions));
    }
    if (updates.bookingProgress !== undefined) {
      fields.push(`booking_progress = $${paramIndex++}`);
      values.push(JSON.stringify(updates.bookingProgress));
    }
    if (updates.paymentProgress !== undefined) {
      fields.push(`payment_progress = $${paramIndex++}`);
      values.push(JSON.stringify(updates.paymentProgress));
    }
    if (updates.conversationHistory !== undefined) {
      fields.push(`conversation_history = $${paramIndex++}`);
      values.push(JSON.stringify(updates.conversationHistory));
    }

    fields.push(`updated_at = NOW()`);
    values.push(sessionId);

    const result = await pool.query<SessionStateData>(
      `UPDATE session_state SET ${fields.join(', ')}
       WHERE session_id = $${paramIndex}
       RETURNING session_id, current_intent, current_step, active_schema, schema_version,
                 missing_fields, collected_fields, pending_options, booking_progress,
                 payment_progress, conversation_history, created_at, updated_at`,
      values
    );

    return this.mapSessionState(result.rows[0]);
  }

  /**
   * Append to conversation history
   * Idempotent: Duplicate messages are not prevented at this level
   */
  async appendConversationHistory(
    sessionId: string,
    message: unknown
  ): Promise<void> {
    await pool.query(
      `UPDATE session_state
       SET conversation_history = conversation_history || $1::jsonb,
           updated_at = NOW()
       WHERE session_id = $2`,
      [JSON.stringify(message), sessionId]
    );
  }

  // ============================================================================
  // Private Mapping Methods
  // ============================================================================

  private mapSession(row: any): Session {
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      phoneNumber: row.phone_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at,
    };
  }

  private mapSessionState(row: any): SessionStateData {
    return {
      sessionId: row.session_id,
      currentIntent: row.current_intent,
      currentStep: row.current_step,
      activeSchema: row.active_schema,
      schemaVersion: row.schema_version,
      missingFields: row.missing_fields,
      collectedFields: row.collected_fields,
      pendingOptions: row.pending_options,
      bookingProgress: row.booking_progress,
      paymentProgress: row.payment_progress,
      conversationHistory: row.conversation_history,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
