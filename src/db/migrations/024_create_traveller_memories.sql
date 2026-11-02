CREATE TABLE traveller_memories (
  memory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('profile','trip','task')),
  context_id TEXT,
  memory_key VARCHAR(64) NOT NULL CHECK (memory_key IN ('occasion','companion_name','companion_relationship','preference','dislike','dietary_requirement','allergy','accessibility_need','budget_preference','communication_preference')),
  memory_value VARCHAR(300) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('proposed','confirmed','rejected','superseded')),
  sensitive BOOLEAN NOT NULL DEFAULT false,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  explicit BOOLEAN NOT NULL DEFAULT true,
  source_message_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, source_message_id, scope, memory_key, memory_value)
);
CREATE INDEX traveller_memories_context_idx ON traveller_memories(user_id, scope, context_id, status, updated_at DESC);
CREATE INDEX traveller_memories_expiry_idx ON traveller_memories(expires_at) WHERE expires_at IS NOT NULL;
