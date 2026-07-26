/**
 * Deterministic Auto-Reorder calculation formulas per doc 03 §1.
 * Pure functions with zero database dependencies for 100% testability.
 */

export interface ReorderPointInput {
  avgDailySales: number;
  leadTimeDays?: number | null;
  safetyFactor?: number;
}

export interface SuggestedQtyInput {
  avgDailySales: number;
  leadTimeDays?: number | null;
  reviewPeriodDays?: number;
  qtyOnHand: number;
  maxOrderQty: number;
}

export interface OrderCostInput {
  suggestedQty: number;
  unitCost: number;
  largeOrderValueThreshold?: number;
}

export interface ReorderCalculationResult {
  reorderPoint: number;
  targetStock: number;
  rawSuggestedQty: number;
  suggestedQty: number;
  cappedByStorageLimit: boolean;
  orderCost: number;
  requiresSecondConfirmation: boolean;
}

/**
 * Calculates the reorder point for a product.
 * Formula: reorder_point = avg_daily_sales * lead_time_days * safety_factor
 * Default lead_time_days = 2 if null or undefined.
 * Default safety_factor = 1.3
 */
export function calculateReorderPoint(input: ReorderPointInput): number {
  const avgSales = Math.max(0, input.avgDailySales);
  const leadTime = input.leadTimeDays ?? 2;
  const safety = input.safetyFactor ?? 1.3;

  return parseFloat((avgSales * leadTime * safety).toFixed(2));
}

/**
 * Calculates suggested reorder quantity and checks storage capacity cap.
 * Formula:
 *   target_stock = avg_daily_sales * (lead_time_days + review_period_days)
 *   raw_suggested_qty = target_stock - qty_on_hand
 *   suggested_qty = min(raw_suggested_qty, max_order_qty)
 */
export function calculateSuggestedQty(input: SuggestedQtyInput) {
  const avgSales = Math.max(0, input.avgDailySales);
  const leadTime = input.leadTimeDays ?? 2;
  const reviewPeriod = input.reviewPeriodDays ?? 1;
  const qtyOnHand = Math.max(0, input.qtyOnHand);
  const maxOrderQty = input.maxOrderQty;

  const targetStock = avgSales * (leadTime + reviewPeriod);
  const rawSuggestedQty = Math.max(0, Math.ceil(targetStock - qtyOnHand));
  const cappedByStorageLimit = rawSuggestedQty > maxOrderQty;
  const suggestedQty = Math.min(rawSuggestedQty, maxOrderQty);

  return {
    targetStock: parseFloat(targetStock.toFixed(2)),
    rawSuggestedQty,
    suggestedQty,
    cappedByStorageLimit,
  };
}

/**
 * Checks if order cost exceeds large_order_value_threshold (default ₹5,000).
 */
export function calculateLargeOrderFlag(input: OrderCostInput) {
  const threshold = input.largeOrderValueThreshold ?? 5000;
  const orderCost = parseFloat((input.suggestedQty * input.unitCost).toFixed(2));
  const requiresSecondConfirmation = orderCost > threshold;

  return {
    orderCost,
    requiresSecondConfirmation,
  };
}

/**
 * Full reorder calculation combining all steps.
 */
export function calculateReorder(
  salesInput: ReorderPointInput & SuggestedQtyInput & Omit<OrderCostInput, "suggestedQty">
): ReorderCalculationResult {
  const reorderPoint = calculateReorderPoint(salesInput);
  const { targetStock, rawSuggestedQty, suggestedQty, cappedByStorageLimit } = calculateSuggestedQty(salesInput);
  const { orderCost, requiresSecondConfirmation } = calculateLargeOrderFlag({
    suggestedQty,
    unitCost: salesInput.unitCost,
    largeOrderValueThreshold: salesInput.largeOrderValueThreshold,
  });

  return {
    reorderPoint,
    targetStock,
    rawSuggestedQty,
    suggestedQty,
    cappedByStorageLimit,
    orderCost,
    requiresSecondConfirmation,
  };
}
