CREATE TABLE rejected_hotel_inventory_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correlation_id TEXT NOT NULL,
  rejection_reason TEXT NOT NULL,
  yana_hotel_id TEXT NOT NULL,
  hotel_name TEXT NOT NULL,
  destination TEXT,
  supplier TEXT,
  supplier_hotel_id TEXT,
  room_name TEXT,
  returned_amount NUMERIC(14,2),
  currency VARCHAR(10),
  available BOOLEAN,
  bookable BOOLEAN,
  sanitized_details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX rejected_hotel_inventory_audit_correlation_idx
  ON rejected_hotel_inventory_audit (correlation_id);
CREATE INDEX rejected_hotel_inventory_audit_occurred_at_idx
  ON rejected_hotel_inventory_audit (occurred_at);
CREATE INDEX rejected_hotel_inventory_audit_supplier_idx
  ON rejected_hotel_inventory_audit (supplier);
CREATE INDEX rejected_hotel_inventory_audit_reason_idx
  ON rejected_hotel_inventory_audit (rejection_reason);
