/**
 * Postgres database data access layer for Mr. Mart MCP server (Stage 1–3).
 * All tools use this module; mock-store.ts is preserved for legacy reference only.
 * Doc 04 is the authoritative schema reference.
 */

import pg from "pg";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import {
  calculateReorder,
  ReorderCalculationResult,
} from "../formulas/reorder.js";

dotenv.config();

import { pool, query } from "../db/index.js";
export { pool, query };

export const DEFAULT_STORE_ID = "b0000000-0000-0000-0000-000000000001";

export interface DbProduct {
  sku: string;
  store_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  lead_time_days: number;
  name: string;
  photo_url: string | null;
  placeholder_category_icon: string;
  category: string;
  unit: string;
  unit_cost: number;
  price: number;
  reorder_point: number;
  max_order_qty: number;
  shelf_capacity: number;
  shelf_life_days: number | null;
  active: boolean;
}

export interface DbSettings {
  store_id: string;
  safety_factor: number;
  review_period_days: number;
  large_order_value_threshold: number;
  /** Days before expiry at which the markdown automation fires (default 3) */
  markdown_threshold_days: number;
  /** Minimum margin fraction (default 0.02 = 2%) — sets the markdown price floor */
  min_margin_pct: number;
  /** Discount curve: { "3": 0.10, "2": 0.25, "1": 0.40, "0": 0.50 } */
  markdown_curve: Record<string, number>;
  /** Drop fraction that triggers slow-mover flag (default 0.40 = 40%) */
  slowmover_drop_pct: number;
  /** Rolling window for slow-mover detection in days (default 7) */
  slowmover_window_days: number;
  /** Cash discrepancy above this value (₹) triggers a day-close flag */
  discrepancy_threshold: number;
}

export interface DbAction {
  id: string;
  store_id: string;
  type: string;
  sku: string | null;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  escalated: boolean;
  decided_by: string | null;
  reject_reason: string | null;
  failure_reason: string | null;
  created_at: Date;
  decided_at: Date | null;
  executed_at: Date | null;
}

export function computeStockStatus(qty: number, reorderPoint: number): "green" | "yellow" | "red" {
  if (qty <= reorderPoint) return "red";
  if (qty <= reorderPoint * 1.5) return "yellow";
  return "green";
}

// ── Store & Settings ─────────────────────────────────────────────────────────

export async function getSettings(storeId: string = DEFAULT_STORE_ID): Promise<DbSettings> {
  const res = await query<Omit<DbSettings, "markdown_curve"> & { markdown_curve: unknown }>(
    `SELECT store_id,
            safety_factor::float,
            review_period_days,
            large_order_value_threshold::float,
            markdown_threshold_days,
            min_margin_pct::float,
            markdown_curve,
            slowmover_drop_pct::float,
            slowmover_window_days,
            discrepancy_threshold::float
     FROM settings WHERE store_id = $1`,
    [storeId]
  );
  if (res.rows.length === 0) {
    return {
      store_id: storeId,
      safety_factor: 1.3,
      review_period_days: 1,
      large_order_value_threshold: 5000,
      markdown_threshold_days: 3,
      min_margin_pct: 0.02,
      markdown_curve: { "3": 0.10, "2": 0.25, "1": 0.40, "0": 0.50 },
      slowmover_drop_pct: 0.40,
      slowmover_window_days: 7,
      discrepancy_threshold: 200,
    };
  }
  const row = res.rows[0];
  return {
    ...row,
    markdown_curve: (typeof row.markdown_curve === "object" && row.markdown_curve !== null)
      ? row.markdown_curve as Record<string, number>
      : { "3": 0.10, "2": 0.25, "1": 0.40, "0": 0.50 },
  };
}

// ── Product Queries ──────────────────────────────────────────────────────────

export async function getProduct(sku: string, storeId: string = DEFAULT_STORE_ID): Promise<DbProduct | null> {
  const res = await query<DbProduct>(
    `SELECT p.sku, p.store_id, p.supplier_id, s.name as supplier_name, s.phone as supplier_phone,
            COALESCE(s.lead_time_days, 2) as lead_time_days, p.name, p.photo_url,
            '📦' as placeholder_category_icon, p.category, p.unit,
            p.unit_cost::float, p.price::float, p.reorder_point::float,
            p.max_order_qty::float, p.shelf_capacity::float, p.shelf_life_days, p.active
     FROM products p
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     WHERE p.sku = $1 AND p.store_id = $2 AND p.active = true`,
    [sku, storeId]
  );
  return res.rows[0] ?? null;
}

export async function getProducts(category?: string, limit: number = 15, storeId: string = DEFAULT_STORE_ID): Promise<DbProduct[]> {
  let sqlText = `
    SELECT p.sku, p.store_id, p.supplier_id, s.name as supplier_name, s.phone as supplier_phone,
           COALESCE(s.lead_time_days, 2) as lead_time_days, p.name, p.photo_url,
           '📦' as placeholder_category_icon, p.category, p.unit,
           p.unit_cost::float, p.price::float, p.reorder_point::float,
           p.max_order_qty::float, p.shelf_capacity::float, p.shelf_life_days, p.active
    FROM products p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.store_id = $1 AND p.active = true
  `;
  const params: unknown[] = [storeId];

  if (category) {
    sqlText += ` AND LOWER(p.category) = LOWER($2)`;
    params.push(category);
  }

  sqlText += ` ORDER BY p.sku LIMIT $${params.length + 1}`;
  params.push(limit);

  const res = await query(sqlText, params);
  return res.rows as DbProduct[];
}

// ── Live Computations ─────────────────────────────────────────────────────────

export async function getCurrentStock(sku: string, storeId: string = DEFAULT_STORE_ID): Promise<number> {
  const res = await query<{ current_stock: number }>(
    `SELECT COALESCE(SUM(delta_qty), 0)::float as current_stock
     FROM stock_ledger
     WHERE sku = $1 AND store_id = $2`,
    [sku, storeId]
  );
  return res.rows[0]?.current_stock ?? 0;
}

export async function getTrailing14DayAvgDailySales(sku: string, storeId: string = DEFAULT_STORE_ID): Promise<number> {
  const res = await query<{ total_qty: number }>(
    `SELECT COALESCE(SUM(qty), 0)::float as total_qty
     FROM sales_txn
     WHERE sku = $1 AND store_id = $2 AND created_at >= NOW() - INTERVAL '14 days'`,
    [sku, storeId]
  );
  const totalQty = res.rows[0]?.total_qty ?? 0;
  return parseFloat((totalQty / 14.0).toFixed(2));
}

// ── Actions & Guardrails ──────────────────────────────────────────────────────

/**
 * Guardrail (doc 03 §1, D-4 fix): blocks when an active action already exists for this
 * sku+type combination. "Active" means pending, approved, or executing —
 * not just pending — so drafts cannot slip through mid-execution.
 */
export async function hasPendingAction(sku: string | null, type: string, storeId: string = DEFAULT_STORE_ID): Promise<boolean> {
  if (sku === null) {
    // day_close and other null-sku types need IS NULL comparison
    const res = await query(
      `SELECT id FROM actions
       WHERE store_id = $1 AND sku IS NULL AND type = $2
         AND status IN ('pending', 'approved', 'executing')
       LIMIT 1`,
      [storeId, type]
    );
    return res.rows.length > 0;
  }
  const res = await query(
    `SELECT id FROM actions
     WHERE store_id = $1 AND sku = $2 AND type = $3
       AND status IN ('pending', 'approved', 'executing')
     LIMIT 1`,
    [storeId, sku, type]
  );
  return res.rows.length > 0;
}

export async function createPendingActionDb(
  type: string,
  sku: string | null,
  payload: Record<string, unknown>,
  storeId: string = DEFAULT_STORE_ID
): Promise<DbAction> {
  try {
    const res = await query<DbAction>(
      `INSERT INTO actions (id, store_id, type, sku, payload, status, escalated)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'pending', false)
       RETURNING id, store_id, type, sku, payload, status, escalated, decided_by, reject_reason, failure_reason, created_at, decided_at, executed_at`,
      [uuidv4(), storeId, type, sku, JSON.stringify(payload)]
    );
    return res.rows[0];
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      throw new Error(`Duplicate pending action guardrail: a pending ${type} action already exists for SKU ${sku}`);
    }
    throw err;
  }
}

export async function getActionDb(actionId: string, storeId: string = DEFAULT_STORE_ID): Promise<DbAction | null> {
  const res = await query<DbAction>(
    `SELECT id, store_id, type, sku, payload, status, escalated, decided_by, reject_reason, failure_reason, created_at, decided_at, executed_at
     FROM actions WHERE id = $1 AND store_id = $2`,
    [actionId, storeId]
  );
  return res.rows[0] ?? null;
}

export async function getPendingActionsDb(limit: number = 15, storeId: string = DEFAULT_STORE_ID): Promise<DbAction[]> {
  const res = await query<DbAction>(
    `SELECT id, store_id, type, sku, payload, status, escalated, decided_by, reject_reason, failure_reason, created_at, decided_at, executed_at
     FROM actions
     WHERE store_id = $1 AND status = 'pending'
     ORDER BY escalated DESC, created_at DESC
     LIMIT $2`,
    [storeId, limit]
  );
  return res.rows;
}

export async function executeActionWithLockDb(actionId: string, storeId: string = DEFAULT_STORE_ID): Promise<DbAction | null> {
  const res = await query<DbAction>(
    `SELECT id, store_id, type, sku, payload, status, escalated, decided_by, reject_reason, failure_reason, created_at, decided_at, executed_at
     FROM actions
     WHERE id = $1::uuid AND store_id = $2::uuid`,
    [actionId, storeId]
  );
  return res.rows[0] ?? null;
}

export async function markActionApprovedDb(actionId: string, decidedBy: string = "c0000000-0000-0000-0000-000000000001", storeId: string = DEFAULT_STORE_ID): Promise<DbAction> {
  const res = await query<DbAction>(
    `UPDATE actions
     SET status = 'approved', decided_at = NOW(), decided_by = $1, failure_reason = NULL
     WHERE id = $2 AND store_id = $3 AND status IN ('pending', 'failed')
     RETURNING id, store_id, type, sku, payload, status, escalated, decided_by, reject_reason, failure_reason, created_at, decided_at, executed_at`,
    [decidedBy, actionId, storeId]
  );
  if (res.rows.length === 0) {
    throw new Error(`Action not found or not in pending/failed state: ${actionId}`);
  }
  return res.rows[0];
}

export async function markActionExecutedDb(actionId: string, status: "executed" | "failed" = "executed", failureReason?: string, storeId: string = DEFAULT_STORE_ID): Promise<DbAction> {
  const res = await query<DbAction>(
    `UPDATE actions
     SET status = $1, executed_at = NOW(), failure_reason = $2
     WHERE id = $3 AND store_id = $4
     RETURNING id, store_id, type, sku, payload, status, escalated, decided_by, reject_reason, failure_reason, created_at, decided_at, executed_at`,
    [status, failureReason ?? null, actionId, storeId]
  );
  return res.rows[0];
}

export async function markActionRejectedDb(actionId: string, reason?: string, decidedBy: string = "c0000000-0000-0000-0000-000000000001", storeId: string = DEFAULT_STORE_ID): Promise<DbAction> {
  const res = await query<DbAction>(
    `UPDATE actions
     SET status = 'rejected', decided_at = NOW(), reject_reason = $1, decided_by = $2
     WHERE id = $3 AND store_id = $4 AND status = 'pending'
     RETURNING id, store_id, type, sku, payload, status, escalated, decided_by, reject_reason, failure_reason, created_at, decided_at, executed_at`,
    [reason ?? null, decidedBy, actionId, storeId]
  );
  if (res.rows.length === 0) {
    throw new Error(`Action not found or not pending: ${actionId}`);
  }
  return res.rows[0];
}

// ── Auto-Reorder Business Logic Execution ─────────────────────────────────────

export async function draftReorderForSkuDb(sku: string, storeId: string = DEFAULT_STORE_ID): Promise<DbAction> {
  const product = await getProduct(sku, storeId);
  if (!product) throw new Error(`Product not found: ${sku}`);

  const settings = await getSettings(storeId);
  const qtyOnHand = await getCurrentStock(sku, storeId);
  const avgDailySales = await getTrailing14DayAvgDailySales(sku, storeId);

  // Compute formulas
  const calc: ReorderCalculationResult = calculateReorder({
    avgDailySales,
    leadTimeDays: product.lead_time_days,
    safetyFactor: settings.safety_factor,
    reviewPeriodDays: settings.review_period_days,
    qtyOnHand,
    maxOrderQty: product.max_order_qty,
    unitCost: product.unit_cost,
    largeOrderValueThreshold: settings.large_order_value_threshold,
  });

  if (qtyOnHand > calc.reorderPoint) {
    throw new Error(`Stock (${qtyOnHand}) is above reorder point (${calc.reorderPoint}) — no reorder needed`);
  }

  // Guardrail 3: No duplicate pending action
  const exists = await hasPendingAction(sku, "reorder", storeId);
  if (exists) {
    throw new Error(`Duplicate pending action guardrail: a pending reorder already exists for SKU ${sku}`);
  }

  // expected_delivery_date used by Supplier Follow-up (doc 03 §6) to detect missed deliveries
  const expectedDeliveryDate = new Date(Date.now() + product.lead_time_days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const payload = {
    sku,
    product_name: product.name,
    supplier: product.supplier_name ?? "Unknown Supplier",
    supplier_phone: product.supplier_phone ?? null,
    qty: calc.suggestedQty,
    cost: calc.orderCost,
    unit_cost: product.unit_cost,
    unit: product.unit,
    avg_daily_sales: avgDailySales,
    reorder_point: calc.reorderPoint,
    qty_on_hand: qtyOnHand,
    capped_by_storage_limit: calc.cappedByStorageLimit,
    requires_second_confirmation: calc.requiresSecondConfirmation,
    expected_delivery_date: expectedDeliveryDate,
  };

  return createPendingActionDb("reorder", sku, payload, storeId);
}

// ── Stage 3: Expiry Batch Queries (doc 03 §2–3) ───────────────────────────────

export interface DbExpiryBatch {
  id: string;
  sku: string;
  batch_qty: number;
  expiry_date: Date;
  days_left: number;
}

/**
 * Returns all batches with remaining stock that are within the markdown window.
 * days_left > 0 → markdown candidate; days_left <= 0 → write-off candidate.
 */
export async function getExpiryBatchesDue(
  thresholdDays: number,
  storeId: string = DEFAULT_STORE_ID
): Promise<DbExpiryBatch[]> {
  const res = await query<DbExpiryBatch>(
    `SELECT id, sku, batch_qty::float, expiry_date,
            (expiry_date::date - CURRENT_DATE)::int AS days_left
     FROM expiry_batches
     WHERE store_id = $1
       AND batch_qty > 0
       AND (expiry_date::date - CURRENT_DATE) <= $2
     ORDER BY expiry_date ASC`,
    [storeId, thresholdDays]
  );
  return res.rows;
}

/** Fetches a single expiry batch by ID (must have remaining qty). */
export async function getExpiryBatch(
  batchId: string,
  storeId: string = DEFAULT_STORE_ID
): Promise<DbExpiryBatch | null> {
  const res = await query<DbExpiryBatch>(
    `SELECT id, sku, batch_qty::float, expiry_date,
            (expiry_date::date - CURRENT_DATE)::int AS days_left
     FROM expiry_batches
     WHERE id = $1 AND store_id = $2 AND batch_qty > 0`,
    [batchId, storeId]
  );
  return res.rows[0] ?? null;
}

/**
 * Returns true when a pending/approved/executing markdown action already targets this batch.
 * Prevents duplicate markdown cards for the same batch.
 */
export async function hasPendingMarkdownForBatch(
  batchId: string,
  storeId: string = DEFAULT_STORE_ID
): Promise<boolean> {
  const res = await query(
    `SELECT id FROM actions
     WHERE store_id = $1
       AND type = 'markdown'
       AND status IN ('pending', 'approved', 'executing')
       AND payload->>'batch_id' = $2
     LIMIT 1`,
    [storeId, batchId]
  );
  return res.rows.length > 0;
}

/**
 * Write-off guardrail (doc 03 §3): returns true when a markdown action for this batch
 * has already been approved, executed, or rejected — meaning the markdown window elapsed.
 * Write-off must not fire before markdown had its chance to clear stock.
 */
export async function markdownElapsedForBatch(
  batchId: string,
  storeId: string = DEFAULT_STORE_ID
): Promise<boolean> {
  const res = await query(
    `SELECT id FROM actions
     WHERE store_id = $1
       AND type = 'markdown'
       AND status IN ('approved', 'rejected', 'executed', 'failed')
       AND payload->>'batch_id' = $2
     LIMIT 1`,
    [storeId, batchId]
  );
  return res.rows.length > 0;
}

/**
 * Posts a negative stock_ledger entry for an expiry write-off execution (doc 03 §3).
 * This is the only execute-layer function with a clear Postgres write path in Stage 3.
 */
export async function postWriteoffLedgerEntry(
  sku: string,
  qty: number,
  actionId: string,
  storeId: string = DEFAULT_STORE_ID
): Promise<void> {
  await query(
    `INSERT INTO stock_ledger (id, sku, store_id, delta_qty, reason, ref_action_id)
     VALUES (gen_random_uuid(), $1, $2, $3, 'expiry_writeoff', $4)`,
    [sku, storeId, -qty, actionId]
  );
}

// ── Stage 3: Shelf Restock Queries (doc 03 §4) ────────────────────────────────

export interface DbShelfFlag {
  id: string;
  sku: string;
  location: string;
  flagged_at: Date;
}

/** Returns all uncleared shelf flags for this store, oldest first. */
export async function getActiveShelfFlags(
  storeId: string = DEFAULT_STORE_ID
): Promise<DbShelfFlag[]> {
  const res = await query<DbShelfFlag>(
    `SELECT id, sku, location, flagged_at
     FROM shelf_flags
     WHERE store_id = $1 AND cleared_at IS NULL
     ORDER BY flagged_at ASC`,
    [storeId]
  );
  return res.rows;
}

/** Returns the first active staff member assigned for restock tasks. */
export async function getOnDutyStaff(
  storeId: string = DEFAULT_STORE_ID
): Promise<{ id: string; name: string } | null> {
  const res = await query<{ id: string; name: string }>(
    `SELECT id, name FROM staff
     WHERE store_id = $1 AND active = true
     ORDER BY role DESC, created_at ASC
     LIMIT 1`,
    [storeId]
  );
  return res.rows[0] ?? null;
}

// ── Stage 3: Slow-Mover Queries (doc 03 §5) ───────────────────────────────────

/** Trailing 7-day average daily units sold — for slow-mover short window. */
export async function getTrailing7DayAvgDailySales(
  sku: string,
  storeId: string = DEFAULT_STORE_ID
): Promise<number> {
  const res = await query<{ total_qty: number }>(
    `SELECT COALESCE(SUM(qty), 0)::float AS total_qty
     FROM sales_txn
     WHERE sku = $1 AND store_id = $2 AND created_at >= NOW() - INTERVAL '7 days'`,
    [sku, storeId]
  );
  return parseFloat(((res.rows[0]?.total_qty ?? 0) / 7.0).toFixed(2));
}

/** Trailing 30-day average daily units sold — for slow-mover baseline. */
export async function getTrailing30DayAvgDailySales(
  sku: string,
  storeId: string = DEFAULT_STORE_ID
): Promise<number> {
  const res = await query<{ total_qty: number }>(
    `SELECT COALESCE(SUM(qty), 0)::float AS total_qty
     FROM sales_txn
     WHERE sku = $1 AND store_id = $2 AND created_at >= NOW() - INTERVAL '30 days'`,
    [sku, storeId]
  );
  return parseFloat(((res.rows[0]?.total_qty ?? 0) / 30.0).toFixed(2));
}

// ── Stage 3: Supplier Follow-up Queries (doc 03 §6) ───────────────────────────

/**
 * Returns executed reorder actions where expected_delivery_date (stored in payload) has
 * passed and no supplier_message action exists for that reorder yet.
 */
export async function getExecutedReordersPastDelivery(
  storeId: string = DEFAULT_STORE_ID
): Promise<DbAction[]> {
  const res = await query<DbAction>(
    `SELECT id, store_id, type, sku, payload, status, escalated,
            decided_by, reject_reason, failure_reason, created_at, decided_at, executed_at
     FROM actions
     WHERE store_id = $1
       AND type = 'reorder'
       AND status = 'executed'
       AND (payload->>'expected_delivery_date')::date < CURRENT_DATE
       AND NOT EXISTS (
         SELECT 1 FROM actions a2
         WHERE a2.store_id = $1
           AND a2.type = 'supplier_message'
           AND a2.payload->>'ref_action_id' = actions.id::text
           AND a2.status IN ('pending', 'approved', 'executing', 'executed')
       )
     ORDER BY executed_at DESC`,
    [storeId]
  );
  return res.rows;
}

/**
 * Returns true if a supplier follow-up for this specific reorder action already exists.
 * Prevents duplicate follow-up cards for the same missed delivery.
 */
export async function hasPendingSupplierFollowup(
  refActionId: string,
  storeId: string = DEFAULT_STORE_ID
): Promise<boolean> {
  const res = await query(
    `SELECT id FROM actions
     WHERE store_id = $1
       AND type = 'supplier_message'
       AND payload->>'ref_action_id' = $2
       AND status IN ('pending', 'approved', 'executing', 'executed')
     LIMIT 1`,
    [storeId, refActionId]
  );
  return res.rows.length > 0;
}

// ── Stage 3: Day-Close Queries (doc 03 §7) ────────────────────────────────────

/**
 * Returns today's aggregated cash and digital sales from sales_txn.
 * Used by the Day-Close draft tool to compute expected_cash.
 */
export async function getTodayCashSales(
  storeId: string = DEFAULT_STORE_ID
): Promise<{ cash_amount: number; digital_amount: number; txn_count: number }> {
  const res = await query<{ cash_amount: number; digital_amount: number; txn_count: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_type = 'cash' THEN amount ELSE 0 END), 0)::float AS cash_amount,
       COALESCE(SUM(CASE WHEN payment_type = 'digital' THEN amount ELSE 0 END), 0)::float AS digital_amount,
       COUNT(*)::int AS txn_count
     FROM sales_txn
     WHERE store_id = $1 AND created_at >= CURRENT_DATE`,
    [storeId]
  );
  return res.rows[0] ?? { cash_amount: 0, digital_amount: 0, txn_count: 0 };
}
