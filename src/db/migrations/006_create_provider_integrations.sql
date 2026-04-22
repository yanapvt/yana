-- Migration: 006_create_provider_integrations
-- Description: Create provider_integrations table
-- Requirements: 16.2

-- Provider integrations (external service providers)
CREATE TABLE provider_integrations (
  provider_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name VARCHAR(255) UNIQUE NOT NULL,
  provider_type VARCHAR(100) NOT NULL, -- hotel, payment, transport, etc.
  integration_type VARCHAR(100) NOT NULL, -- nango, direct, custom
  config JSONB NOT NULL DEFAULT '{}',
  credentials_ref VARCHAR(255), -- reference to secrets manager
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  retry_policy JSONB NOT NULL DEFAULT '{}',
  rate_limit_config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_provider_integrations_provider_name ON provider_integrations(provider_name);
CREATE INDEX idx_provider_integrations_provider_type ON provider_integrations(provider_type);
CREATE INDEX idx_provider_integrations_is_enabled ON provider_integrations(is_enabled);
