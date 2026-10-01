-- Scoped operator operations, durable alerts, and audited dead-letter replay.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS replay_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replayed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replayed_by UUID;

CREATE TABLE IF NOT EXISTS handoff_operational_alerts (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key VARCHAR(150) NOT NULL UNIQUE,
  reason VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error_code VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS handoff_operational_alerts_delivery_idx
  ON handoff_operational_alerts(status,next_attempt_at,lease_expires_at);
CREATE INDEX IF NOT EXISTS notifications_handoff_dead_letter_idx
  ON notifications(dead_lettered_at DESC) WHERE status='dead_letter';
