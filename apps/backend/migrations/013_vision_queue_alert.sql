-- Migration 013: Add queue_alert action type to actions table constraint
-- Enables Stage 7 vision ingestion camera queue congestion alerts.

BEGIN;

ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_type_check;

ALTER TABLE actions ADD CONSTRAINT actions_type_check CHECK (type IN (
  'reorder',
  'markdown',
  'writeoff',
  'restock_task',
  'reorder_point_adjustment',
  'supplier_message',
  'day_close',
  'queue_alert'
));

COMMIT;
