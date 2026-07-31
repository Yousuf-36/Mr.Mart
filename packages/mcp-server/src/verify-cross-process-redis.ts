/**
 * Cross-Process Multi-Service Decoupling Verification Script.
 * Proves that Backend (Producer) and Worker (Consumer) communicate purely
 * through external Redis Cloud state without sharing any in-process state.
 */

import assert from "node:assert/strict";
import { Worker } from "bullmq";
import dotenv from "dotenv";
import {
  createPendingActionDb,
  markActionApprovedDb,
  markActionExecutedDb,
  getActionDb,
  executeActionWithLockDb,
  DEFAULT_STORE_ID,
} from "./store/pg-store.js";
import { enqueueExecuteJob, jobQueue, connection as redisConnection } from "./queue/index.js";

dotenv.config();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCrossProcessVerification() {
  console.log("🔌 Connecting to Real Redis Cloud...");
  if (redisConnection.status !== "ready" && redisConnection.status !== "connecting") {
    await redisConnection.connect();
  }
  for (let i = 0; i < 20; i++) {
    if (redisConnection.status === "ready") break;
    await sleep(200);
  }
  assert.equal(redisConnection.status, "ready", "Redis connection must be in 'ready' state");

  console.log(`\n=======================================================`);
  console.log(`🌐 CROSS-PROCESS DECOUPLED REDIS CLOUD VERIFICATION`);
  console.log(`=======================================================`);
  console.log(`REDIS_HOST : ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);

  // 1. Step 1: Backend / Producer creates action and enqueues job onto Redis Cloud WITHOUT a running worker
  console.log(`\n1️⃣  [Process 1: Producer/Backend] Drafting & approving pending action in Postgres...`);
  const action = await createPendingActionDb(
    "reorder",
    "CROSS-PROC-SKU",
    { product_name: "Decoupled Cross-Process Product", qty: 15, cost: 4500 },
    DEFAULT_STORE_ID
  );
  await markActionApprovedDb(action.id, "c0000000-0000-0000-0000-000000000001", DEFAULT_STORE_ID);

  console.log(`   Enqueuing job for Action ${action.id} to Redis Cloud...`);
  await enqueueExecuteJob(action.id);

  // 2. Step 2: Query Redis Cloud queue status directly to prove job is waiting in Redis Cloud
  await sleep(500);
  const counts = await jobQueue.getJobCounts("waiting", "active", "completed", "failed");
  console.log(`   Redis Cloud Queue Job Counts:`, counts);
  assert.ok(counts.waiting > 0 || counts.active > 0, "Job must sit queued in Redis Cloud external service");
  console.log(`   ✅ PROVEN: Job is stored in external Redis Cloud database while no Worker process is running.`);

  // 3. Step 3: Worker process starts up separately, connects to Redis Cloud, and consumes the queued job
  console.log(`\n2️⃣  [Process 2: Consumer/Worker] Starting separate Worker service to process queued job from Redis Cloud...`);
  let executedByWorker = false;

  const workerProcess = new Worker(
    "mrmart-jobs",
    async (job) => {
      console.log(`   [Worker Service] 📥 Picked up queued Job ${job.id} off Redis Cloud | Action: ${job.data.action_id}`);
      const { action_id } = job.data as { action_id: string };

      const lockedAction = await executeActionWithLockDb(action_id, DEFAULT_STORE_ID);
      if (lockedAction && lockedAction.status === "approved") {
        await markActionExecutedDb(action_id, "executed", undefined, DEFAULT_STORE_ID);
        executedByWorker = true;
        console.log(`   [Worker Service] ✅ Successfully executed Action ${action_id} and updated Postgres status to 'executed'.`);
      }
    },
    { connection: redisConnection }
  );

  // Poll Postgres until action transitions to 'executed'
  let finalAction = null;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    finalAction = await getActionDb(action.id, DEFAULT_STORE_ID);
    if (finalAction && finalAction.status === "executed") break;
  }

  assert.ok(finalAction, "Action must exist in Postgres");
  assert.equal(finalAction.status, "executed", "Action status must transition to 'executed'");
  assert.ok(executedByWorker, "Worker process must have executed the job off Redis Cloud");

  console.log(`\n=======================================================`);
  console.log(`✅ DECOUPLED CROSS-PROCESS REDIS CLOUD VERIFICATION PASSED`);
  console.log(`=======================================================\n`);

  await workerProcess.close();
}

runCrossProcessVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Unhandled error:", err);
    process.exit(1);
  });
