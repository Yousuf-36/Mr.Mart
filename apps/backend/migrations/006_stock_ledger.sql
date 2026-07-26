-- Migration 006: stock_ledger
-- Append-only. Current stock = SUM(delta_qty) per (sku, store_id).
-- Doc 04: "consider a materialized current_stock view or cached column
-- refreshed on write if this table grows large" — flagged for Stage 1.

BEGIN;

CREATE TABLE IF NOT EXISTS stock_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku             TEXT NOT NULL,
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  delta_qty       NUMERIC(10,2) NOT NULL,  -- positive = in, negative = out
  reason          TEXT NOT NULL
                  CHECK (reason IN (
                    'sale',
                    'delivery_received',
                    'manual_correction',
                    'expiry_writeoff',
                    'shrinkage'
                  )),
  ref_action_id   UUID,                   -- FK to actions added in migration 010
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft FK to products (store_id is part of the composite PK)
  FOREIGN KEY (sku, store_id) REFERENCES products(sku, store_id) ON DELETE CASCADE
);

-- Hot path: computing current stock per SKU (doc 04 indexing notes)
CREATE INDEX IF NOT EXISTS stock_ledger_sku_store_at_idx ON stock_ledger (sku, store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_ledger_store_at_idx     ON stock_ledger (store_id, created_at DESC);

COMMIT;
