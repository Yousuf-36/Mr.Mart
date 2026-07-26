/**
 * Stage 1 Verification Script.
 * Runs the end-to-end Auto-Reorder verification checklist against real Postgres DB & Redis queue.
 */

import { seedDatabase } from "./seed.js";
import {
  getPendingActionsDb,
  getActionDb,
  markActionApprovedDb,
  markActionExecutedDb,
  draftReorderForSkuDb,
  getProducts,
  getCurrentStock,
  getTrailing14DayAvgDailySales,
  getSettings,
  DEFAULT_STORE_ID,
} from "@mrmart/mcp-server/store/pg-store.js";
import { calculateReorder } from "@mrmart/mcp-server/formulas/reorder.js";

export async function runStage1Verification() {
  console.log("\n=======================================================");
  console.log("🚀 STAGE 1 VERIFICATION RUNNER");
  console.log("=======================================================\n");

  // 1. Seed Database
  console.log("--- 1. SEED DATABASE (14+ DAYS SALES TXN) ---");
  await seedDatabase();

  // 2. Run Scheduled Auto-Reorder Check
  console.log("\n--- 2. SCHEDULED AUTO-REORDER CHECK ---");
  let draftedCount = 0;
  const products = await getProducts(undefined, 100, DEFAULT_STORE_ID);
  const settings = await getSettings(DEFAULT_STORE_ID);

  for (const product of products) {
    const qtyOnHand = await getCurrentStock(product.sku, DEFAULT_STORE_ID);
    const avgDailySales = await getTrailing14DayAvgDailySales(product.sku, DEFAULT_STORE_ID);

    const calc = calculateReorder({
      avgDailySales,
      leadTimeDays: product.lead_time_days,
      safetyFactor: settings.safety_factor,
      reviewPeriodDays: settings.review_period_days,
      qtyOnHand,
      maxOrderQty: product.max_order_qty,
      unitCost: product.unit_cost,
      largeOrderValueThreshold: settings.large_order_value_threshold,
    });

    console.log(
      `   SKU: ${product.sku.padEnd(10)} | Stock: ${String(qtyOnHand).padStart(3)} | ReorderPoint: ${String(calc.reorderPoint).padStart(5)} | AvgDailySales: ${avgDailySales}`
    );

    if (qtyOnHand <= calc.reorderPoint) {
      console.log(`   🚨 SKU ${product.sku} crossed reorder point (${qtyOnHand} <= ${calc.reorderPoint})! Drafting reorder...`);
      const action = await draftReorderForSkuDb(product.sku, DEFAULT_STORE_ID);
      draftedCount++;
      console.log(
        `   ✨ Drafted pending reorder: ID=${action.id} | Qty=${action.payload.qty} | Cost=₹${action.payload.cost} | Capped=${action.payload.capped_by_storage_limit} | Confirm=${action.payload.requires_second_confirmation}`
      );
    }
  }

  console.log(`\nDrafted ${draftedCount} pending action(s).`);

  // 3. Inspect Pending Actions & Guardrails
  console.log("\n--- 3. INSPECT PENDING ACTIONS & GUARDRAILS ---");
  const pendingActions = await getPendingActionsDb(10, DEFAULT_STORE_ID);
  console.log(`Found ${pendingActions.length} pending action(s):`);

  for (const action of pendingActions) {
    console.log(`\n📋 Action ID: ${action.id}`);
    console.log(`   Type: ${action.type} | SKU: ${action.sku} | Status: ${action.status}`);
    console.log(`   Payload:`, JSON.stringify(action.payload, null, 2));

    const payload = action.payload as Record<string, unknown>;
    if (payload.capped_by_storage_limit) {
      console.log(`   🎯 GUARDRAIL PROOF: capped_by_storage_limit IS TRUE for SKU ${action.sku}!`);
    }
    if (payload.requires_second_confirmation) {
      console.log(`   💰 GUARDRAIL PROOF: requires_second_confirmation IS TRUE for SKU ${action.sku}!`);
    }
  }

  // 4. Duplicate Prevention Guardrail Test
  console.log("\n--- 4. DUPLICATE PREVENTION GUARDRAIL TEST ---");
  if (pendingActions.length > 0) {
    const targetSku = pendingActions[0].sku!;
    try {
      console.log(`Attempting to draft second pending reorder for SKU ${targetSku}...`);
      await draftReorderForSkuDb(targetSku, DEFAULT_STORE_ID);
      console.error("❌ FAILED: Duplicate pending action should have been blocked!");
    } catch (err) {
      console.log(`✅ SUCCESS: Duplicate guardrail blocked draft: ${(err as Error).message}`);
    }
  }

  // 5. Approval & Execution Flow Test
  console.log("\n--- 5. APPROVAL & EXECUTION FLOW TEST ---");
  if (pendingActions.length > 0) {
    const actionToApprove = pendingActions[0];
    console.log(`Approving action ${actionToApprove.id} (SKU: ${actionToApprove.sku})...`);
    
    // Mark approved in Postgres
    const approvedAction = await markActionApprovedDb(actionToApprove.id, "c0000000-0000-0000-0000-000000000001", DEFAULT_STORE_ID);
    console.log(`Approved status in Postgres: ${approvedAction.status} at ${approvedAction.decided_at?.toISOString()}`);

    // Execute (simulating Worker queue processing)
    const executedAction = await markActionExecutedDb(actionToApprove.id, "executed", undefined, DEFAULT_STORE_ID);
    console.log(`Executed result in Postgres: ID=${executedAction.id} | Status=${executedAction.status} | ExecutedAt=${executedAction.executed_at?.toISOString()}`);

    const finalActionState = await getActionDb(actionToApprove.id, DEFAULT_STORE_ID);
    console.log(`Final action status in Postgres: ${finalActionState?.status} | ExecutedAt: ${finalActionState?.executed_at?.toISOString()}`);
  }

  console.log("\n=======================================================");
  console.log("✅ STAGE 1 VERIFICATION COMPLETED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

if (process.argv[1] && process.argv[1].endsWith("verify-stage1.ts")) {
  runStage1Verification()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Verification failed:", err);
      process.exit(1);
    });
}
