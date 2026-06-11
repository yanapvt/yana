-- Migration: 004_create_schemas
-- Description: Create schemas and schema_versions tables
-- Requirements: 16.2

-- Schemas table (schema registry)
CREATE TABLE schemas (
  schema_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_name VARCHAR(255) UNIQUE NOT NULL,
  current_version VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schemas_schema_name ON schemas(schema_name);

-- Schema versions (versioned schema definitions)
CREATE TABLE schema_versions (
  version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_id UUID NOT NULL REFERENCES schemas(schema_id) ON DELETE CASCADE,
  version VARCHAR(50) NOT NULL,
  required_fields JSONB NOT NULL DEFAULT '[]',
  optional_fields JSONB NOT NULL DEFAULT '[]',
  fields JSONB NOT NULL DEFAULT '{}',
  metadata JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(schema_id, version)
);

CREATE INDEX idx_schema_versions_schema_id ON schema_versions(schema_id);
CREATE INDEX idx_schema_versions_is_active ON schema_versions(is_active);
