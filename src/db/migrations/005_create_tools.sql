-- Migration: 005_create_tools
-- Description: Create tool_registry and tool_runs tables
-- Requirements: 16.2, 16.6

-- Tool registry (MCP tool definitions)
CREATE TABLE tool_registry (
  tool_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name VARCHAR(255) UNIQUE NOT NULL,
  tool_version VARCHAR(50) NOT NULL,
  contract JSONB NOT NULL,
  execution_policy JSONB NOT NULL DEFAULT '{}',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tool_registry_tool_name ON tool_registry(tool_name);
CREATE INDEX idx_tool_registry_is_enabled ON tool_registry(is_enabled);

-- Tool runs (tool execution logs)
CREATE TABLE tool_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL,
  session_id UUID REFERENCES sessions(session_id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  tool_name VARCHAR(255) NOT NULL,
  input_params JSONB NOT NULL,
  output_data JSONB,
  error_data JSONB,
  execution_status VARCHAR(50) NOT NULL, -- success, failure, pending
  execution_time_ms INTEGER,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  provider_name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tool_runs_correlation_id ON tool_runs(correlation_id);
CREATE INDEX idx_tool_runs_session_id ON tool_runs(session_id);
CREATE INDEX idx_tool_runs_user_id ON tool_runs(user_id);
CREATE INDEX idx_tool_runs_tool_name ON tool_runs(tool_name);
CREATE INDEX idx_tool_runs_execution_status ON tool_runs(execution_status);
CREATE INDEX idx_tool_runs_created_at ON tool_runs(created_at);
