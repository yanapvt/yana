-- One satisfaction check per verified booking, regardless of duplicate state updates.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_confirmed_service_feedback_unique_idx
  ON notifications (booking_id, notification_type)
  WHERE notification_type = 'confirmed_service_feedback';

CREATE INDEX IF NOT EXISTS notifications_concierge_followup_ready_idx
  ON notifications (status, next_attempt_at, scheduled_at)
  WHERE notification_type IN ('unfinished_workflow', 'confirmed_service_feedback');
