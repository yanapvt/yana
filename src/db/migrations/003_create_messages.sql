-- Migration: 003_create_messages
-- Description: Create messages and message_translations tables
-- Requirements: 16.2, 16.5

-- Messages table (conversation history)
CREATE TABLE messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  correlation_id UUID NOT NULL,
  from_number VARCHAR(30) NOT NULL,
  to_number VARCHAR(30) NOT NULL,
  message_type VARCHAR(50) NOT NULL, -- text, media, audio, interactive
  role VARCHAR(20) NOT NULL, -- user, assistant, system
  content JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_correlation_id ON messages(correlation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- Message translations (multilingual support)
CREATE TABLE message_translations (
  translation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  original_text TEXT NOT NULL,
  detected_language VARCHAR(10) NOT NULL,
  translated_text TEXT NOT NULL,
  canonical_form TEXT NOT NULL,
  translation_confidence DECIMAL(5,4),
  translator_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_translations_message_id ON message_translations(message_id);
CREATE INDEX idx_message_translations_detected_language ON message_translations(detected_language);
