-- Migration 002: stores
-- Each store belongs to exactly one account (multi-tenant root).
-- Doc 04: stores table spec. Doc 09 §10: every store_id must be verified
-- against account_id before trusting it from the client.

BEGIN;

CREATE TABLE IF NOT EXISTS stores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  phone       TEXT,                    -- owner's WhatsApp number for notifications
  language    TEXT NOT NULL DEFAULT 'en',  -- for the few unavoidable text labels
  timezone    TEXT NOT NULL DEFAULT 'Asia/Kolkata',  -- for day-close scheduling
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stores_account_id_idx ON stores (account_id);
CREATE INDEX IF NOT EXISTS stores_account_active_idx ON stores (account_id, active);

COMMIT;
