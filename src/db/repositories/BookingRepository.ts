/**
 * BookingRepository - Data access layer for booking entities
 * Handles bookings and booking_events
 * Requirements: 16.2, 21.2
 */

import { pool } from '../connection.js';
import { BookingState } from '../../types/core.js';

// ============================================================================
// Types
// ============================================================================

export interface Booking {
  bookingId: string;
  userId: string;
  sessionId: string;
  correlationId: string;
  state: BookingState;
  serviceType: string;
  serviceDetails: Record<string, unknown>;
  providerName?: string;
  providerBookingRef?: string;
  amount?: number;
  currency?: string;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
  cancelledAt?: Date;
  timedOutAt?: Date;
}

export interface BookingEvent {
  eventId: string;
  bookingId: string;
  previousState?: BookingState;
  newState: BookingState;
  triggeringAction?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================================
// BookingRepository Class
// ============================================================================

export class BookingRepository {
  /**
   * Create a new booking
   * Idempotent: Uses correlation_id to prevent duplicate booking creation
   */
  async createBooking(data: {
    userId: string;
    sessionId: string;
    correlationId: string;
    state: BookingState;
    serviceType: string;
    serviceDetails: Record<string, unknown>;
    providerName?: string;
    providerBookingRef?: string;
    amount?: number;
    currency?: string;
  }): Promise<Booking> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if booking exists (idempotency)
      const existing = await client.query<Booking>(
        'SELECT * FROM bookings WHERE correlation_id = $1',
        [data.correlationId]
      );

      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return this.mapBooking(existing.rows[0]);
      }

      // Create booking
      const result = await client.query<Booking>(
        `INSERT INTO bookings (user_id, session_id, correlation_id, state, service_type, service_details, provider_name, provider_booking_ref, amount, currency, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         RETURNING booking_id, user_id, session_id, correlation_id, state, service_type, service_details, provider_name, provider_booking_ref, amount, currency, created_at, updated_at, confirmed_at, cancelled_at, timed_out_at`,
        [
          data.userId,
          data.sessionId,
          data.correlationId,
          data.state,
          data.serviceType,
          JSON.stringify(data.serviceDetails),
          data.providerName,
          data.providerBookingRef,
          data.amount,
          data.currency,
        ]
      );

      const booking = this.mapBooking(result.rows[0]);

      // Create initial booking event
      await client.query(
        `INSERT INTO booking_events (booking_id, new_state, triggering_action, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [booking.bookingId, data.state, 'booking_created']
      );

      await client.query('COMMIT');
      return this.mapBooking(booking);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Find booking by ID
   */
  async findById(bookingId: string): Promise<Booking | null> {
    const result = await pool.query<Booking>(
      `SELECT booking_id, user_id, session_id, correlation_id, state, service_type, service_details, provider_name, provider_booking_ref, amount, currency, created_at, updated_at, confirmed_at, cancelled_at, timed_out_at
       FROM bookings WHERE booking_id = $1`,
      [bookingId]
    );

    return result.rows.length > 0 ? this.mapBooking(result.rows[0]) : null;
  }

  /**
   * Find booking by correlation ID
   */
  async findByCorrelationId(correlationId: string): Promise<Booking | null> {
    const result = await pool.query<Booking>(
      `SELECT booking_id, user_id, session_id, correlation_id, state, service_type, service_details, provider_name, provider_booking_ref, amount, currency, created_at, updated_at, confirmed_at, cancelled_at, timed_out_at
       FROM bookings WHERE correlation_id = $1`,
      [correlationId]
    );

    return result.rows.length > 0 ? this.mapBooking(result.rows[0]) : null;
  }

  /**
   * Find bookings by user ID
   */
  async findByUserId(userId: string, limit = 100): Promise<Booking[]> {
    const result = await pool.query<Booking>(
      `SELECT booking_id, user_id, session_id, correlation_id, state, service_type, service_details, provider_name, provider_booking_ref, amount, currency, created_at, updated_at, confirmed_at, cancelled_at, timed_out_at
       FROM bookings WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => this.mapBooking(row));
  }

  /**
   * Find bookings by session ID
   */
  async findBySessionId(sessionId: string): Promise<Booking[]> {
    const result = await pool.query<Booking>(
      `SELECT booking_id, user_id, session_id, correlation_id, state, service_type, service_details, provider_name, provider_booking_ref, amount, currency, created_at, updated_at, confirmed_at, cancelled_at, timed_out_at
       FROM bookings WHERE session_id = $1
       ORDER BY created_at DESC`,
      [sessionId]
    );

    return result.rows.map((row) => this.mapBooking(row));
  }

  /**
   * Update booking state with event tracking
   * Idempotent: State transitions are recorded but duplicate transitions to same state are allowed
   */
  async updateState(
    bookingId: string,
    newState: BookingState,
    triggeringAction?: string,
    metadata?: Record<string, unknown>
  ): Promise<Booking> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get current booking
      const current = await client.query<Booking>(
        'SELECT * FROM bookings WHERE booking_id = $1',
        [bookingId]
      );

      if (current.rows.length === 0) {
        throw new Error(`Booking ${bookingId} not found`);
      }

      const previousState = current.rows[0].state;

      // Update booking state and timestamps
      const updates: string[] = ['state = $1', 'updated_at = NOW()'];
      const values: any[] = [newState];
      let paramIndex = 2;

      if (newState === BookingState.CONFIRMED) {
        updates.push(`confirmed_at = NOW()`);
      } else if (newState === BookingState.CANCELLED) {
        updates.push(`cancelled_at = NOW()`);
      } else if (newState === BookingState.TIMED_OUT) {
        updates.push(`timed_out_at = NOW()`);
      }

      values.push(bookingId);

      const result = await client.query<Booking>(
        `UPDATE bookings SET ${updates.join(', ')}
         WHERE booking_id = $${paramIndex}
         RETURNING booking_id, user_id, session_id, correlation_id, state, service_type, service_details, provider_name, provider_booking_ref, amount, currency, created_at, updated_at, confirmed_at, cancelled_at, timed_out_at`,
        values
      );

      // Create booking event
      await client.query(
        `INSERT INTO booking_events (booking_id, previous_state, new_state, triggering_action, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          bookingId,
          previousState,
          newState,
          triggeringAction,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );

      await client.query('COMMIT');
      return this.mapBooking(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update booking provider reference
   * Idempotent: Can be called multiple times with same reference
   */
  async updateProviderBookingRef(
    bookingId: string,
    providerBookingRef: string
  ): Promise<void> {
    await pool.query(
      'UPDATE bookings SET provider_booking_ref = $1, updated_at = NOW() WHERE booking_id = $2',
      [providerBookingRef, bookingId]
    );
  }

  /**
   * Get booking events
   */
  async getEvents(bookingId: string): Promise<BookingEvent[]> {
    const result = await pool.query<BookingEvent>(
      `SELECT event_id, booking_id, previous_state, new_state, triggering_action, metadata, created_at
       FROM booking_events WHERE booking_id = $1
       ORDER BY created_at ASC`,
      [bookingId]
    );

    return result.rows.map((row) => this.mapBookingEvent(row));
  }

  // ============================================================================
  // Private Mapping Methods
  // ============================================================================

  private mapBooking(row: any): Booking {
    return {
      bookingId: row.booking_id,
      userId: row.user_id,
      sessionId: row.session_id,
      correlationId: row.correlation_id,
      state: row.state as BookingState,
      serviceType: row.service_type,
      serviceDetails: row.service_details,
      providerName: row.provider_name,
      providerBookingRef: row.provider_booking_ref,
      amount: row.amount,
      currency: row.currency,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at,
      cancelledAt: row.cancelled_at,
      timedOutAt: row.timed_out_at,
    };
  }

  private mapBookingEvent(row: any): BookingEvent {
    return {
      eventId: row.event_id,
      bookingId: row.booking_id,
      previousState: row.previous_state as BookingState | undefined,
      newState: row.new_state as BookingState,
      triggeringAction: row.triggering_action,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }
}
