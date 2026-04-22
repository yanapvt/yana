/**
 * PaymentRepository - Data access layer for payment entities
 * Handles payments and payment_events
 * Requirements: 16.2, 21.2
 */

import { pool } from '../connection.js';
import { PaymentState } from '../../types/core.js';

// ============================================================================
// Types
// ============================================================================

export interface Payment {
  paymentId: string;
  bookingId: string;
  userId: string;
  correlationId: string;
  state: PaymentState;
  amount: number;
  currency: string;
  paymentMethod: 'telco_billing' | 'payment_link' | 'other';
  providerName: string;
  providerPaymentRef?: string;
  paymentUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  succeededAt?: Date;
  failedAt?: Date;
  timedOutAt?: Date;
}

export interface PaymentEvent {
  eventId: string;
  paymentId: string;
  previousState?: PaymentState;
  newState: PaymentState;
  triggeringAction?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================================
// PaymentRepository Class
// ============================================================================

export class PaymentRepository {
  /**
   * Create a new payment
   * Idempotent: Uses correlation_id to prevent duplicate payment creation
   */
  async createPayment(data: {
    bookingId: string;
    userId: string;
    correlationId: string;
    state: PaymentState;
    amount: number;
    currency: string;
    paymentMethod: 'telco_billing' | 'payment_link' | 'other';
    providerName: string;
    providerPaymentRef?: string;
    paymentUrl?: string;
  }): Promise<Payment> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if payment exists (idempotency)
      const existing = await client.query<Payment>(
        'SELECT * FROM payments WHERE correlation_id = $1',
        [data.correlationId]
      );

      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return this.mapPayment(existing.rows[0]);
      }

      // Create payment
      const result = await client.query<Payment>(
        `INSERT INTO payments (booking_id, user_id, correlation_id, state, amount, currency, payment_method, provider_name, provider_payment_ref, payment_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         RETURNING payment_id, booking_id, user_id, correlation_id, state, amount, currency, payment_method, provider_name, provider_payment_ref, payment_url, created_at, updated_at, succeeded_at, failed_at, timed_out_at`,
        [
          data.bookingId,
          data.userId,
          data.correlationId,
          data.state,
          data.amount,
          data.currency,
          data.paymentMethod,
          data.providerName,
          data.providerPaymentRef,
          data.paymentUrl,
        ]
      );

      const payment = result.rows[0];

      // Create initial payment event
      await client.query(
        `INSERT INTO payment_events (payment_id, new_state, triggering_action, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [payment.payment_id, data.state, 'payment_created']
      );

      await client.query('COMMIT');
      return this.mapPayment(payment);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Find payment by ID
   */
  async findById(paymentId: string): Promise<Payment | null> {
    const result = await pool.query<Payment>(
      `SELECT payment_id, booking_id, user_id, correlation_id, state, amount, currency, payment_method, provider_name, provider_payment_ref, payment_url, created_at, updated_at, succeeded_at, failed_at, timed_out_at
       FROM payments WHERE payment_id = $1`,
      [paymentId]
    );

    return result.rows.length > 0 ? this.mapPayment(result.rows[0]) : null;
  }

  /**
   * Find payment by correlation ID
   */
  async findByCorrelationId(correlationId: string): Promise<Payment | null> {
    const result = await pool.query<Payment>(
      `SELECT payment_id, booking_id, user_id, correlation_id, state, amount, currency, payment_method, provider_name, provider_payment_ref, payment_url, created_at, updated_at, succeeded_at, failed_at, timed_out_at
       FROM payments WHERE correlation_id = $1`,
      [correlationId]
    );

    return result.rows.length > 0 ? this.mapPayment(result.rows[0]) : null;
  }

  /**
   * Find payments by booking ID
   */
  async findByBookingId(bookingId: string): Promise<Payment[]> {
    const result = await pool.query<Payment>(
      `SELECT payment_id, booking_id, user_id, correlation_id, state, amount, currency, payment_method, provider_name, provider_payment_ref, payment_url, created_at, updated_at, succeeded_at, failed_at, timed_out_at
       FROM payments WHERE booking_id = $1
       ORDER BY created_at DESC`,
      [bookingId]
    );

    return result.rows.map((row) => this.mapPayment(row));
  }

  /**
   * Find payments by user ID
   */
  async findByUserId(userId: string, limit = 100): Promise<Payment[]> {
    const result = await pool.query<Payment>(
      `SELECT payment_id, booking_id, user_id, correlation_id, state, amount, currency, payment_method, provider_name, provider_payment_ref, payment_url, created_at, updated_at, succeeded_at, failed_at, timed_out_at
       FROM payments WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => this.mapPayment(row));
  }

  /**
   * Update payment state with event tracking
   * Idempotent: State transitions are recorded but duplicate transitions to same state are allowed
   */
  async updateState(
    paymentId: string,
    newState: PaymentState,
    triggeringAction?: string,
    metadata?: Record<string, unknown>
  ): Promise<Payment> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get current payment
      const current = await client.query<Payment>(
        'SELECT * FROM payments WHERE payment_id = $1',
        [paymentId]
      );

      if (current.rows.length === 0) {
        throw new Error(`Payment ${paymentId} not found`);
      }

      const previousState = current.rows[0].state;

      // Update payment state and timestamps
      const updates: string[] = ['state = $1', 'updated_at = NOW()'];
      const values: any[] = [newState];
      let paramIndex = 2;

      if (newState === PaymentState.SUCCEEDED) {
        updates.push(`succeeded_at = NOW()`);
      } else if (newState === PaymentState.FAILED) {
        updates.push(`failed_at = NOW()`);
      } else if (newState === PaymentState.TIMED_OUT) {
        updates.push(`timed_out_at = NOW()`);
      }

      values.push(paymentId);

      const result = await client.query<Payment>(
        `UPDATE payments SET ${updates.join(', ')}
         WHERE payment_id = $${paramIndex}
         RETURNING payment_id, booking_id, user_id, correlation_id, state, amount, currency, payment_method, provider_name, provider_payment_ref, payment_url, created_at, updated_at, succeeded_at, failed_at, timed_out_at`,
        values
      );

      // Create payment event
      await client.query(
        `INSERT INTO payment_events (payment_id, previous_state, new_state, triggering_action, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          paymentId,
          previousState,
          newState,
          triggeringAction,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );

      await client.query('COMMIT');
      return this.mapPayment(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update payment provider reference
   * Idempotent: Can be called multiple times with same reference
   */
  async updateProviderPaymentRef(
    paymentId: string,
    providerPaymentRef: string
  ): Promise<void> {
    await pool.query(
      'UPDATE payments SET provider_payment_ref = $1, updated_at = NOW() WHERE payment_id = $2',
      [providerPaymentRef, paymentId]
    );
  }

  /**
   * Update payment URL
   * Idempotent: Can be called multiple times with same URL
   */
  async updatePaymentUrl(paymentId: string, paymentUrl: string): Promise<void> {
    await pool.query(
      'UPDATE payments SET payment_url = $1, updated_at = NOW() WHERE payment_id = $2',
      [paymentUrl, paymentId]
    );
  }

  /**
   * Get payment events
   */
  async getEvents(paymentId: string): Promise<PaymentEvent[]> {
    const result = await pool.query<PaymentEvent>(
      `SELECT event_id, payment_id, previous_state, new_state, triggering_action, metadata, created_at
       FROM payment_events WHERE payment_id = $1
       ORDER BY created_at ASC`,
      [paymentId]
    );

    return result.rows.map((row) => this.mapPaymentEvent(row));
  }

  // ============================================================================
  // Private Mapping Methods
  // ============================================================================

  private mapPayment(row: any): Payment {
    return {
      paymentId: row.payment_id,
      bookingId: row.booking_id,
      userId: row.user_id,
      correlationId: row.correlation_id,
      state: row.state as PaymentState,
      amount: parseFloat(row.amount),
      currency: row.currency,
      paymentMethod: row.payment_method,
      providerName: row.provider_name,
      providerPaymentRef: row.provider_payment_ref,
      paymentUrl: row.payment_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      succeededAt: row.succeeded_at,
      failedAt: row.failed_at,
      timedOutAt: row.timed_out_at,
    };
  }

  private mapPaymentEvent(row: any): PaymentEvent {
    return {
      eventId: row.event_id,
      paymentId: row.payment_id,
      previousState: row.previous_state as PaymentState | undefined,
      newState: row.new_state as PaymentState,
      triggeringAction: row.triggering_action,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }
}
