-- Migration 005: products
-- SKU is the natural key per doc 04; store_id scopes it per store.
-- Note: (sku, store_id) is the effective PK — same SKU code can exist in
-- different stores without collision.

BEGIN;

CREATE TABLE IF NOT EXISTS products (
  sku               TEXT NOT NULL,
  store_id          UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier_id       UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  photo_url         TEXT,                    -- null → frontend uses placeholder_category_icon
  category          TEXT NOT NULL DEFAULT 'General',
  unit              TEXT NOT NULL DEFAULT 'unit',  -- e.g. 'packet', 'bag', 'bottle'
  unit_cost         NUMERIC(12,2) NOT NULL DEFAULT 0,
  price             NUMERIC(12,2) NOT NULL DEFAULT 0,
  reorder_point     NUMERIC(10,2) NOT NULL DEFAULT 10,   -- recomputed nightly by Worker
  max_order_qty     NUMERIC(10,2) NOT NULL DEFAULT 100,  -- storage-capacity cap
  shelf_capacity    NUMERIC(10,2) NOT NULL DEFAULT 50,   -- facings × units-per-facing
  shelf_life_days   INT,                     -- null = non-perishable
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (sku, store_id)
);

-- Hot paths per doc 04 indexing notes
CREATE INDEX IF NOT EXISTS products_store_category_idx ON products (store_id, category);
CREATE INDEX IF NOT EXISTS products_store_active_idx   ON products (store_id, active);
CREATE INDEX IF NOT EXISTS products_supplier_idx       ON products (supplier_id);

COMMIT;
