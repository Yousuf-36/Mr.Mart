-- Migration 007: sales_txn
-- Individual sale records. No customer-level PII (no customer accounts in v1).
-- Doc 04: "Index (sku, created_at), (created_at) for daily/weekly summaries."

BEGIN;

CREATE TABLE IF NOT EXISTS sales_txn (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           TEXT NOT NULL,
  store_id      UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  qty           NUMERIC(10,2) NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  payment_type  TEXT NOT NULL CHECK (payment_type IN ('cash', 'digital')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (sku, store_id) REFERENCES products(sku, store_id) ON DELETE CASCADE
);

-- Daily/weekly summary hot paths (doc 04)
CREATE INDEX IF NOT EXISTS sales_txn_sku_store_at_idx ON sales_txn (sku, store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_txn_store_at_idx     ON sales_txn (store_id, created_at DESC);

COMMIT;
