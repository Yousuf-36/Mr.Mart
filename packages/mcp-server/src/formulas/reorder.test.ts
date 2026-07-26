/**
 * Unit tests for Auto-Reorder formula module (doc 07 §1).
 * Tests pure formula functions independent of the database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateReorderPoint,
  calculateSuggestedQty,
  calculateLargeOrderFlag,
  calculateReorder,
} from "./reorder.js";

describe("Auto-Reorder Formulas (doc 03 §1)", () => {
  describe("calculateReorderPoint", () => {
    it("computes reorder_point across standard matrix (avgSales * leadTime * safetyFactor)", () => {
      // 10 sales/day * 2 days lead time * 1.3 safety = 26
      assert.equal(
        calculateReorderPoint({ avgDailySales: 10, leadTimeDays: 2, safetyFactor: 1.3 }),
        26
      );

      // 5 sales/day * 3 days lead time * 1.5 safety = 22.5
      assert.equal(
        calculateReorderPoint({ avgDailySales: 5, leadTimeDays: 3, safetyFactor: 1.5 }),
        22.5
      );
    });

    it("handles zero sales history cleanly (reorder_point = 0)", () => {
      assert.equal(
        calculateReorderPoint({ avgDailySales: 0, leadTimeDays: 2, safetyFactor: 1.3 }),
        0
      );
    });

    it("defaults lead_time_days to 2 when missing or null", () => {
      // 10 * 2 (default) * 1.3 = 26
      assert.equal(
        calculateReorderPoint({ avgDailySales: 10, leadTimeDays: null, safetyFactor: 1.3 }),
        26
      );
      assert.equal(
        calculateReorderPoint({ avgDailySales: 10, leadTimeDays: undefined, safetyFactor: 1.3 }),
        26
      );
    });

    it("defaults safety_factor to 1.3 when omitted", () => {
      // 10 * 2 * 1.3 (default) = 26
      assert.equal(
        calculateReorderPoint({ avgDailySales: 10, leadTimeDays: 2 }),
        26
      );
    });
  });

  describe("calculateSuggestedQty & Storage Cap Guardrail", () => {
    it("computes suggested_qty without storage cap when below max_order_qty", () => {
      // target_stock = 10 * (2 + 1) = 30; qty_on_hand = 5 => raw_suggested = 25
      // max_order_qty = 50 => suggested_qty = 25, capped = false
      const result = calculateSuggestedQty({
        avgDailySales: 10,
        leadTimeDays: 2,
        reviewPeriodDays: 1,
        qtyOnHand: 5,
        maxOrderQty: 50,
      });

      assert.equal(result.targetStock, 30);
      assert.equal(result.rawSuggestedQty, 25);
      assert.equal(result.suggestedQty, 25);
      assert.equal(result.cappedByStorageLimit, false);
    });

    it("engages max_order_qty cap and sets cappedByStorageLimit flag when exceeded", () => {
      // target_stock = 10 * (2 + 1) = 30; qty_on_hand = 2 => raw_suggested = 28
      // max_order_qty = 20 => suggested_qty = 20, capped = true
      const result = calculateSuggestedQty({
        avgDailySales: 10,
        leadTimeDays: 2,
        reviewPeriodDays: 1,
        qtyOnHand: 2,
        maxOrderQty: 20,
      });

      assert.equal(result.targetStock, 30);
      assert.equal(result.rawSuggestedQty, 28);
      assert.equal(result.suggestedQty, 20); // capped at maxOrderQty (20)
      assert.equal(result.cappedByStorageLimit, true);
    });
  });

  describe("calculateLargeOrderFlag Guardrail", () => {
    it("does not flag orders below large_order_value_threshold", () => {
      // 10 units * ₹300 = ₹3,000 <= ₹5,000 threshold
      const result = calculateLargeOrderFlag({
        suggestedQty: 10,
        unitCost: 300,
        largeOrderValueThreshold: 5000,
      });

      assert.equal(result.orderCost, 3000);
      assert.equal(result.requiresSecondConfirmation, false);
    });

    it("triggers requiresSecondConfirmation flag when cost exceeds threshold", () => {
      // 20 units * ₹320 = ₹6,400 > ₹5,000 threshold
      const result = calculateLargeOrderFlag({
        suggestedQty: 20,
        unitCost: 320,
        largeOrderValueThreshold: 5000,
      });

      assert.equal(result.orderCost, 6400);
      assert.equal(result.requiresSecondConfirmation, true);
    });
  });

  describe("calculateReorder (full formula integration)", () => {
    it("combines reorder point, storage cap, and large order threshold cleanly", () => {
      // RICE-5KG example:
      // avgDailySales = 6, leadTime = 2, reviewPeriod = 1, qtyOnHand = 4, unitCost = 320, maxOrderQty = 25
      // reorderPoint = 6 * 2 * 1.3 = 15.6
      // targetStock = 6 * (2 + 1) = 18
      // rawSuggestedQty = 18 - 4 = 14
      // cappedByStorageLimit = false (14 <= 25)
      // orderCost = 14 * 320 = 4480 <= 5000 => requiresSecondConfirmation = false
      const result = calculateReorder({
        avgDailySales: 6,
        leadTimeDays: 2,
        reviewPeriodDays: 1,
        qtyOnHand: 4,
        maxOrderQty: 25,
        unitCost: 320,
        largeOrderValueThreshold: 5000,
      });

      assert.equal(result.reorderPoint, 15.6);
      assert.equal(result.suggestedQty, 14);
      assert.equal(result.cappedByStorageLimit, false);
      assert.equal(result.orderCost, 4480);
      assert.equal(result.requiresSecondConfirmation, false);
    });
  });
});
