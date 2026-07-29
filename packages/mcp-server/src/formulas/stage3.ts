/**
 * Stage 3 pure formula functions — doc 03 §2–7.
 * Pure functions with zero database dependencies for 100% testability.
 * All thresholds are passed as arguments (read from settings table by callers).
 */

// ── Expiry Markdown (doc 03 §2) ───────────────────────────────────────────────

export interface MarkdownResult {
  newPrice: number;
  discountPct: number;
  cappedAtFloor: boolean;
  /** Human-readable label shown on the Approval Card badge */
  label: string;
}

/**
 * Calculates the markdown price for a batch entering its expiry window.
 *
 * Formula: new_price = original_price × (1 − discount_pct)
 * Price floor: max(new_price, unit_cost × (1 + min_margin_pct))
 *
 * @param originalPrice  Current shelf price (₹)
 * @param unitCost       Product cost price (₹) — sets the price floor
 * @param daysLeft       Integer days until expiry (0 = today, negative = past)
 * @param markdownCurve  Days → discount fraction, e.g. { "3": 0.10, "2": 0.25, "1": 0.40, "0": 0.50 }
 * @param minMarginPct   Minimum margin fraction (0.02 = 2%)
 */
export function calculateMarkdownPrice(
  originalPrice: number,
  unitCost: number,
  daysLeft: number,
  markdownCurve: Record<string, number>,
  minMarginPct: number
): MarkdownResult {
  // Find the smallest curve key that is >= daysLeft (e.g. daysLeft=1 matches key 1 for 40% off)
  const curveKey = Object.keys(markdownCurve)
    .map(Number)
    .filter((k) => daysLeft <= k)
    .sort((a, b) => a - b)[0];

  const rawDiscountPct = curveKey !== undefined ? markdownCurve[String(curveKey)] : 0.5;
  const priceFloor = parseFloat((unitCost * (1 + minMarginPct)).toFixed(2));
  const rawNewPrice = parseFloat((originalPrice * (1 - rawDiscountPct)).toFixed(2));

  const cappedAtFloor = rawNewPrice < priceFloor;
  const newPrice = cappedAtFloor ? priceFloor : rawNewPrice;
  const actualDiscountPct = parseFloat(((originalPrice - newPrice) / originalPrice).toFixed(4));

  return {
    newPrice,
    discountPct: cappedAtFloor ? actualDiscountPct : rawDiscountPct,
    cappedAtFloor,
    label: cappedAtFloor ? "near-cost clearance" : `${Math.round(rawDiscountPct * 100)}% off`,
  };
}

// ── Expiry Write-off (doc 03 §3) ──────────────────────────────────────────────

export interface WriteoffResult {
  writeoffQty: number;
  writeoffValue: number;
}

/**
 * doc 03 §3:
 *   writeoff_qty  = remaining batch_qty
 *   writeoff_value = writeoff_qty × unit_cost
 */
export function calculateWriteoffValue(batchQty: number, unitCost: number): WriteoffResult {
  const writeoffQty = batchQty;
  const writeoffValue = parseFloat((writeoffQty * unitCost).toFixed(2));
  return { writeoffQty, writeoffValue };
}

// ── Shelf Restock Task (doc 03 §4) ───────────────────────────────────────────

export interface RestockResult {
  restockQty: number;
  /** True when backroom_qty = 0 — this is a stockout, not a restock situation */
  blockedByZeroBackroom: boolean;
}

/**
 * doc 03 §4:
 *   restock_qty = min(shelf_capacity − shelf_qty_estimate, backroom_qty)
 *
 * On a manual empty-flag, shelf_qty_estimate = 0.
 * If backroom_qty = 0, the automation does not fire — routes to Auto-Reorder.
 */
export function calculateRestockQty(
  shelfCapacity: number,
  shelfQtyEstimate: number,
  backroomQty: number
): RestockResult {
  if (backroomQty <= 0) {
    return { restockQty: 0, blockedByZeroBackroom: true };
  }
  const shelfGap = Math.max(0, shelfCapacity - shelfQtyEstimate);
  const restockQty = Math.min(shelfGap, backroomQty);
  return { restockQty, blockedByZeroBackroom: false };
}

// ── Slow-Mover Flag (doc 03 §5) ──────────────────────────────────────────────

/**
 * doc 03 §5 trigger condition:
 *   trailing_7d_avg < (1 − drop_threshold) × trailing_30d_avg
 *
 * Default dropThreshold = 0.40 → a SKU is slow if its recent week is more than
 * 40% below its 30-day baseline (i.e. 7d avg < 0.6 × 30d avg).
 *
 * Returns false when 30d average is zero — no baseline to compare against.
 */
export function isSlowMover(
  trailing7dAvg: number,
  trailing30dAvg: number,
  dropThreshold: number = 0.40
): boolean {
  if (trailing30dAvg <= 0) return false;
  const retentionThreshold = 1 - dropThreshold; // 0.60
  return trailing7dAvg < retentionThreshold * trailing30dAvg;
}

/**
 * doc 03 §5: suggested_new_reorder_point = current_reorder_point × 0.5
 */
export function calculateSlowMoverReorderPoint(currentReorderPoint: number): number {
  return parseFloat((currentReorderPoint * 0.5).toFixed(2));
}

// ── Day-Close Reconciliation (doc 03 §7) ─────────────────────────────────────

export interface DiscrepancyResult {
  /** Signed: positive = cash over, negative = cash short */
  discrepancy: number;
  absDiscrepancy: number;
  /** True only if |discrepancy| strictly exceeds discrepancy_threshold */
  flagged: boolean;
}

/**
 * doc 03 §7:
 *   discrepancy = actual_cash − expected_cash   (signed)
 *   flagged     = |discrepancy| > discrepancy_threshold
 */
export function calculateDiscrepancy(
  actualCash: number,
  expectedCash: number,
  discrepancyThreshold: number = 200
): DiscrepancyResult {
  const discrepancy = parseFloat((actualCash - expectedCash).toFixed(2));
  const absDiscrepancy = Math.abs(discrepancy);
  const flagged = absDiscrepancy > discrepancyThreshold;
  return { discrepancy, absDiscrepancy, flagged };
}
