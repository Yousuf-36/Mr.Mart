/**
 * Stage 6 Verification Suite — External System Integrations & Hardware I/O (doc 06 & doc 10 DoD).
 * Verifies live integration adapters:
 * 1. Supplier PO Gateway Adapter (Structured Purchase Order payload, PO ID, HTTP 201 status)
 * 2. POS/ERP & Electronic Shelf Tag Adapter (Stock adjustments, shelf price updates)
 * 3. Notification & Webhook Alert Adapter (Webhook alert payloads & deep-link dispatch)
 */

import assert from "node:assert/strict";
import { seedDatabase } from "../../../apps/backend/src/db/seed.js";
import { createPendingActionDb, DEFAULT_STORE_ID } from "./store/pg-store.js";
import { executeByType } from "./tools/execute.js";
import { posAdapter } from "./adapters/pos-adapter.js";
import { supplierAdapter } from "./adapters/supplier-adapter.js";
import { notificationAdapter } from "./adapters/notification-adapter.js";

const STORE_ID = DEFAULT_STORE_ID;

async function runStage6Verification() {
  console.log("\n🌱 Initializing seed database for Stage 6 Integration tests...");
  await seedDatabase();

  console.log("\n🔌 Starting Stage 6 External Integrations Verification Suite...\n");

  let testCount = 0;
  let passCount = 0;

  // Clear adapter histories
  posAdapter.clearEvents();
  supplierAdapter.clearEvents();
  notificationAdapter.clearEvents();

  // ── TEST 1: Supplier Purchase Order Gateway Dispatch ──────────────────────
  testCount++;
  console.log(`[Test 1/3] 📦 Supplier Purchase Order Gateway Dispatch...`);
  try {
    const reorderAction = await createPendingActionDb(
      "reorder",
      "RICE-5KG",
      {
        product_name: "Basmati Rice 5kg",
        supplier: "Metro Staples Wholesale",
        supplier_phone: "+919876500002",
        qty: 10,
        cost: 6000,
        unit_cost: 600,
        expected_delivery_date: "2026-08-01",
      },
      STORE_ID
    );

    const execResult = await executeByType(reorderAction);
    assert.equal(execResult.status, "executed", "Action must execute cleanly");

    const pos = supplierAdapter.getDispatchedPOs();
    assert.equal(pos.length, 1, "Supplier Adapter must receive 1 purchase order dispatch");

    const po = pos[0];
    assert.ok(po.po_id.startsWith("PO-"), `PO ID must start with 'PO-': got ${po.po_id}`);
    assert.equal(po.supplier, "Metro Staples Wholesale");
    assert.equal(po.sku, "RICE-5KG");
    assert.equal(po.qty, 10);
    assert.equal(po.unit_cost, 600);
    assert.equal(po.total_cost, 6000);
    assert.equal(po.http_status, 201);
    assert.equal(po.status, "dispatched");

    console.log(`   ✅ PASS: Purchase Order ${po.po_id} formatted and dispatched with HTTP 201 status.`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 1:`, err instanceof Error ? err.message : err);
  }

  // ── TEST 2: POS Inventory Sync & Electronic Shelf Tag Price Update ────────
  testCount++;
  console.log(`\n[Test 2/3] 🛒 POS/ERP Inventory & Electronic Shelf Tag Sync...`);
  try {
    // 1. Spoilage Write-off Sync
    const writeoffAction = await createPendingActionDb(
      "writeoff",
      "MILK-1L",
      { product_name: "Full Cream Milk 1L", qty: 2, value: 116 },
      STORE_ID
    );

    const writeoffExec = await executeByType(writeoffAction);
    assert.equal(writeoffExec.status, "executed");

    const stockEvents = posAdapter.getStockEvents();
    assert.ok(stockEvents.length >= 1, "POS adapter must receive stock adjustment");
    const writeoffSync = stockEvents.find((e) => e.reason === "spoilage_writeoff");
    assert.ok(writeoffSync, "POS adapter must log spoilage_writeoff event");
    assert.equal(writeoffSync.sku, "MILK-1L");
    assert.equal(writeoffSync.qty_change, -2);
    assert.equal(writeoffSync.status, "synced");

    // 2. Markdown Price Update
    const markdownAction = await createPendingActionDb(
      "markdown",
      "BREAD-WW",
      { product_name: "Whole Wheat Bread", discount_pct: 0.25, new_price: 36, qty: 5 },
      STORE_ID
    );

    const markdownExec = await executeByType(markdownAction);
    assert.equal(markdownExec.status, "executed");

    const priceEvents = posAdapter.getPriceEvents();
    assert.equal(priceEvents.length, 1, "POS adapter must receive 1 shelf price update");
    assert.equal(priceEvents[0].sku, "BREAD-WW");
    assert.equal(priceEvents[0].new_price, 36);
    assert.equal(priceEvents[0].status, "updated");

    console.log(`   ✅ PASS: POS stock balance synced (-2 units) & electronic shelf price updated to ₹36.`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 2:`, err instanceof Error ? err.message : err);
  }

  // ── TEST 3: Notification Webhook & Deep-Link Dispatch ────────────────────
  testCount++;
  console.log(`\n[Test 3/3] 🔔 Webhook Alert & Deep-Link Dispatch...`);
  try {
    const dayCloseAction = await createPendingActionDb(
      "day_close",
      null,
      { cash_amount: 12500, digital_amount: 18400, discrepancy: 0 },
      STORE_ID
    );

    const execResult = await executeByType(dayCloseAction);
    assert.equal(execResult.status, "executed");

    const alerts = notificationAdapter.getAlerts();
    assert.ok(alerts.length >= 1, "Notification Adapter must receive Webhook alert dispatch");

    const alert = alerts.find((a) => a.action_id === dayCloseAction.id);
    assert.ok(alert, "Alert for day_close action must be present");
    assert.ok(alert.webhook_id.startsWith("wh-"), `Webhook ID must start with 'wh-': got ${alert.webhook_id}`);
    assert.ok(alert.deep_link.startsWith("mrmart://actions/"), `Deep link must start with 'mrmart://actions/': got ${alert.deep_link}`);
    assert.equal(alert.http_status, 200);
    assert.equal(alert.status, "delivered");

    console.log(`   ✅ PASS: Webhook alert ${alert.webhook_id} dispatched with deep-link (${alert.deep_link}) [HTTP 200].`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 3:`, err instanceof Error ? err.message : err);
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log(`\n==================================================`);
  console.log(`📊 Stage 6 Integration Verification: ${passCount}/${testCount} PASSED`);
  console.log(`==================================================\n`);

  if (passCount !== testCount) {
    process.exit(1);
  }
}

runStage6Verification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Unhandled verification error:", err);
    process.exit(1);
  });
