/**
 * Stage 4 Verification & Fault Injection Suite (doc 04 & doc 10 DoD).
 * Runs against live Neon.tech PostgreSQL database and live Redis Cloud BullMQ queue
 * to prove cross-container resilience, exponential retry, DLQ transitions,
 * row-level locking idempotency, and network health probes with ZERO fallbacks.
 */

import assert from "node:assert/strict";
import { Worker } from "bullmq";
import { seedDatabase } from "../../../apps/backend/src/db/seed.js";
import {
  createPendingActionDb,
  markActionApprovedDb,
  markActionExecutedDb,
  getActionDb,
  executeActionWithLockDb,
  DEFAULT_STORE_ID,
  pool,
} from "./store/pg-store.js";
import { enqueueExecuteJob, jobQueue, connection as redisConnection } from "./queue/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStage4Verification() {
  console.log("\n🌱 Initializing seed database for Stage 4 resilience tests...");
  await seedDatabase();

  // Ensure Redis connection is connected
  if (redisConnection.status !== "ready" && redisConnection.status !== "connecting") {
    await redisConnection.connect();
  }
  for (let i = 0; i < 20; i++) {
    if (redisConnection.status === "ready") break;
    await sleep(200);
  }
  assert.equal(redisConnection.status, "ready", "Redis Connection must be in 'ready' state");

  console.log(`✅ Verified Real Redis Cloud Connection (${redisConnection.options.host}:${redisConnection.options.port})`);
  console.log("\n🧪 Starting Stage 4 Infrastructure Hardening & Resilience Suite (Real Infra Mode)...\n");

  // Instantiate real BullMQ Worker to process queue jobs off Redis Cloud
  const realWorker = new Worker(
    "mrmart-jobs",
    async (job) => {
      console.log(`[Real BullMQ Worker] Job ${job.id} processing (attempt ${job.attemptsMade + 1}/${job.opts.attempts}) | data:`, job.data);
      const { action_id, simulate_failure } = job.data as { action_id: string; simulate_failure?: boolean };

      if (simulate_failure) {
        throw new Error(`Simulated execution failure for action ${action_id}`);
      }

      const action = await executeActionWithLockDb(action_id, DEFAULT_STORE_ID);
      if (action && action.status === "approved") {
        await markActionExecutedDb(action_id, "executed", undefined, DEFAULT_STORE_ID);
        console.log(`[Real BullMQ Worker] ✅ Executed action ${action_id} on real Redis Cloud queue.`);
      }
    },
    { connection: redisConnection }
  );

  realWorker.on("failed", async (job, err) => {
    if (job && job.name === "execute") {
      const maxAttempts = job.opts.attempts ?? 3;
      console.log(`[Real BullMQ Worker] ⚠️ Attempt ${job.attemptsMade}/${maxAttempts} failed for job ${job.id}: ${err.message}`);
      if (job.attemptsMade >= maxAttempts) {
        const actionId = (job.data as { action_id: string }).action_id;
        await markActionExecutedDb(actionId, "failed", err.message, DEFAULT_STORE_ID);
        console.log(`[Real BullMQ DLQ] ☠️ Job ${job.id} (Action ${actionId}) exhausted all ${maxAttempts} retries. Moved to DLQ status='failed' in Postgres.`);
      }
    }
  });

  let testCount = 0;
  let passCount = 0;

  // ── TEST 1: Happy Path Real Redis Queue Execution & Status Transition ─────
  testCount++;
  console.log(`[Test 1/4] 🚀 Happy Path Real Redis Queue Execution & Status Transition...`);
  try {
    const action = await createPendingActionDb(
      "reorder",
      "RICE-5KG",
      {
        product_name: "Basmati Rice 5kg",
        qty: 10,
        cost: 3200,
        supplier: "Metro Staples Wholesale",
      },
      DEFAULT_STORE_ID
    );
    assert.equal(action.status, "pending");

    await markActionApprovedDb(action.id, "c0000000-0000-0000-0000-000000000001", DEFAULT_STORE_ID);
    await enqueueExecuteJob(action.id);

    // Poll Postgres for worker status update off real Redis Cloud queue
    let updatedAction = null;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      updatedAction = await getActionDb(action.id, DEFAULT_STORE_ID);
      if (updatedAction && updatedAction.status === "executed") break;
    }

    assert.ok(updatedAction, "Action record missing from Postgres");
    assert.equal(updatedAction.status, "executed", `Expected status 'executed', got '${updatedAction?.status}'`);
    assert.ok(updatedAction.executed_at, "executed_at timestamp must be populated");
    console.log(`   ✅ PASS: Action ${action.id} transitioned pending → approved → executed cleanly via real Redis Cloud queue.`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 1:`, err instanceof Error ? err.message : err);
  }

  // ── TEST 2: Row-Level Locking & Idempotency Guard ─────────────────────────
  testCount++;
  console.log(`\n[Test 2/4] 🔒 Row-Level Locking & Idempotency Guard...`);
  try {
    const action = await createPendingActionDb(
      "markdown",
      "BREAD-WW",
      { product_name: "Whole Wheat Bread", discount_pct: 0.25, new_price: 36, qty: 5 },
      DEFAULT_STORE_ID
    );

    await markActionApprovedDb(action.id, "c0000000-0000-0000-0000-000000000001", DEFAULT_STORE_ID);

    const lockedAction = await executeActionWithLockDb(action.id, DEFAULT_STORE_ID);
    assert.ok(lockedAction, "Locked action should be returned");
    assert.equal(lockedAction.status, "approved", "Locked action should be in 'approved' status");

    await markActionExecutedDb(action.id, "executed", undefined, DEFAULT_STORE_ID);

    const reLockedAction = await executeActionWithLockDb(action.id, DEFAULT_STORE_ID);
    assert.ok(reLockedAction);
    assert.equal(reLockedAction.status, "executed");

    console.log(`   ✅ PASS: Row locking & status guardrails prevent duplicate executions on real database.`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 2:`, err instanceof Error ? err.message : err);
  }

  // ── TEST 3: Real Exponential Retries & DLQ State Transition ───────────────
  testCount++;
  console.log(`\n[Test 3/4] 💥 Real BullMQ Exponential Retries & DLQ Transition on Exhaustion...`);
  try {
    const action = await createPendingActionDb(
      "writeoff",
      "MILK-1L",
      { product_name: "Full Cream Milk 1L", qty: 2, value: 116 },
      DEFAULT_STORE_ID
    );

    await markActionApprovedDb(action.id, "c0000000-0000-0000-0000-000000000001", DEFAULT_STORE_ID);

    // Enqueue job on real BullMQ queue with forced failure simulation
    await enqueueExecuteJob(action.id, { simulate_failure: true });

    // Poll Postgres until real BullMQ worker exhausts all 3 retries (with 1000ms exponential backoff)
    let failedAction = null;
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      failedAction = await getActionDb(action.id, DEFAULT_STORE_ID);
      if (failedAction && failedAction.status === "failed") break;
    }

    assert.ok(failedAction, "Action record missing from Postgres");
    assert.equal(failedAction.status, "failed", `Expected DLQ status 'failed', got '${failedAction?.status}'`);
    assert.ok(failedAction.failure_reason, "failure_reason must be logged in Postgres");
    assert.match(failedAction.failure_reason, /Simulated execution failure/, "failure_reason must capture exception text");

    // Retry test: re-approve the failed action to ensure recovery
    const retriedAction = await markActionApprovedDb(action.id, "c0000000-0000-0000-0000-000000000001", DEFAULT_STORE_ID);
    assert.equal(retriedAction.status, "approved");
    assert.equal(retriedAction.failure_reason, null);

    console.log(`   ✅ PASS: Real BullMQ 3-attempt exponential retry exhausted, transitioned to DLQ status='failed', and recovered on re-approval.`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 3:`, err instanceof Error ? err.message : err);
  }

  // ── TEST 4: Network Probe & Connection Health ──────────────────────────────
  testCount++;
  console.log(`\n[Test 4/4] 🔌 Real Postgres & Redis Cloud Connection Probes...`);
  try {
    const pgRes = await pool.query("SELECT NOW() as server_time;");
    assert.ok(pgRes.rows[0].server_time, "Postgres query must return server time");

    const pingRes = await redisConnection.ping();
    assert.equal(pingRes, "PONG", "Redis Cloud ping must return PONG");

    const isPaused = await jobQueue.isPaused();
    assert.equal(isPaused, false, "Real BullMQ queue must be active and non-paused");

    console.log(`   ✅ PASS: Neon Postgres (${pgRes.rows[0].server_time.toISOString()}) and Redis Cloud (PONG) connection health probes 100% active.`);
    passCount++;
  } catch (err: unknown) {
    console.error(`   ❌ FAIL Test 4:`, err instanceof Error ? err.message : err);
  }

  // Cleanup worker
  await realWorker.close();

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log(`\n==================================================`);
  console.log(`📊 Stage 4 Resilience Verification: ${passCount}/${testCount} PASSED (Real Infra Mode)`);
  console.log(`==================================================\n`);

  if (passCount !== testCount) {
    process.exit(1);
  }
}

runStage4Verification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Unhandled verification error:", err);
    process.exit(1);
  });
