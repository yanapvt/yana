-- A revisioned audit of validated workflow transitions. The existing vertical
-- session snapshot remains the recovery source and is updated in the same transaction.
CREATE TABLE IF NOT EXISTS journey_workflow_transitions (
  transition_id BIGSERIAL PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  flow TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  validated_criteria JSONB NOT NULL,
  pending_decisions JSONB NOT NULL,
  outcome_reference JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, state_version)
);

CREATE INDEX IF NOT EXISTS journey_workflow_transitions_user_idx
  ON journey_workflow_transitions (user_key, recorded_at DESC);
