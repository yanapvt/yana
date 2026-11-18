-- A generated question is staged until its channel accepts the outbound send.
-- The accepted-event checkpoint and revision remain the authority for activation.
ALTER TABLE journey_event_checkpoints
  ADD COLUMN IF NOT EXISTS outbound_question JSONB;
