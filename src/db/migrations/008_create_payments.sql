-- Migration: 008_create_payments
-- Description: Create payments and payment_events tables
-- Requirements: 16.2, 16.4

-- Payments table (payment lifecycle)
CREATE TABLE payments (
  payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  correlation_id UUID NOT NULL,
  state VARCHAR(50) NOT NULL, -- initiated, pending, succeeded, failed, timed_out, refunded_or_cancelled
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  payment_method VARCHAR(50) NOT NULL, -- telco_billing, payment_link, other
  provider_name VARCHAR(255) NOT NULL,
  provider_payment_ref VARCHAR(255),
  payment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  succeeded_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  timed_out_at TIMESTAMPTZ
);

CREATE INDEX idx_payments_booking_id ON payments(booking_id);
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_correlation_id ON payments(correlation_id);
CREATE INDEX idx_payments_state ON payments(state);
CREATE INDEX idx_payments_provider_name ON payments(provider_name);
CREATE INDEX idx_payments_created_at ON payments(created_at);

-- Payment events (payment state transition audit trail)
CREATE TABLE payment_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(payment_id) ON DELETE CASCADE,
  previous_state VARCHAR(50),
  new_state VARCHAR(50) NOT NULL,
  triggering_action VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_events_payment_id ON payment_events(payment_id);
CREATE INDEX idx_payment_events_created_at ON payment_events(created_at);
