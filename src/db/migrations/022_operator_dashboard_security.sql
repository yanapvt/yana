CREATE TABLE IF NOT EXISTS operator_dashboard_sessions (
  session_key_hash VARCHAR(64) PRIMARY KEY,
  record_kind VARCHAR(30) NOT NULL CHECK(record_kind IN ('session','login_challenge','oidc_transaction')),
  key_id VARCHAR(100) NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS operator_dashboard_sessions_expiry_idx ON operator_dashboard_sessions(expires_at);

CREATE TABLE IF NOT EXISTS operator_auth_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), correlation_id UUID NOT NULL,
  operator_id UUID, event_type VARCHAR(60) NOT NULL, outcome VARCHAR(30) NOT NULL,
  auth_method VARCHAR(20) NOT NULL, reason_code VARCHAR(100), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS operator_auth_events_retention_idx ON operator_auth_events(created_at);
CREATE INDEX IF NOT EXISTS operator_auth_events_correlation_idx ON operator_auth_events(correlation_id);
