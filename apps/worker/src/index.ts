/**
 * Mr. Mart Worker — Stage 1
 *
 * Runs scheduled background automations (Auto-Reorder check) and consumes
 * approved execution jobs off the Redis queue (`mrmart-jobs`).
 *
 * Architecture (doc 01 §8):
 * - Drafts actions into Postgres (`actions` table) in 'pending' status.
 * - Executes approved actions and writes 'executed' status + executed_at to Postgres.
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
  DEFAULT_STORE_ID,
} from "@mrmart/mcp-server/store/pg-store.js";
import { calculateReorder } from "@mrmart/mcp-server/formulas/reorder.js";

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
    console.log(`[Worker] Processing job ${job.id} | name: ${job.name} | data:`, job.data);

    if (job.name === "execute") {
      const { action_id } = job.data as { action_id: string };
      const action = await getActionDb(action_id, DEFAULT_STORE_ID);
      if (!action) {
        throw new Error(`Action not found in Postgres: ${action_id}`);
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
      } else {
        console.log(`[Worker EXECUTE] Executed mock action type: ${action.type}`);
        await markActionExecutedDb(action_id, "executed");
      }
    } else if (job.name === "draft_reorder_check") {
      await runAutoReorderCheck();
    } else if (job.name === "heartbeat") {
      console.log(`[Worker] Heartbeat ✓ at ${new Date().toISOString()}`);
    }
  },
  { connection, concurrency: 5 }
);

worker.on("completed", (job) => {
  console.log(`[Worker] ✅ Job ${job.id} (${job.name}) completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] ❌ Job ${job?.id} (${job?.name}) failed:`, err.message);
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

// Start periodic interval for reorder checks
setInterval(() => {
  runAutoReorderCheck().catch((err) => console.error("[Worker Interval] Error:", err));
}, REORDER_CHECK_INTERVAL_MS);

// ── Startup Log ──────────────────────────────────────────────────────────────
console.log(`✅ Mr. Mart Worker Stage 1 started`);
console.log(`   Redis Queue: ${QUEUE_NAME} on ${REDIS_HOST}:${REDIS_PORT}`);
console.log(`   Auto-Reorder check interval: ${REORDER_CHECK_INTERVAL_MS / 1000}s`);

process.on("SIGTERM", async () => {
  await worker.close();
  await jobQueue.close();
  await connection.quit();
  process.exit(0);
});
