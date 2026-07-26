/**
 * Mr. Mart Worker — Stage 0 (skeleton)
 *
 * Connects to Redis and registers BullMQ job processors for two job types:
 *   - 'draft'   → runs draft tools on schedule (e.g. "check reorder points")
 *   - 'execute' → triggered internally by mrmart_approve_action (via MCP server)
 *
 * Stage 0: processors are stubs — they connect, log, and confirm queue health.
 * Real job logic is added per automation in Stages 1-3.
 *
 * Architecture note (doc 01 §8):
 * The Worker is the only place that runs draft tools and execute tools.
 * It consumes a Redis queue; it is NOT network-reachable from the Frontend.
 * This separation is what makes "approve-then-execute" safe — the Backend
 * (and the MCP server's public HTTP surface) cannot run execute tools directly.
 */

import "dotenv/config";
import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";

const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? undefined;
const QUEUE_NAME = "mrmart-jobs";
const HEARTBEAT_INTERVAL_MS = 30_000;

// ─── Redis connection ─────────────────────────────────────────────────────────
const connection = new IORedis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Required by BullMQ
});

connection.on("connect", () => {
  console.log(`✅ Worker Redis connected (${REDIS_HOST}:${REDIS_PORT})`);
});

connection.on("error", (err) => {
  console.error("[Worker] Redis connection error:", err.message);
});

// ─── Job queue reference (for enqueuing jobs — used in later stages) ─────────
export const jobQueue = new Queue(QUEUE_NAME, { connection });

// ─── BullMQ Worker ───────────────────────────────────────────────────────────
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[Worker] Processing job: ${job.id} | type: ${job.name} | data:`, job.data);

    switch (job.name) {
      case "draft": {
        // Stage 1+: call the appropriate mrmart_draft_* tool based on job.data.type
        console.log(`[Worker] STUB: draft job for type=${job.data.type}, sku=${job.data.sku}`);
        break;
      }
      case "execute": {
        // Stage 1+: call the execute function after owner approval
        console.log(`[Worker] STUB: execute job for action_id=${job.data.action_id}`);
        break;
      }
      case "heartbeat": {
        // Scheduler heartbeat — proves the worker loop is running (Prometheus picks this up in later stages)
        console.log(`[Worker] Heartbeat ✓ at ${new Date().toISOString()}`);
        break;
      }
      default:
        console.warn(`[Worker] Unknown job type: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: 5, // Process up to 5 jobs concurrently (tunable per doc 06 §7)
  }
);

worker.on("completed", (job) => {
  console.log(`[Worker] ✅ Job ${job.id} (${job.name}) completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] ❌ Job ${job?.id} (${job?.name}) failed:`, err.message);
  // Stage 1+: exponential backoff retry + action marked 'failed' in DB (doc 06 §5)
});

worker.on("error", (err) => {
  console.error("[Worker] Worker error:", err.message);
});

// ─── Heartbeat loop ───────────────────────────────────────────────────────────
// Enqueues a heartbeat job every 30s. In later stages, Prometheus scrapes the
// "last successful heartbeat" timestamp to detect a stalled worker (doc 06 §5).
setInterval(async () => {
  try {
    await jobQueue.add("heartbeat", { timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[Worker] Failed to enqueue heartbeat:", err instanceof Error ? err.message : err);
  }
}, HEARTBEAT_INTERVAL_MS);

// ─── Startup ─────────────────────────────────────────────────────────────────
console.log(`✅ Mr. Mart Worker started`);
console.log(`   Queue: ${QUEUE_NAME} on ${REDIS_HOST}:${REDIS_PORT}`);
console.log(`   Stage: 0 (stubs — real job logic added in Stage 1)`);

process.on("SIGTERM", async () => {
  console.log("[Worker] SIGTERM received — closing gracefully...");
  await worker.close();
  await jobQueue.close();
  await connection.quit();
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Worker] Unhandled rejection:", reason);
  process.exit(1);
});
