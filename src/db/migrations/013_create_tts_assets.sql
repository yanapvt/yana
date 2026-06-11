-- Migration: 013_create_tts_assets
-- Description: Create tts_assets table
-- Requirements: 16.2

-- TTS assets (text-to-speech generated audio)
CREATE TABLE tts_assets (
  asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text_hash VARCHAR(64) UNIQUE NOT NULL,
  original_text TEXT NOT NULL,
  language VARCHAR(10) NOT NULL,
  audio_url TEXT NOT NULL,
  audio_format VARCHAR(20) NOT NULL,
  duration_ms INTEGER,
  provider_name VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tts_assets_text_hash ON tts_assets(text_hash);
CREATE INDEX idx_tts_assets_language ON tts_assets(language);
CREATE INDEX idx_tts_assets_created_at ON tts_assets(created_at);
CREATE INDEX idx_tts_assets_last_accessed_at ON tts_assets(last_accessed_at);
