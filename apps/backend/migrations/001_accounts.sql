-- Migration 001: accounts & subscriptions
-- Multi-tenant root tables. Every stores row will reference accounts.id.
-- Built from day one per the non-negotiable product rule #4.
-- Doc 09 defines plan structure; doc 04 confirms the FK chain.

BEGIN;

CREATE TABLE IF NOT EXISTS accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  owner_phone      TEXT NOT NULL,          -- WhatsApp number, primary identity
  plan             TEXT NOT NULL DEFAULT 'trial'
                   CHECK (plan IN ('trial', 'starter', 'growth', 'pro')),
  trial_ends_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one account per phone number
CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_phone_idx ON accounts (owner_phone);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plan                 TEXT NOT NULL CHECK (plan IN ('trial', 'starter', 'growth', 'pro')),
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'past_due', 'cancelled')),
  billing_provider     TEXT,                -- 'stripe' | 'razorpay' | null (trial)
  external_customer_id TEXT,               -- Stripe customer ID or Razorpay customer ID
  billing_cycle_start  TIMESTAMPTZ,
  billing_cycle_end    TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_account_id_idx ON subscriptions (account_id);

COMMIT;
