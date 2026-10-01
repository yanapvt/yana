-- Durable, idempotent concierge queue metadata.
ALTER TABLE human_handoffs
  ADD COLUMN IF NOT EXISTS channel VARCHAR(50) NOT NULL DEFAULT 'agent_queue',
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;

ALTER TABLE human_handoffs
  DROP CONSTRAINT IF EXISTS human_handoffs_channel_check;

ALTER TABLE human_handoffs
  ADD CONSTRAINT human_handoffs_channel_check
  CHECK (channel IN ('native_whatsapp_group', 'agent_queue'));

CREATE UNIQUE INDEX IF NOT EXISTS human_handoffs_one_open_case_per_session_idx
  ON human_handoffs(session_id)
  WHERE status IN ('pending', 'assigned');

CREATE INDEX IF NOT EXISTS human_handoffs_sla_due_idx
  ON human_handoffs(sla_due_at)
  WHERE status IN ('pending', 'assigned');
