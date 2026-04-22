-- Migration: 007_create_bookings
-- Description: Create bookings and booking_events tables
-- Requirements: 16.2, 16.4

-- Bookings table (booking lifecycle)
CREATE TABLE bookings (
  booking_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  correlation_id UUID NOT NULL,
  state VARCHAR(50) NOT NULL, -- initiated, hold_requested, hold_confirmed, payment_pending, confirmed, cancelled, timed_out
  service_type VARCHAR(100) NOT NULL,
  service_details JSONB NOT NULL,
  provider_name VARCHAR(255),
  provider_booking_ref VARCHAR(255),
  amount DECIMAL(12,2),
  currency VARCHAR(3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  timed_out_at TIMESTAMPTZ
);

CREATE INDEX idx_bookings_user_id ON bookings(user_id);
CREATE INDEX idx_bookings_session_id ON bookings(session_id);
CREATE INDEX idx_bookings_correlation_id ON bookings(correlation_id);
CREATE INDEX idx_bookings_state ON bookings(state);
CREATE INDEX idx_bookings_provider_name ON bookings(provider_name);
CREATE INDEX idx_bookings_created_at ON bookings(created_at);

-- Booking events (booking state transition audit trail)
CREATE TABLE booking_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  previous_state VARCHAR(50),
  new_state VARCHAR(50) NOT NULL,
  triggering_action VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_booking_events_booking_id ON booking_events(booking_id);
CREATE INDEX idx_booking_events_created_at ON booking_events(created_at);
