-- Migration: 012_create_audit_logs
-- Description: Create audit_logs and decision_logs tables
-- Requirements: 16.6, 17.4

-- Audit logs (comprehensive system audit trail)
CREATE TABLE audit_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL,
  session_id UUID REFERENCES sessions(session_id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  phone_hash VARCHAR(64),
  action_type VARCHAR(255) NOT NULL,
  model_used VARCHAR(255),
  tool_used VARCHAR(255),
  provider_used VARCHAR(255),
  execution_status VARCHAR(50) NOT NULL, -- success, failure, pending
  latency_ms INTEGER,
  error_code VARCHAR(100),
  error_category VARCHAR(100), -- user_input_error, schema_error, provider_failure, payment_failure, translation_failure, internal_system_error
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_correlation_id ON audit_logs(correlation_id);
CREATE INDEX idx_audit_logs_session_id ON audit_logs(session_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_execution_status ON audit_logs(execution_status);
CREATE INDEX idx_audit_logs_error_category ON audit_logs(error_category);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Decision logs (LLM decision outputs)
CREATE TABLE decision_logs (
  decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  intent VARCHAR(255),
  parameters JSONB NOT NULL DEFAULT '{}',
  missing_fields JSONB NOT NULL DEFAULT '[]',
  suggested_action VARCHAR(100),
  confidence DECIMAL(5,4),
  reasoning TEXT,
  model_used VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_decision_logs_correlation_id ON decision_logs(correlation_id);
CREATE INDEX idx_decision_logs_session_id ON decision_logs(session_id);
CREATE INDEX idx_decision_logs_user_id ON decision_logs(user_id);
CREATE INDEX idx_decision_logs_intent ON decision_logs(intent);
CREATE INDEX idx_decision_logs_created_at ON decision_logs(created_at);
