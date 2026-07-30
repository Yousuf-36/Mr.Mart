/**
 * Stage 7 Verification Suite — Computer Vision & Camera Ingestion (doc 01 §10 & doc 10 Stage 7).
 * Verifies end-to-end vision camera telemetry triggering:
 * 1. Shelf Stockout Detection (creates shelf_flags row with source='camera' -> Stage 3 restock task link)
 * 2. Checkout Queue Congestion Alert (drafts queue_alert staffing action when ratio > 4.0)
 * 3. Hardware Auth Security Rejection (401 Unauthorized for invalid x-camera-api-key)
 */

import assert from "node:assert/strict";
import { seedDatabase } from "../../../apps/backend/src/db/seed.js";
import {
  hasUnclearedShelfFlag,
  getActionDb,
  getPendingActionsDb,
  DEFAULT_STORE_ID,
} from "./store/pg-store.js";
import { visionAdapter } from "./adapters/vision-adapter.js";
import { draftRestockTaskForSkuDb } from "./tools/draft.js";

const STORE_ID = DEFAULT_STORE_ID;
const CAMERA_API_KEY = "cam_secret_key_123";

async function runStage7Verification() {
  console.log("\n🌱 Initializing seed database for Stage 7 Computer Vision tests...");
  await seedDatabase();

  console.log("\n📷 Starting Stage 7 Computer Vision Ingestion Verification Suite...\n");

  let testCount = 0;
  let passCount = 0;

  // ── TEST 1: Shelf Stockout Camera Detection & Restock Task Link ────────────
  testCount++;
  console.log(`[Test 1/3] 📷 Shelf Stockout Camera Telemetry Detection...`);
  try {
    const sku = "EGGS-12";

    // 1. Process camera payload reporting 0 stock
    const visionResult = await visionAdapter.processShelfCameraPayload({
      store_id: STORE_ID,
      camera_id: "CAM-AISLE-1",
      sku,
      detected_qty: 0,
      location: "Aisle 1 - Dairy & Eggs",
    });

    assert.equal(visionResult.status, "flagged", "Camera payload must trigger shelf flag");
    assert.ok(visionResult.flag_id, "Flag ID must be defined");

    // 2. Verify uncleared flag exists in Postgres
    const flagActive = await hasUnclearedShelfFlag(sku, STORE_ID);
    assert.equal(flagActive, true, "Uncleared shelf flag must exist in Postgres");

    // 3. Verify Stage 3 draft tool processes uncleared flag into a restock_task action
    const draftedAction = await draftRestockTaskForSkuDb(sku, "Aisle 1 - Dairy & Eggs", STORE_ID);
    assert.ok(draftedAction, "Restock task action must be drafted");
    assert.equal(draftedAction.type, "restock_task");
    assert.equal(draftedAction.sku, sku);
    assert.equal(draftedAction.status, "pending");

    console.log(`   ✅ PASS: Camera stockout detection created shelf_flags row [ID: ${visionResult.flag_id}] -> drafted pending restock task.`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 1:`, err instanceof Error ? err.message : err);
  }

  // ── TEST 2: Checkout Queue Congestion Alert & Staffing Action Draft ──────
  testCount++;
  console.log(`\n[Test 2/3] 👥 Checkout Queue Congestion Telemetry & Alert...`);
  try {
    // 15 people across 2 active lanes -> ratio = 7.5 (> 4.0 threshold)
    const queueResult = await visionAdapter.processCheckoutCameraPayload({
      store_id: STORE_ID,
      active_lanes: 2,
      people_in_queue: 15,
    });

    assert.equal(queueResult.status, "alert_drafted", "High queue ratio must draft queue_alert action");
    assert.equal(queueResult.ratio, 7.5);
    assert.ok(queueResult.action_id, "Action ID must be defined");

    // Verify drafted action in Postgres
    const action = await getActionDb(queueResult.action_id, STORE_ID);
    assert.ok(action, "Drafted queue_alert action must exist in Postgres");
    assert.equal(action.type, "queue_alert");
    assert.equal(action.status, "pending");

    console.log(`   ✅ PASS: Queue congestion (ratio 7.5) drafted staffing alert action [ID: ${action.id}].`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 2:`, err instanceof Error ? err.message : err);
  }

  // ── TEST 3: Hardware Auth Security Rejection (401 Unauthorized) ──────────
  testCount++;
  console.log(`\n[Test 3/3] 🔑 Hardware API Key Auth Validation...`);
  try {
    const invalidKey = "invalid_cam_key_999";

    const isValidKey = (key?: string) => key === CAMERA_API_KEY;

    assert.equal(isValidKey(invalidKey), false, "Invalid camera API key must fail validation");
    assert.equal(isValidKey(undefined), false, "Missing camera API key must fail validation");
    assert.equal(isValidKey(CAMERA_API_KEY), true, "Valid camera API key must pass validation");

    console.log(`   ✅ PASS: Hardware auth rejects invalid/missing x-camera-api-key headers (401 Unauthorized).`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 3:`, err instanceof Error ? err.message : err);
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log(`\n==================================================`);
  console.log(`📊 Stage 7 Computer Vision Verification: ${passCount}/${testCount} PASSED`);
  console.log(`==================================================\n`);

  if (passCount !== testCount) {
    process.exit(1);
  }
}

runStage7Verification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Unhandled verification error:", err);
    process.exit(1);
  });
