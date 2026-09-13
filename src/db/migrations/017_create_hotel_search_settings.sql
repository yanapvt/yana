CREATE TABLE IF NOT EXISTS hotel_search_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sltda_filter_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  zero_result_fallback_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  minimum_google_rating NUMERIC(2,1),
  minimum_google_review_count INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
