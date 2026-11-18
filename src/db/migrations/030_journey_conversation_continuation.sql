-- Conversation continuity is independent of transactional workflow snapshots.
-- The accepted event remains the compare-and-set anchor for a validated turn.
ALTER TABLE journey_event_checkpoints
  ADD COLUMN IF NOT EXISTS conversation_topic TEXT;
ALTER TABLE journey_event_checkpoints
  ADD COLUMN IF NOT EXISTS pending_question JSONB;
ALTER TABLE journey_event_checkpoints
  ADD COLUMN IF NOT EXISTS conversation_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE journey_event_checkpoints
  ADD COLUMN IF NOT EXISTS conversation_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE journey_event_checkpoints
  ADD COLUMN IF NOT EXISTS conversation_state_event_id UUID;
