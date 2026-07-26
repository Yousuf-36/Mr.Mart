-- Migration 011: settings
-- One row per store. Every configurable threshold from doc 03 lives here so
-- it can be tuned without a redeploy. Doc 04: settings table spec with defaults.

BEGIN;

CREATE TABLE IF NOT EXISTS settings (
  store_id                          UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,

  -- Reorder point formula (doc 03 §1)
  safety_factor                     NUMERIC(4,2) NOT NULL DEFAULT 1.3,
  review_period_days                INT NOT NULL DEFAULT 1,

  -- Financial guardrails
  large_order_value_threshold       NUMERIC(12,2) NOT NULL DEFAULT 5000,

  -- Expiry Markdown curve (doc 03 §2)
  -- JSONB: { "3": 0.10, "2": 0.25, "1": 0.40, "0": 0.50 }
  -- Keys = days_until_expiry, values = discount fraction
  markdown_threshold_days           INT NOT NULL DEFAULT 3,
  markdown_curve                    JSONB NOT NULL DEFAULT '{"3":0.10,"2":0.25,"1":0.40,"0":0.50}',
  min_margin_pct                    NUMERIC(4,3) NOT NULL DEFAULT 0.02,

  -- Slow-Mover detection (doc 03 §5)
  slowmover_drop_pct                NUMERIC(4,2) NOT NULL DEFAULT 0.40,
  slowmover_window_days             INT NOT NULL DEFAULT 7,

  -- Day-Close Reconciliation (doc 03 §7)
  discrepancy_threshold             NUMERIC(12,2) NOT NULL DEFAULT 200,
  day_close_time                    TIME NOT NULL DEFAULT '21:00:00',

  -- Escalation windows (doc 04)
  reorder_escalation_hours          INT NOT NULL DEFAULT 48,
  markdown_escalation               TEXT NOT NULL DEFAULT 'same_day',
  restock_escalation_hours          INT NOT NULL DEFAULT 2,
  supplier_followup_escalation_hours INT NOT NULL DEFAULT 24,

  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
