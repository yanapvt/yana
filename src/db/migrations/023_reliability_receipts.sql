-- Shared atomic inbound idempotency and one-time authoritative hotel recheck receipts.
CREATE TABLE IF NOT EXISTS inbound_message_claims (
  provider VARCHAR(32) NOT NULL,
  message_id_hash CHAR(64) NOT NULL,
  correlation_id VARCHAR(255),
  effect_class VARCHAR(32) NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (provider, message_id_hash)
);

CREATE INDEX IF NOT EXISTS inbound_message_claims_expiry_idx
  ON inbound_message_claims(expires_at);

CREATE TABLE IF NOT EXISTS hotel_recheck_receipts (
  receipt_id UUID PRIMARY KEY,
  selection_hash CHAR(64) NOT NULL,
  stay_hash CHAR(64) NOT NULL,
  occupancy_hash CHAR(64) NOT NULL,
  provider_hash CHAR(64) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_correlation_id VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS hotel_recheck_receipts_expiry_idx
  ON hotel_recheck_receipts(expires_at);
