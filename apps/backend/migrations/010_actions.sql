-- Migration 010: actions
-- THE single most important table in the schema (doc 04).
-- The full automation/approval audit trail. Append/update-only — no deletes ever.
-- Every trigger-to-execution chain is reconstructable from this table alone.

BEGIN;

CREATE TABLE IF NOT EXISTS actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  type            TEXT NOT NULL CHECK (type IN (
                    'reorder',
                    'markdown',
                    'writeoff',
                    'restock_task',
                    'reorder_point_adjustment',
                    'supplier_message',
                    'day_close',
                    'queue_alert'
                  )),
  sku             TEXT,                         -- null for day_close
  payload         JSONB NOT NULL DEFAULT '{}',  -- type-specific fields (doc 03 formulas)
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed')),
  escalated       BOOLEAN NOT NULL DEFAULT FALSE,  -- flips TRUE once escalation window passes
  decided_by      UUID REFERENCES staff(id) ON DELETE SET NULL,   -- who approved/rejected
  reject_reason   TEXT,
  failure_reason  TEXT,                         -- set on 'failed' status
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at      TIMESTAMPTZ,
  executed_at     TIMESTAMPTZ
);

-- Approval Queue screen query: pending actions for a store, escalated first
CREATE INDEX IF NOT EXISTS actions_store_status_esc_idx ON actions (store_id, status, escalated DESC, created_at DESC);

-- "No duplicate pending action per SKU+type" guardrail (doc 04)
CREATE UNIQUE INDEX IF NOT EXISTS actions_no_dup_pending_idx
  ON actions (store_id, sku, type)
  WHERE status = 'pending';

-- Backfill the ref_action_id FK in stock_ledger now that actions table exists
ALTER TABLE stock_ledger
  ADD CONSTRAINT stock_ledger_ref_action_fk
  FOREIGN KEY (ref_action_id) REFERENCES actions(id) ON DELETE SET NULL;

-- audit FKs: ON DELETE SET NULL so audit rows never disappear if product/staff deactivated
-- sku FK is enforced via the (sku, store_id) composite key on products
-- We defer this to avoid circular dependency — actions references staff, staff is already created

COMMIT;
