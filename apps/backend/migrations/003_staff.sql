-- Migration 003: staff
-- Roles: 'owner' | 'staff'. Staff may only act on Shelf Restock Tasks.
-- Doc 04: staff table spec. Doc 05 §2: authorization enforced server-side,
-- not just by hiding buttons in the UI.

BEGIN;

CREATE TABLE IF NOT EXISTS staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,           -- WhatsApp number, used for OTP login and restock notifications
  role        TEXT NOT NULL DEFAULT 'staff'
              CHECK (role IN ('owner', 'staff')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,  -- for on-duty roster logic
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS staff_store_id_idx ON staff (store_id);
CREATE INDEX IF NOT EXISTS staff_store_active_idx ON staff (store_id, active);

-- Unique: one account per phone number within a store
CREATE UNIQUE INDEX IF NOT EXISTS staff_store_phone_idx ON staff (store_id, phone);

COMMIT;
