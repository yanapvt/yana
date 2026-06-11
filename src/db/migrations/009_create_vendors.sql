-- Migration: 009_create_vendors
-- Description: Create vendors, vendor_preferences, and vendor_language_settings tables
-- Requirements: 16.2

-- Vendors table (external service providers)
CREATE TABLE vendors (
  vendor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name VARCHAR(255) NOT NULL,
  vendor_type VARCHAR(100) NOT NULL, -- hotel, transport, excursion, restaurant, etc.
  whatsapp_numbers JSONB NOT NULL DEFAULT '[]',
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  coverage_areas JSONB NOT NULL DEFAULT '[]',
  operating_hours JSONB NOT NULL DEFAULT '{}',
  sla_config JSONB NOT NULL DEFAULT '{}',
  scoring_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vendors_vendor_type ON vendors(vendor_type);
CREATE INDEX idx_vendors_is_verified ON vendors(is_verified);
CREATE INDEX idx_vendors_is_active ON vendors(is_active);

-- Vendor preferences (vendor communication preferences)
CREATE TABLE vendor_preferences (
  vendor_id UUID PRIMARY KEY REFERENCES vendors(vendor_id) ON DELETE CASCADE,
  preferred_language VARCHAR(10) NOT NULL DEFAULT 'en',
  notification_preferences JSONB NOT NULL DEFAULT '{}',
  availability_settings JSONB NOT NULL DEFAULT '{}',
  pricing_settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vendor language settings (vendor multilingual support)
CREATE TABLE vendor_language_settings (
  vendor_id UUID PRIMARY KEY REFERENCES vendors(vendor_id) ON DELETE CASCADE,
  supported_languages JSONB NOT NULL DEFAULT '[]',
  default_language VARCHAR(10) NOT NULL DEFAULT 'en',
  translation_preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
