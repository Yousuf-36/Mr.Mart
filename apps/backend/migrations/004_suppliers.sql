-- Migration 004: suppliers
-- Each supplier belongs to one store. Used in Auto-Reorder and Supplier Follow-up.
-- Doc 04: suppliers table spec.

BEGIN;

CREATE TABLE IF NOT EXISTS suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT,                -- WhatsApp number for reorder messages
  email           TEXT,                -- fallback contact
  lead_time_days  INT NOT NULL DEFAULT 2,  -- used in reorder-point formula (doc 03 §1)
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS suppliers_store_id_idx ON suppliers (store_id);

COMMIT;
