/**
 * Postgres database data access layer for Mr. Mart MCP server (Stage 1 & 2).
 * Replaces mock-store.ts with real SQL queries against Postgres schema (docs/04).
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
  markdown_threshold_days: number;
  min_margin_pct: number;
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
  const res = await query<DbSettings>(
    `SELECT store_id, safety_factor::float, review_period_days, 
            large_order_value_threshold::float, markdown_threshold_days, min_margin_pct::float
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
    };
  }
  return res.rows[0];
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

export async function hasPendingAction(sku: string, type: string, storeId: string = DEFAULT_STORE_ID): Promise<boolean> {
  const res = await query(
    `SELECT id FROM actions WHERE store_id = $1 AND sku = $2 AND type = $3 AND status = 'pending' LIMIT 1`,
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
       VALUES ($1, $2, $3, $4, $5, 'pending', false)
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

export async function markActionApprovedDb(actionId: string, decidedBy: string = "c0000000-0000-0000-0000-000000000001", storeId: string = DEFAULT_STORE_ID): Promise<DbAction> {
  const res = await query<DbAction>(
    `UPDATE actions
     SET status = 'approved', decided_at = NOW(), decided_by = $1
     WHERE id = $2 AND store_id = $3 AND status = 'pending'
     RETURNING id, store_id, type, sku, payload, status, escalated, decided_by, reject_reason, failure_reason, created_at, decided_at, executed_at`,
    [decidedBy, actionId, storeId]
  );
  if (res.rows.length === 0) {
    throw new Error(`Action not found or not pending: ${actionId}`);
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
  };

  return createPendingActionDb("reorder", sku, payload, storeId);
}
