CREATE TABLE registered_accommodations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(50) NOT NULL DEFAULT 'sltda',
  source_record_id VARCHAR(255),
  property_name VARCHAR(500) NOT NULL,
  normalized_name VARCHAR(500) NOT NULL,
  category VARCHAR(100),
  classification VARCHAR(100),
  star_rating NUMERIC(2,1),
  room_count INTEGER,
  address TEXT,
  normalized_address TEXT,
  district VARCHAR(150),
  local_authority VARCHAR(255),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  website TEXT,
  normalized_domain VARCHAR(255),
  telephone VARCHAR(100),
  registration_number VARCHAR(255),
  licence_number VARCHAR(255),
  licence_valid_until DATE,
  licence_status VARCHAR(50),
  source_url TEXT,
  source_updated_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_source_data JSONB
);

CREATE UNIQUE INDEX registered_accommodations_registration_number_idx
  ON registered_accommodations (registration_number)
  WHERE registration_number IS NOT NULL;
CREATE INDEX registered_accommodations_normalized_name_idx
  ON registered_accommodations (normalized_name);
CREATE INDEX registered_accommodations_district_idx
  ON registered_accommodations (district);
CREATE INDEX registered_accommodations_licence_validity_idx
  ON registered_accommodations (licence_valid_until);
