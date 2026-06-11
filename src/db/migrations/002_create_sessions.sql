-- Migration: 002_create_sessions
-- Description: Create sessions and session_state tables
-- Requirements: 16.2, 16.3

-- Sessions table (session lifecycle)
CREATE TABLE sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_phone_number ON sessions(phone_number);
CREATE INDEX idx_sessions_last_activity ON sessions(last_activity_at);

-- Session state (live session state)
CREATE TABLE session_state (
  session_id UUID PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  current_intent VARCHAR(255),
  current_step VARCHAR(255),
  active_schema VARCHAR(255),
  schema_version VARCHAR(50),
  missing_fields JSONB NOT NULL DEFAULT '[]',
  collected_fields JSONB NOT NULL DEFAULT '{}',
  pending_options JSONB NOT NULL DEFAULT '[]',
  booking_progress JSONB,
  payment_progress JSONB,
  conversation_history JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_session_state_active_schema ON session_state(active_schema);
