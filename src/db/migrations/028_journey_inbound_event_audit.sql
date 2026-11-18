-- Append-only normalized interaction audit. Workflow/session state remains in
-- the existing repositories; the checkpoint stores only the latest reference.
CREATE TABLE IF NOT EXISTS journey_inbound_events (
  event_sequence BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  user_key TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  idempotency_key CHAR(64) NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workflow_id TEXT,
  expected_state_version INTEGER,
  state_version INTEGER,
  context_id TEXT,
  payload JSONB NOT NULL,
  metadata JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS journey_inbound_events_user_order_idx
  ON journey_inbound_events (user_key, event_sequence DESC);
CREATE INDEX IF NOT EXISTS journey_inbound_events_correlation_idx
  ON journey_inbound_events (correlation_id);

ALTER TABLE journey_event_checkpoints
  ADD COLUMN IF NOT EXISTS last_sequence BIGINT NOT NULL DEFAULT 0;
ALTER TABLE journey_event_checkpoints
  ADD COLUMN IF NOT EXISTS state_version INTEGER;
ALTER TABLE journey_event_checkpoints
  ADD COLUMN IF NOT EXISTS context_id TEXT;
