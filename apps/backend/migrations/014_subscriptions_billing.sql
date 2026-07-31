-- Migration 014: SaaS Billing, Account Status & Subscription Management
-- Stage 8 SaaS Billing per doc 09 & doc 10 Stage 8

BEGIN;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

COMMIT;
