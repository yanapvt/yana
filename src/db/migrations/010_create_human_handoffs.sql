-- Migration: 010_create_human_handoffs
-- Description: Create human_handoffs table
-- Requirements: 16.2

-- Human handoffs (escalation to human operators)
CREATE TABLE human_handoffs (
  handoff_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  correlation_id UUID NOT NULL,
  triggering_condition VARCHAR(255) NOT NULL,
  operator_id UUID,
  session_summary JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, assigned, resolved, cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_human_handoffs_session_id ON human_handoffs(session_id);
CREATE INDEX idx_human_handoffs_user_id ON human_handoffs(user_id);
CREATE INDEX idx_human_handoffs_correlation_id ON human_handoffs(correlation_id);
CREATE INDEX idx_human_handoffs_status ON human_handoffs(status);
CREATE INDEX idx_human_handoffs_operator_id ON human_handoffs(operator_id);
CREATE INDEX idx_human_handoffs_created_at ON human_handoffs(created_at);
