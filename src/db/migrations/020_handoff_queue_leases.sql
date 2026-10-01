-- Durable leasing, retry and dead-letter state for human-handoff queue work.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS lease_owner VARCHAR(255),
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(100);

CREATE INDEX IF NOT EXISTS notifications_handoff_queue_ready_idx
  ON notifications(status, next_attempt_at, scheduled_at)
  WHERE notification_type IN ('human_handoff_requested', 'human_handoff_sla_escalation');

CREATE INDEX IF NOT EXISTS notifications_handoff_queue_lease_idx
  ON notifications(lease_expires_at)
  WHERE status = 'processing';
