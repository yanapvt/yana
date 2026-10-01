-- Prevent retries from duplicating the same queue event for a handoff.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_handoff_event_unique_idx
  ON notifications ((content->>'handoffId'), notification_type)
  WHERE notification_type IN ('human_handoff_requested', 'human_handoff_sla_escalation');
