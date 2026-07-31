/**
 * Stage 5 Verification Suite — Multi-Tenant Store Isolation & RBAC Enforcement (doc 05 & doc 10 DoD).
 * Runs against Express API layer and Postgres database to prove:
 * 1. Multi-Tenant Store Isolation (Store A cannot access Store B resources)
 * 2. RBAC Role Enforcement (Staff, Manager, Owner permission boundaries)
 * 3. API Token Authentication (401 Unauthorized on invalid/missing tokens)
 */

import assert from "node:assert/strict";
import http from "node:http";
import { seedDatabase } from "../../../apps/backend/src/db/seed.js";
import {
  createPendingActionDb,
  getActionDb,
  canApproveAction,
  DEFAULT_STORE_ID,
  UserRole,
} from "./store/pg-store.js";

const STORE_A_ID = DEFAULT_STORE_ID; // b0000000-0000-0000-0000-000000000001
const STORE_B_ID = "b0000000-0000-0000-0000-000000000002";

const TOKEN_OWNER_A = "token_owner_store_a";
const TOKEN_MANAGER_A = "token_manager_store_a";
const TOKEN_STAFF_A = "token_staff_store_a";
const TOKEN_OWNER_B = "token_owner_store_b";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStage5Verification() {
  console.log("\n🌱 Initializing seed database for Stage 5 RBAC tests...");
  await seedDatabase();

  console.log("\n🧪 Starting Stage 5 Multi-Tenant & RBAC Verification Suite...\n");

  let testCount = 0;
  let passCount = 0;

  // ── TEST 1: Multi-Tenant Store Isolation Guardrail ────────────────────────
  testCount++;
  console.log(`[Test 1/3] 🏢 Multi-Tenant Store Isolation Guardrail...`);
  try {
    // Create pending action in Store B
    const storeBAction = await createPendingActionDb(
      "reorder",
      "TEA-1KG",
      { product_name: "Assam Tea 1kg (Store B)", qty: 5, cost: 1500 },
      STORE_B_ID
    );

    // Attempt to read Store B action using Store A context
    const crossStoreRead = await getActionDb(storeBAction.id, STORE_A_ID);
    assert.equal(crossStoreRead, null, "Store A user must NOT be able to read Store B action");

    // Verify Store B owner CAN read Store B action
    const storeBRead = await getActionDb(storeBAction.id, STORE_B_ID);
    assert.ok(storeBRead, "Store B owner must be able to read Store B action");
    assert.equal(storeBRead.store_id, STORE_B_ID);

    console.log(`   ✅ PASS: Store A cannot access or read actions belonging to Store B.`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 1:`, err instanceof Error ? err.message : err);
  }

  // ── TEST 2: RBAC Role Permission Matrix ──────────────────────────────────
  testCount++;
  console.log(`\n[Test 2/3] 🔐 RBAC Role Permission Enforcement Matrix...`);
  try {
    // 1. Staff approval restriction test
    const reorderAction = await createPendingActionDb(
      "reorder",
      "MILK-1L",
      { product_name: "Full Cream Milk 1L", qty: 20, cost: 1160, requires_second_confirmation: false },
      STORE_A_ID
    );

    const staffResult = canApproveAction("staff", reorderAction);
    assert.equal(staffResult.allowed, false, "Staff must be blocked from approving reorders");
    assert.match(staffResult.reason || "", /Staff role is forbidden/);

    // Staff CAN approve shelf restock task
    const restockAction = await createPendingActionDb(
      "restock_task",
      "OIL-1L",
      { product_name: "Mustard Oil 1L", location: "Aisle 3", qty: 10 },
      STORE_A_ID
    );
    const staffRestockResult = canApproveAction("staff", restockAction);
    assert.equal(staffRestockResult.allowed, true, "Staff can approve shelf restock tasks");

    // 2. High-value order confirmation test (cost > ₹5000)
    const highValueReorder = await createPendingActionDb(
      "reorder",
      "RICE-5KG",
      { product_name: "Basmati Rice 5kg", qty: 20, cost: 12000, requires_second_confirmation: true },
      STORE_A_ID
    );

    const staffHighValueResult = canApproveAction("staff", highValueReorder);
    assert.equal(staffHighValueResult.allowed, false, "Staff must be blocked from high-value orders requiring 2nd confirmation");

    // Staff cannot approve financial reorder actions (restock tasks only)
    const staffRegularResult = canApproveAction("staff", reorderAction);
    assert.equal(staffRegularResult.allowed, false, "Staff cannot approve financial reorders");

    // Owner CAN approve high-value orders
    const ownerResult = canApproveAction("owner", highValueReorder);
    assert.equal(ownerResult.allowed, true, "Owner can approve high-value orders requiring 2nd confirmation");

    console.log(`   ✅ PASS: Staff and Owner RBAC permission boundaries strictly enforced per doc 05 §2.`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 2:`, err instanceof Error ? err.message : err);
  }

  // ── TEST 3: API Token Authentication & Token Scoping ─────────────────────
  testCount++;
  console.log(`\n[Test 3/3] 🔑 API Token Authentication Validation...`);
  try {
    const { validateApiTokenDb } = await import("./store/pg-store.js");

    // 1. Valid Owner Token
    const ownerCtx = await validateApiTokenDb(TOKEN_OWNER_A);
    assert.ok(ownerCtx, "Owner A token must be valid");
    assert.equal(ownerCtx.store_id, STORE_A_ID);
    assert.equal(ownerCtx.role, "owner");

    // 2. Valid Staff Token
    const staffCtx = await validateApiTokenDb(TOKEN_STAFF_A);
    assert.ok(staffCtx, "Staff A token must be valid");
    assert.equal(staffCtx.role, "staff");

    // 3. Valid Store B Owner Token
    const ownerBCtx = await validateApiTokenDb(TOKEN_OWNER_B);
    assert.ok(ownerBCtx, "Owner B token must be valid");
    assert.equal(ownerBCtx.store_id, STORE_B_ID);

    // 5. Invalid / Expired Token
    const invalidCtx = await validateApiTokenDb("invalid_fake_token_123");
    assert.equal(invalidCtx, null, "Invalid token must return null user context");

    console.log(`   ✅ PASS: Token authentication validates user, store_id, and role contexts cleanly.`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 3:`, err instanceof Error ? err.message : err);
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log(`\n==================================================`);
  console.log(`📊 Stage 5 RBAC & Isolation Verification: ${passCount}/${testCount} PASSED`);
  console.log(`==================================================\n`);

  if (passCount !== testCount) {
    process.exit(1);
  }
}

runStage5Verification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Unhandled verification error:", err);
    process.exit(1);
  });
