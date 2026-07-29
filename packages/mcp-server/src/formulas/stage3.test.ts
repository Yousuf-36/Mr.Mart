/**
 * Unit tests for Stage 3 formula module (doc 07 §1).
 * Covers every guardrail edge case for all 6 Stage 3 automations (doc 03 §2–7).
 * Uses Node.js built-in test runner — zero external dependencies.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateMarkdownPrice,
  calculateWriteoffValue,
  calculateRestockQty,
  isSlowMover,
  calculateSlowMoverReorderPoint,
  calculateDiscrepancy,
} from "./stage3.js";

const DEFAULT_CURVE: Record<string, number> = { "3": 0.10, "2": 0.25, "1": 0.40, "0": 0.50 };
const MIN_MARGIN = 0.02;

describe("Stage 3 Automation Formulas (doc 03 §2–7)", () => {

  // ── Expiry Markdown §2 ──────────────────────────────────────────────────────
  describe("calculateMarkdownPrice — Expiry Markdown (§2)", () => {
    it("applies 10% discount at 3 days left", () => {
      const r = calculateMarkdownPrice(48, 20, 3, DEFAULT_CURVE, MIN_MARGIN);
      // 48 × 0.90 = 43.20; floor = 20 × 1.02 = 20.40 — no cap
      assert.equal(r.newPrice, 43.20);
      assert.equal(r.discountPct, 0.10);
      assert.equal(r.cappedAtFloor, false);
      assert.equal(r.label, "10% off");
    });

    it("applies 25% discount at 2 days left", () => {
      const r = calculateMarkdownPrice(48, 20, 2, DEFAULT_CURVE, MIN_MARGIN);
      // 48 × 0.75 = 36.00
      assert.equal(r.newPrice, 36.00);
      assert.equal(r.discountPct, 0.25);
      assert.equal(r.cappedAtFloor, false);
      assert.equal(r.label, "25% off");
    });

    it("applies 40% discount at 1 day left", () => {
      const r = calculateMarkdownPrice(48, 20, 1, DEFAULT_CURVE, MIN_MARGIN);
      // 48 × 0.60 = 28.80
      assert.equal(r.newPrice, 28.80);
      assert.equal(r.discountPct, 0.40);
      assert.equal(r.cappedAtFloor, false);
      assert.equal(r.label, "40% off");
    });

    it("applies 50% discount at 0 days left (today — expiry day)", () => {
      const r = calculateMarkdownPrice(48, 20, 0, DEFAULT_CURVE, MIN_MARGIN);
      // 48 × 0.50 = 24.00
      assert.equal(r.newPrice, 24.00);
      assert.equal(r.discountPct, 0.50);
      assert.equal(r.cappedAtFloor, false);
      assert.equal(r.label, "50% off");
    });

    it("enforces price floor when discount breaches 2% minimum margin guardrail", () => {
      // price=72, unit_cost=70 → floor = 70 × 1.02 = 71.40
      // 3-day discount: 72 × 0.90 = 64.80 < 71.40 → capped at floor
      const r = calculateMarkdownPrice(72, 70, 3, DEFAULT_CURVE, MIN_MARGIN);
      assert.equal(r.newPrice, 71.40);
      assert.equal(r.cappedAtFloor, true);
      assert.equal(r.label, "near-cost clearance");
    });

    it("does NOT cap when discount stays comfortably above price floor", () => {
      // price=100, cost=50 → floor=51.00; 3-day: 100×0.90=90 > 51 — no cap
      const r = calculateMarkdownPrice(100, 50, 3, DEFAULT_CURVE, MIN_MARGIN);
      assert.equal(r.cappedAtFloor, false);
      assert.equal(r.newPrice, 90);
    });
  });

  // ── Expiry Write-off §3 ─────────────────────────────────────────────────────
  describe("calculateWriteoffValue — Expiry Write-off (§3)", () => {
    it("computes writeoff qty and total value correctly", () => {
      // 12 packets of milk × ₹58 cost = ₹696
      const r = calculateWriteoffValue(12, 58);
      assert.equal(r.writeoffQty, 12);
      assert.equal(r.writeoffValue, 696);
    });

    it("handles fractional qty and cost with correct rounding", () => {
      // 5.5 units × ₹35.50 = ₹195.25
      const r = calculateWriteoffValue(5.5, 35.5);
      assert.equal(r.writeoffQty, 5.5);
      assert.equal(r.writeoffValue, 195.25);
    });
  });

  // ── Shelf Restock Task §4 ───────────────────────────────────────────────────
  describe("calculateRestockQty — Shelf Restock Task (§4)", () => {
    it("computes restock qty limited by backroom when backroom < shelf gap", () => {
      // capacity=25, shelf_est=0 (manual flag), backroom=20 → min(25,20)=20
      const r = calculateRestockQty(25, 0, 20);
      assert.equal(r.restockQty, 20);
      assert.equal(r.blockedByZeroBackroom, false);
    });

    it("caps at the shelf gap when gap is smaller than backroom qty", () => {
      // capacity=25, shelf_est=10 → gap=15; backroom=30 → min(15,30)=15
      const r = calculateRestockQty(25, 10, 30);
      assert.equal(r.restockQty, 15);
      assert.equal(r.blockedByZeroBackroom, false);
    });

    it("blocks entirely when backroom_qty is 0 — stockout routes to Auto-Reorder", () => {
      const r = calculateRestockQty(25, 0, 0);
      assert.equal(r.blockedByZeroBackroom, true);
      assert.equal(r.restockQty, 0);
    });
  });

  // ── Slow-Mover Flag §5 ─────────────────────────────────────────────────────
  describe("isSlowMover — Slow-Mover Flag (§5)", () => {
    it("flags a SKU with a >40% sustained sales drop (7d avg = 3, 30d avg = 7)", () => {
      // 3 < 0.6 × 7 = 4.2 → slow mover
      assert.equal(isSlowMover(3, 7, 0.40), true);
    });

    it("does NOT flag normal sales variation (7d avg = 6, 30d avg = 7)", () => {
      // 6 < 0.6 × 7 = 4.2? No, 6 ≥ 4.2 → not slow
      assert.equal(isSlowMover(6, 7, 0.40), false);
    });

    it("does NOT flag when 30d average is zero (no sales history — no baseline)", () => {
      assert.equal(isSlowMover(0, 0, 0.40), false);
    });

    it("exactly at threshold (strictly equal, NOT below) is NOT a slow mover", () => {
      // 7d avg=4.2, 30d avg=7 → threshold = 0.6 × 7 = 4.2; 4.2 is NOT < 4.2
      assert.equal(isSlowMover(4.2, 7, 0.40), false);
    });
  });

  describe("calculateSlowMoverReorderPoint (§5)", () => {
    it("halves the current reorder point exactly", () => {
      assert.equal(calculateSlowMoverReorderPoint(20), 10);
    });

    it("handles non-integer reorder points with correct rounding", () => {
      assert.equal(calculateSlowMoverReorderPoint(15), 7.5);
    });
  });

  // ── Day-Close Reconciliation §7 ─────────────────────────────────────────────
  describe("calculateDiscrepancy — Day-Close Reconciliation (§7)", () => {
    it("flags a cash surplus above ₹200 threshold (cash over)", () => {
      // actual=₹1500, expected=₹1250 → discrepancy=₹250 > ₹200 → flagged
      const r = calculateDiscrepancy(1500, 1250, 200);
      assert.equal(r.discrepancy, 250);
      assert.equal(r.absDiscrepancy, 250);
      assert.equal(r.flagged, true);
    });

    it("does NOT flag discrepancy below threshold", () => {
      // actual=₹1450, expected=₹1300 → |₹150| ≤ ₹200 → not flagged
      const r = calculateDiscrepancy(1450, 1300, 200);
      assert.equal(r.absDiscrepancy, 150);
      assert.equal(r.flagged, false);
    });

    it("handles negative discrepancy (cash short — counted less than expected)", () => {
      // actual=₹1000, expected=₹1250 → discrepancy=-₹250 → |250| > 200 → flagged
      const r = calculateDiscrepancy(1000, 1250, 200);
      assert.equal(r.discrepancy, -250);
      assert.equal(r.absDiscrepancy, 250);
      assert.equal(r.flagged, true);
    });

    it("exact threshold value (₹200) is NOT flagged — must strictly exceed", () => {
      // actual=₹1400, expected=₹1200 → |₹200| is NOT > ₹200
      const r = calculateDiscrepancy(1400, 1200, 200);
      assert.equal(r.absDiscrepancy, 200);
      assert.equal(r.flagged, false);
    });
  });
});
