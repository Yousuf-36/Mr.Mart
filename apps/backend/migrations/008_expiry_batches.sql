-- Migration 008: expiry_batches
-- Tracks individual delivery batches for perishable products.
-- Drives the Expiry Markdown and Expiry Write-off automations.
-- Doc 04: expiry_batches table spec.

BEGIN;

CREATE TABLE IF NOT EXISTS expiry_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          TEXT NOT NULL,
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  batch_qty    NUMERIC(10,2) NOT NULL,   -- remaining quantity in this batch
  expiry_date  DATE NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (sku, store_id) REFERENCES products(sku, store_id) ON DELETE CASCADE
);

-- Hot path: "which batches are approaching expiry?" (doc 04 indexing notes)
CREATE INDEX IF NOT EXISTS expiry_batches_sku_expiry_idx   ON expiry_batches (sku, store_id, expiry_date ASC);
CREATE INDEX IF NOT EXISTS expiry_batches_store_expiry_idx ON expiry_batches (store_id, expiry_date ASC);

COMMIT;
