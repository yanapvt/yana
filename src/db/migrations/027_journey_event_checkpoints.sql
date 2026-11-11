-- One channel-neutral accepted-event reference per traveller. Workflow state
-- remains in the existing durable vertical session records.
CREATE TABLE IF NOT EXISTS journey_event_checkpoints (
  user_key TEXT PRIMARY KEY,
  event_id UUID NOT NULL,
  source_event_id TEXT NOT NULL,
  idempotency_key CHAR(64) NOT NULL,
  correlation_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workflow_id TEXT,
  expected_state_version INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journey_event_checkpoints_workflow_idx
  ON journey_event_checkpoints (workflow_id)
  WHERE workflow_id IS NOT NULL;
