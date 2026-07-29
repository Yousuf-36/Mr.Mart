/**
 * Mr. Mart Worker — Stage 3
 *
 * Runs scheduled background automations and consumes approved execution jobs
 * off the Redis queue (`mrmart-jobs`).
 *
 * Architecture (doc 01 §8):
 * - Drafts actions into Postgres (`actions` table) in 'pending' status.
 * - Executes approved actions and writes 'executed' status + executed_at to Postgres.
 * - D-3 (established pattern): Worker calls markActionExecutedDb directly for
 *   execution, bypassing the MCP execute tool layer. This is documented as the
 *   established Worker pattern for Stages 1–3.
 */

import "dotenv/config";
import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import pg from "pg";
import {
  getProducts,
  getCurrentStock,
  getTrailing14DayAvgDailySales,
  getSettings,
  hasPendingAction,
  draftReorderForSkuDb,
  getActionDb,
  markActionExecutedDb,
  postWriteoffLedgerEntry,
  getExpiryBatchesDue,
  hasPendingMarkdownForBatch,
  markdownElapsedForBatch,
  getProduct,
  getActiveShelfFlags,
  getTrailing7DayAvgDailySales,
  getTrailing30DayAvgDailySales,
  getExecutedReordersPastDelivery,
  hasPendingSupplierFollowup,
  createPendingActionDb,
  getOnDutyStaff,
  DEFAULT_STORE_ID,
} from "@mrmart/mcp-server/store/pg-store.js";
import { calculateReorder } from "@mrmart/mcp-server/formulas/reorder.js";
import {
  calculateMarkdownPrice,
  calculateWriteoffValue,
  calculateRestockQty,
  isSlowMover,
  calculateSlowMoverReorderPoint,
} from "@mrmart/mcp-server/formulas/stage3.js";

const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? undefined;
const QUEUE_NAME = "mrmart-jobs";
const REORDER_CHECK_INTERVAL_MS = parseInt(process.env.REORDER_CHECK_INTERVAL_MS ?? "900000", 10); // 15 min default

// ── Redis Connection ─────────────────────────────────────────────────────────
const connection = new IORedis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});

connection.on("connect", () => {
  console.log(`✅ Worker Redis connected (${REDIS_HOST}:${REDIS_PORT})`);
});

connection.on("error", (err) => {
  console.error("[Worker] Redis connection error:", err.message);
});

export const jobQueue = new Queue(QUEUE_NAME, { connection });

// ── Worker Job Consumer ───────────────────────────────────────────────────────
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[Worker] Processing job ${job.id} (attempt ${job.attemptsMade + 1}) | name: ${job.name} | data:`, job.data);

    if (job.name === "execute") {
      const { action_id, simulate_failure } = job.data as { action_id: string; simulate_failure?: boolean };

      // Fault injection: force failure if requested by test
      if (simulate_failure) {
        console.warn(`[Worker EXECUTE] ⚠️ Forced failure simulation for action ${action_id} on attempt ${job.attemptsMade + 1}`);
        throw new Error(`Simulated execution failure for action ${action_id}`);
      }

      // Lock Postgres row with SELECT FOR UPDATE and check status
      const action = await executeActionWithLockDb(action_id, DEFAULT_STORE_ID);
      if (!action) {
        throw new Error(`Action not found in Postgres: ${action_id}`);
      }

      // Idempotency guard: only execute if status is 'approved'
      if (action.status !== "approved") {
        console.log(`[Worker EXECUTE] ⏭️ Action ${action_id} status is '${action.status}' (not 'approved'). Skipping duplicate execution.`);
        return;
      }

      if (action.type === "reorder") {
        const payload = action.payload as {
          supplier: string;
          supplier_phone: string;
          qty: number;
          cost: number;
          sku: string;
        };

        console.log(
          `[Worker EXECUTE] 📲 Sent order for ${payload.sku} to ${payload.supplier} (${payload.supplier_phone || "no phone"}): ${payload.qty} units, total ₹${payload.cost}`
        );

        // Update Postgres actions table to executed status
        const executedAction = await markActionExecutedDb(action_id, "executed");
        console.log(`[Worker EXECUTE] ✅ Action ${action_id} updated in Postgres to status='executed' at ${executedAction.executed_at}`);
      } else if (action.type === "writeoff") {
        // Stage 3: write-off posts a real ledger entry
        const { sku, qty, value } = action.payload as { sku: string; qty: number; value: number };
        await postWriteoffLedgerEntry(sku, qty, action_id, action.store_id);
        await markActionExecutedDb(action_id, "executed");
        console.log(`[Worker EXECUTE] ✅ Write-off posted: ${qty} units of ${sku}, value ₹${value}`);
      } else {
        console.log(`[Worker EXECUTE] Executed action type: ${action.type}`);
        await markActionExecutedDb(action_id, "executed");
      }
    } else if (job.name === "draft_reorder_check") {
      await runAutoReorderCheck();
    } else if (job.name === "draft_expiry_check") {
      await runExpiryMarkdownCheck();
      await runExpiryWriteoffCheck();
    } else if (job.name === "draft_slowmover_check") {
      await runSlowMoverCheck();
    } else if (job.name === "draft_supplier_check") {
      await runSupplierFollowupCheck();
    } else if (job.name === "heartbeat") {
      console.log(`[Worker] Heartbeat ✓ at ${new Date().toISOString()}`);
    }
  },
  { connection, concurrency: 5 }
);

worker.on("completed", (job) => {
  console.log(`[Worker] ✅ Job ${job.id} (${job.name}) completed`);
});

worker.on("failed", async (job, err) => {
  console.error(`[Worker] ❌ Job ${job?.id} (${job?.name}) failed attempt ${job?.attemptsMade}:`, err.message);

  if (job && job.name === "execute") {
    const maxAttempts = job.opts.attempts ?? 3;
    if (job.attemptsMade >= maxAttempts) {
      const actionId = (job.data as { action_id: string }).action_id;
      try {
        await markActionExecutedDb(actionId, "failed", err.message, DEFAULT_STORE_ID);
        console.log(
          `[Worker DLQ] ☠️ Job ${job.id} (Action ${actionId}) exhausted all ${maxAttempts} attempts. Moved to DLQ state (Postgres status='failed').`
        );
      } catch (dbErr) {
        console.error(`[Worker DLQ] Failed to update Postgres status to failed for action ${actionId}:`, dbErr);
      }
    }
  }
});

// ── Scheduled Auto-Reorder Check Loop ────────────────────────────────────────

export async function runAutoReorderCheck(storeId: string = DEFAULT_STORE_ID): Promise<number> {
  console.log(`[Worker Scheduler] 🔍 Running Auto-Reorder stock check for store ${storeId}...`);
  let draftedCount = 0;

  try {
    const products = await getProducts(undefined, 100, storeId);
    const settings = await getSettings(storeId);

    for (const product of products) {
      const qtyOnHand = await getCurrentStock(product.sku, storeId);
      const avgDailySales = await getTrailing14DayAvgDailySales(product.sku, storeId);

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
        const alreadyPending = await hasPendingAction(product.sku, "reorder", storeId);
        if (alreadyPending) {
          console.log(`   ⏭  SKU ${product.sku} has stock <= reorderPoint, but a pending reorder action already exists (guardrail active).`);
          continue;
        }

        console.log(`   🚨 SKU ${product.sku} crossed reorder point (${qtyOnHand} <= ${calc.reorderPoint})! Drafting reorder...`);
        const action = await draftReorderForSkuDb(product.sku, storeId);
        draftedCount++;
        console.log(
          `   ✨ Drafted pending reorder: ID=${action.id} | Qty=${action.payload.qty} | Cost=₹${action.payload.cost} | Capped=${action.payload.capped_by_storage_limit} | Confirm=${action.payload.requires_second_confirmation}`
        );
      }
    }

    console.log(`[Worker Scheduler] ✅ Auto-Reorder check completed. Drafted ${draftedCount} action(s).`);
  } catch (err) {
    console.error("[Worker Scheduler] ❌ Auto-Reorder check failed:", err);
  }

  return draftedCount;
}

// ── Stage 3: Expiry Markdown Check (doc 03 §2) ───────────────────────────────

export async function runExpiryMarkdownCheck(storeId: string = DEFAULT_STORE_ID): Promise<number> {
  console.log(`[Worker Scheduler] 🕛 Running Expiry Markdown check for store ${storeId}...`);
  let draftedCount = 0;

  try {
    const settings = await getSettings(storeId);
    const batches = await getExpiryBatchesDue(settings.markdown_threshold_days, storeId);

    for (const batch of batches) {
      if (batch.days_left <= 0) continue; // expired → writeoff, not markdown
      const alreadyPending = await hasPendingMarkdownForBatch(batch.id, storeId);
      if (alreadyPending) continue;

      const product = await getProduct(batch.sku, storeId);
      if (!product) continue;

      const result = calculateMarkdownPrice(
        product.price,
        product.unit_cost,
        batch.days_left,
        settings.markdown_curve,
        settings.min_margin_pct
      );

      await createPendingActionDb("markdown", batch.sku, {
        sku: batch.sku,
        product_name: product.name,
        batch_id: batch.id,
        discount_pct: result.discountPct,
        new_price: result.newPrice,
        original_price: product.price,
        qty: batch.batch_qty,
        expiry_date: batch.expiry_date instanceof Date ? batch.expiry_date.toISOString() : batch.expiry_date,
        days_until_expiry: batch.days_left,
        capped_at_floor: result.cappedAtFloor,
        label: result.label,
      }, storeId);

      draftedCount++;
      console.log(`   📉 Drafted markdown for ${batch.sku} (${batch.days_left}d left): ${result.label} → ₹${result.newPrice}`);
    }

    console.log(`[Worker Scheduler] ✅ Expiry Markdown check done. Drafted ${draftedCount} action(s).`);
  } catch (err) {
    console.error("[Worker Scheduler] ❌ Expiry Markdown check failed:", err);
  }

  return draftedCount;
}

// ── Stage 3: Expiry Write-off Check (doc 03 §3) ──────────────────────────────

export async function runExpiryWriteoffCheck(storeId: string = DEFAULT_STORE_ID): Promise<number> {
  console.log(`[Worker Scheduler] 🗑️  Running Expiry Write-off check for store ${storeId}...`);
  let draftedCount = 0;

  try {
    // days_left <= 0 means expired (passed -1 day threshold)
    const expiredBatches = await getExpiryBatchesDue(-1, storeId);

    for (const batch of expiredBatches) {
      if (batch.days_left > 0) continue; // safety check — only truly expired
      const markdownElapsed = await markdownElapsedForBatch(batch.id, storeId);
      if (!markdownElapsed) continue; // markdown guardrail: must have had its chance

      const alreadyPending = await hasPendingAction(batch.sku, "writeoff", storeId);
      if (alreadyPending) continue;

      const product = await getProduct(batch.sku, storeId);
      if (!product) continue;

      const { writeoffQty, writeoffValue } = calculateWriteoffValue(batch.batch_qty, product.unit_cost);

      await createPendingActionDb("writeoff", batch.sku, {
        sku: batch.sku,
        product_name: product.name,
        batch_id: batch.id,
        qty: writeoffQty,
        value: writeoffValue,
        unit_cost: product.unit_cost,
        expiry_date: batch.expiry_date instanceof Date ? batch.expiry_date.toISOString() : batch.expiry_date,
        days_past_expiry: Math.abs(batch.days_left),
      }, storeId);

      draftedCount++;
      console.log(`   🗑️  Drafted write-off for ${batch.sku}: ${writeoffQty} units, value ₹${writeoffValue}`);
    }

    console.log(`[Worker Scheduler] ✅ Expiry Write-off check done. Drafted ${draftedCount} action(s).`);
  } catch (err) {
    console.error("[Worker Scheduler] ❌ Expiry Write-off check failed:", err);
  }

  return draftedCount;
}

// ── Stage 3: Slow-Mover Check (doc 03 §5) ────────────────────────────────────

export async function runSlowMoverCheck(storeId: string = DEFAULT_STORE_ID): Promise<number> {
  console.log(`[Worker Scheduler] 🐢 Running Slow-Mover check for store ${storeId}...`);
  let draftedCount = 0;

  try {
    const [products, settings] = await Promise.all([
      getProducts(undefined, 100, storeId),
      getSettings(storeId),
    ]);

    for (const product of products) {
      const [trailing7d, trailing30d] = await Promise.all([
        getTrailing7DayAvgDailySales(product.sku, storeId),
        getTrailing30DayAvgDailySales(product.sku, storeId),
      ]);

      if (!isSlowMover(trailing7d, trailing30d, settings.slowmover_drop_pct)) continue;

      const alreadyPending = await hasPendingAction(product.sku, "reorder_point_adjustment", storeId);
      if (alreadyPending) continue;

      const newReorderPoint = calculateSlowMoverReorderPoint(product.reorder_point);

      await createPendingActionDb("reorder_point_adjustment", product.sku, {
        sku: product.sku,
        product_name: product.name,
        current_reorder_point: product.reorder_point,
        new_reorder_point: newReorderPoint,
        trailing_7d_avg: trailing7d,
        trailing_30d_avg: trailing30d,
        drop_pct: settings.slowmover_drop_pct,
        window_days: settings.slowmover_window_days,
      }, storeId);

      draftedCount++;
      console.log(`   🐢 Drafted slow-mover adjustment for ${product.sku}: ROP ${product.reorder_point} → ${newReorderPoint}`);
    }

    console.log(`[Worker Scheduler] ✅ Slow-Mover check done. Drafted ${draftedCount} action(s).`);
  } catch (err) {
    console.error("[Worker Scheduler] ❌ Slow-Mover check failed:", err);
  }

  return draftedCount;
}

// ── Stage 3: Supplier Follow-up Check (doc 03 §6) ────────────────────────────

export async function runSupplierFollowupCheck(storeId: string = DEFAULT_STORE_ID): Promise<number> {
  console.log(`[Worker Scheduler] 📩 Running Supplier Follow-up check for store ${storeId}...`);
  let draftedCount = 0;

  try {
    const overdueReorders = await getExecutedReordersPastDelivery(storeId);

    for (const reorder of overdueReorders) {
      const alreadyFollowedUp = await hasPendingSupplierFollowup(reorder.id, storeId);
      if (alreadyFollowedUp) continue;

      const supplier = (reorder.payload["supplier"] as string) ?? "Supplier";
      const supplierPhone = (reorder.payload["supplier_phone"] as string | null) ?? null;
      const productName = (reorder.payload["product_name"] as string) ?? reorder.sku ?? "product";
      const qty = reorder.payload["qty"] as number;
      const expectedDeliveryDate = reorder.payload["expected_delivery_date"] as string;

      const messageText =
        `Hello ${supplier}, we placed an order for ${qty} units of ${productName} ` +
        `expected by ${expectedDeliveryDate}, but it has not arrived. ` +
        `Could you please confirm the delivery status? Thank you.`;

      const staff = await getOnDutyStaff(storeId);
      void staff; // staff context available for future LLM composition

      await createPendingActionDb("supplier_message", reorder.sku, {
        ref_action_id: reorder.id,
        sku: reorder.sku,
        product_name: productName,
        supplier,
        supplier_phone: supplierPhone,
        message_text: messageText,
        expected_delivery_date: expectedDeliveryDate,
        qty,
      }, storeId);

      draftedCount++;
      console.log(`   📩 Drafted supplier follow-up for ${reorder.sku} (reorder ${reorder.id})`);
    }

    console.log(`[Worker Scheduler] ✅ Supplier Follow-up check done. Drafted ${draftedCount} action(s).`);
  } catch (err) {
    console.error("[Worker Scheduler] ❌ Supplier Follow-up check failed:", err);
  }

  return draftedCount;
}



// Start periodic interval for reorder checks (every 15 min)
setInterval(() => {
  runAutoReorderCheck().catch((err) => console.error("[Worker Interval] Auto-Reorder error:", err));
}, REORDER_CHECK_INTERVAL_MS);

// Stage 3: Expiry checks every 6 hours
const EXPIRY_CHECK_INTERVAL_MS = parseInt(process.env.EXPIRY_CHECK_INTERVAL_MS ?? "21600000", 10);
setInterval(() => {
  runExpiryMarkdownCheck().catch((err) => console.error("[Worker Interval] Expiry Markdown error:", err));
  runExpiryWriteoffCheck().catch((err) => console.error("[Worker Interval] Expiry Writeoff error:", err));
}, EXPIRY_CHECK_INTERVAL_MS);

// Stage 3: Slow-mover check every 24 hours
const SLOWMOVER_CHECK_INTERVAL_MS = parseInt(process.env.SLOWMOVER_CHECK_INTERVAL_MS ?? "86400000", 10);
setInterval(() => {
  runSlowMoverCheck().catch((err) => console.error("[Worker Interval] Slow-Mover error:", err));
}, SLOWMOVER_CHECK_INTERVAL_MS);

// Stage 3: Supplier follow-up check every 24 hours
const SUPPLIER_FOLLOWUP_INTERVAL_MS = parseInt(process.env.SUPPLIER_FOLLOWUP_INTERVAL_MS ?? "86400000", 10);
setInterval(() => {
  runSupplierFollowupCheck().catch((err) => console.error("[Worker Interval] Supplier Followup error:", err));
}, SUPPLIER_FOLLOWUP_INTERVAL_MS);

// ── Startup Log ──────────────────────────────────────────────────────────────
console.log(`✅ Mr. Mart Worker Stage 3 started`);
console.log(`   Redis Queue: ${QUEUE_NAME} on ${REDIS_HOST}:${REDIS_PORT}`);
console.log(`   Auto-Reorder check interval: ${REORDER_CHECK_INTERVAL_MS / 1000}s`);
console.log(`   Expiry check interval:        ${EXPIRY_CHECK_INTERVAL_MS / 1000}s`);
console.log(`   Slow-mover check interval:    ${SLOWMOVER_CHECK_INTERVAL_MS / 1000}s`);
console.log(`   Supplier followup interval:   ${SUPPLIER_FOLLOWUP_INTERVAL_MS / 1000}s`);

process.on("SIGTERM", async () => {
  await worker.close();
  await jobQueue.close();
  await connection.quit();
  process.exit(0);
});
