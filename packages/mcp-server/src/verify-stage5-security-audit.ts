/**
 * Stage 5 Security & RBAC Penetration Audit Suite (doc 05 & doc 10 DoD).
 * Tests 6 explicit attack vectors against the backend API and database persistence layer:
 *
 * 1. Horizontal Escalation (Cross-Store Data Access)
 * 2. Vertical Escalation (RBAC Role Boundaries)
 * 3. Auth Token Tampering & Injection
 * 4. State Machine Bypasses
 * 5. SQL Injection on Scoped Parameters
 * 6. MCP Context Guard Check
 */

import assert from "node:assert/strict";
import { seedDatabase } from "../../../apps/backend/src/db/seed.js";
import {
  createPendingActionDb,
  getActionDb,
  markActionApprovedDb,
  markActionExecutedDb,
  canApproveAction,
  validateApiTokenDb,
  getProducts,
  getSettings,
  getPendingActionsDb,
  DEFAULT_STORE_ID,
} from "./store/pg-store.js";

const STORE_A_ID = DEFAULT_STORE_ID;
const STORE_B_ID = "b0000000-0000-0000-0000-000000000002";

const TOKEN_OWNER_A = "token_owner_store_a";
const TOKEN_MANAGER_A = "token_manager_store_a";
const TOKEN_STAFF_A = "token_staff_store_a";
const TOKEN_OWNER_B = "token_owner_store_b";

async function runSecurityPenetrationAudit() {
  console.log("\n🌱 Initializing database for Stage 5 Security & Penetration Audit...");
  await seedDatabase();

  console.log("\n🛡️  Starting Stage 5 Security & RBAC Penetration Audit Suite...\n");

  let testCount = 0;
  let passCount = 0;

  // ── ATTACK VECTOR 1: Horizontal Escalation (Cross-Store Data Access) ─────
  testCount++;
  console.log(`[Vector 1/6] 🚨 Horizontal Escalation: Cross-Store Data Access Probe...`);
  try {
    // Seed action owned by Store B
    const storeBAction = await createPendingActionDb(
      "reorder",
      "OIL-1L",
      { product_name: "Mustard Oil 1L (Store B)", qty: 10, cost: 2000 },
      STORE_B_ID
    );

    // 1. Store A user attempts to read Store B action using Store A scope
    const crossRead = await getActionDb(storeBAction.id, STORE_A_ID);
    assert.equal(crossRead, null, "Store A context MUST return null when probing Store B action");

    // 2. Store A user attempts to approve Store B action
    try {
      await markActionApprovedDb(storeBAction.id, "c0000000-0000-0000-0000-000000000001", STORE_A_ID);
      assert.fail("Store A owner MUST NOT be able to approve Store B action");
    } catch (err: any) {
      assert.match(err.message, /Action not found or not in pending\/failed state/);
    }

    console.log(`   ✅ PASS: Store A context strictly blocked from reading or approving Store B resources.`);
    passCount++;
  } catch (err: any) {
    console.error(`   ❌ FAIL Vector 1:`, err.message);
  }

  // ── ATTACK VECTOR 2: Vertical Escalation (RBAC Role Boundaries) ─────────
  testCount++;
  console.log(`\n[Vector 2/6] 🛑 Vertical Escalation: RBAC Role Boundary Probe...`);
  try {
    // Standard reorder (cost ≤ ₹5000)
    const standardAction = await createPendingActionDb(
      "reorder",
      "MILK-1L",
      { product_name: "Full Cream Milk 1L", qty: 20, cost: 1160, requires_second_confirmation: false },
      STORE_A_ID
    );

    // High-value reorder (cost > ₹5000, requires_second_confirmation: true)
    const highValueAction = await createPendingActionDb(
      "reorder",
      "RICE-5KG",
      { product_name: "Basmati Rice 5kg", qty: 15, cost: 9000, requires_second_confirmation: true },
      STORE_A_ID
    );

    // 1. Staff role probe
    const staffCheck = canApproveAction("staff", standardAction);
    assert.equal(staffCheck.allowed, false, "Staff must be blocked from approving reorders");

    // 2. Manager role probe on high-value order
    const managerCheck = canApproveAction("manager", highValueAction);
    assert.equal(managerCheck.allowed, false, "Manager must be blocked from high-value orders requiring owner confirmation");

    // 3. Manager role probe on standard order
    const managerStdCheck = canApproveAction("manager", standardAction);
    assert.equal(managerStdCheck.allowed, true, "Manager can approve standard operational orders");

    // 4. Owner role probe on high-value order
    const ownerCheck = canApproveAction("owner", highValueAction);
    assert.equal(ownerCheck.allowed, true, "Owner can approve high-value orders requiring 2nd confirmation");

    console.log(`   ✅ PASS: Role boundaries enforced (Staff=Forbidden, Manager=Standard Only, Owner=Full Access).`);
    passCount++;
  } catch (err: any) {
    console.error(`   ❌ FAIL Vector 2:`, err.message);
  }

  // ── ATTACK VECTOR 3: Auth Token Tampering & Injection ────────────────────
  testCount++;
  console.log(`\n[Vector 3/6] 💉 Auth Token Tampering & Injection Probe...`);
  try {
    // 1. Missing token
    const nullCtx = await validateApiTokenDb("");
    assert.equal(nullCtx, null, "Empty token must return null context");

    // 2. Malformed / SQLi token string
    const sqliToken = "' OR '1'='1' --";
    const sqliCtx = await validateApiTokenDb(sqliToken);
    assert.equal(sqliCtx, null, "SQLi token string must be safely evaluated as non-matching token");

    // 3. Valid owner token
    const validCtx = await validateApiTokenDb(TOKEN_OWNER_A);
    assert.ok(validCtx);
    assert.equal(validCtx.role, "owner");

    console.log(`   ✅ PASS: Token tampering and SQLi bearer tokens safely rejected (401 Unauthorized).`);
    passCount++;
  } catch (err: any) {
    console.error(`   ❌ FAIL Vector 3:`, err.message);
  }

  // ── ATTACK VECTOR 4: State Machine Bypasses ────────────────────────────────
  testCount++;
  console.log(`\n[Vector 4/6] 🔄 State Machine Bypass Probe...`);
  try {
    const action = await createPendingActionDb(
      "markdown",
      "BREAD-WW",
      { product_name: "Whole Wheat Bread", discount_pct: 0.25, new_price: 36, qty: 5 },
      STORE_A_ID
    );

    // Approve and Execute action
    await markActionApprovedDb(action.id, "c0000000-0000-0000-0000-000000000001", STORE_A_ID);
    await markActionExecutedDb(action.id, "executed", undefined, STORE_A_ID);

    // Attempt to re-approve an already 'executed' action
    try {
      await markActionApprovedDb(action.id, "c0000000-0000-0000-0000-000000000001", STORE_A_ID);
      assert.fail("Must NOT be able to approve an already executed action");
    } catch (err: any) {
      assert.match(err.message, /Action not found or not in pending\/failed state/);
    }

    console.log(`   ✅ PASS: State machine bypass blocked (already executed actions cannot be re-approved).`);
    passCount++;
  } catch (err: any) {
    console.error(`   ❌ FAIL Vector 4:`, err.message);
  }

  // ── ATTACK VECTOR 5: SQL Injection on Scoped Parameters ─────────────────
  testCount++;
  console.log(`\n[Vector 5/6] 🛡️  SQL Injection on Scoped Parameters Probe...`);
  try {
    const sqliStoreId = "' OR 1=1 --";

    // 1. getProducts with SQLi store_id
    const productsRes = await getProducts(undefined, 10, sqliStoreId);
    assert.equal(productsRes.length, 0, "SQLi store_id must return 0 products (no data leak)");

    // 2. getSettings with SQLi store_id
    try {
      await getSettings(sqliStoreId);
      assert.fail("SQLi store_id must not find settings");
    } catch (err: any) {
      assert.match(err.message, /Settings not found/);
    }

    // 3. getPendingActionsDb with SQLi store_id
    const pendingRes = await getPendingActionsDb(10, sqliStoreId);
    assert.equal(pendingRes.length, 0, "SQLi store_id must return 0 pending actions");

    console.log(`   ✅ PASS: SQL injection strings in store_id parameter safely isolated by parameterized queries.`);
    passCount++;
  } catch (err: any) {
    console.error(`   ❌ FAIL Vector 5:`, err.message);
  }

  // ── ATTACK VECTOR 6: MCP Context Guard Check ─────────────────────────────
  testCount++;
  console.log(`\n[Vector 6/6] 🤖 MCP Context Guard Check...`);
  try {
    const invalidStoreId = "non_existent_store_999";

    // 1. getSettings with invalid store
    try {
      await getSettings(invalidStoreId);
      assert.fail("Unauthenticated store_id must be rejected");
    } catch (err: any) {
      assert.match(err.message, /Settings not found/);
    }

    // 2. getActionDb with invalid store
    const invalidAction = await getActionDb("00000000-0000-0000-0000-000000000000", invalidStoreId);
    assert.equal(invalidAction, null);

    console.log(`   ✅ PASS: Unauthenticated or non-existent store contexts fail gracefully with clean error handling.`);
    passCount++;
  } catch (err: any) {
    console.error(`   ❌ FAIL Vector 6:`, err.message);
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log(`\n==================================================`);
  console.log(`📊 Stage 5 Security Penetration Audit: ${passCount}/${testCount} VECTOR CHECKS PASSED`);
  console.log(`==================================================\n`);

  if (passCount !== testCount) {
    process.exit(1);
  }
}

runSecurityPenetrationAudit()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Unhandled penetration audit failure:", err);
    process.exit(1);
  });
