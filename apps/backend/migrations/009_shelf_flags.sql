-- Migration 009: shelf_flags
-- Manual or camera-detected signals that a shelf is empty.
-- Triggers the Shelf Restock Task automation.
-- Doc 04: shelf_flags table spec.

BEGIN;

CREATE TABLE IF NOT EXISTS shelf_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         TEXT NOT NULL,
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  location    TEXT NOT NULL,                  -- aisle/shelf label (e.g. "A3-Middle")
  flagged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at  TIMESTAMPTZ,                    -- set when Shelf Restock Task executes
  source      TEXT NOT NULL DEFAULT 'manual'
              CHECK (source IN ('camera', 'manual')),

  FOREIGN KEY (sku, store_id) REFERENCES products(sku, store_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS shelf_flags_store_cleared_idx ON shelf_flags (store_id, cleared_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS shelf_flags_sku_store_idx     ON shelf_flags (sku, store_id);

COMMIT;
