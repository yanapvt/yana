-- Compatibility schema for the existing SLTDA accommodation import.
-- CREATE TABLE IF NOT EXISTS preserves production tables and all imported rows.
CREATE TABLE IF NOT EXISTS srilanka_accommodations (
  record_key TEXT,
  directory_type_id INTEGER,
  directory_type TEXT,
  scraped_at_utc TIMESTAMPTZ,
  source_key TEXT,
  name TEXT,
  category TEXT,
  stars TEXT,
  rooms INTEGER,
  address TEXT,
  local_authority TEXT,
  website TEXT,
  email TEXT,
  registration_no TEXT,
  licence_no TEXT,
  licence_validity TEXT,
  telephone TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  image_url TEXT,
  booking_url TEXT,
  description TEXT,
  source_page_url TEXT
);

CREATE INDEX IF NOT EXISTS srilanka_accommodations_record_key_idx
  ON srilanka_accommodations (record_key);
CREATE INDEX IF NOT EXISTS srilanka_accommodations_registration_no_idx
  ON srilanka_accommodations (registration_no);
CREATE INDEX IF NOT EXISTS srilanka_accommodations_name_idx
  ON srilanka_accommodations (LOWER(name));
CREATE INDEX IF NOT EXISTS srilanka_accommodations_local_authority_idx
  ON srilanka_accommodations (LOWER(local_authority));
