-- Migration: 001_create_users_and_profiles
-- Description: Create users, user_profiles, user_preferences, and user_language_settings tables
-- Requirements: 16.2, 16.4

-- Users table (core user identity)
CREATE TABLE users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(30) UNIQUE NOT NULL,
  phone_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_phone_number ON users(phone_number);
CREATE INDEX idx_users_phone_hash ON users(phone_hash);

-- User profiles (static profile data)
CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  name VARCHAR(255),
  nationality VARCHAR(3),
  preferred_language VARCHAR(10) NOT NULL DEFAULT 'en',
  home_location TEXT,
  preferred_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User preferences (communication preferences)
CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  tts_enabled BOOLEAN NOT NULL DEFAULT false,
  proactive_messaging_enabled BOOLEAN NOT NULL DEFAULT false,
  notification_preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User language settings (behavioral memory for language)
CREATE TABLE user_language_settings (
  user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  recent_actions JSONB NOT NULL DEFAULT '[]',
  frequent_services JSONB NOT NULL DEFAULT '[]',
  common_destinations JSONB NOT NULL DEFAULT '[]',
  preferred_vendors JSONB NOT NULL DEFAULT '[]',
  past_bookings JSONB NOT NULL DEFAULT '[]',
  timing_patterns JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
