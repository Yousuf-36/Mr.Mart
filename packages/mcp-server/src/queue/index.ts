/**
 * BullMQ job queue producer helper for Mr. Mart MCP server & Backend.
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

export const connection = new IORedis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableOfflineQueue: false,
});

connection.on("connect", () => {
  console.log(`✅ Producer Redis connected (${REDIS_HOST}:${REDIS_PORT})`);
});

connection.on("error", (err) => {
  if (REDIS_HOST !== "localhost") {
    console.error("[Queue] Redis connection error:", err.message);
  }
});

export const jobQueue = new Queue("mrmart-jobs", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export async function enqueueExecuteJob(actionId: string, extraData?: Record<string, unknown>): Promise<void> {
  if (connection.status !== "ready" && connection.status !== "connecting") {
    await connection.connect();
  }
  try {
    await jobQueue.add("execute", { action_id: actionId, ...extraData });
  } catch (err) {
    if (REDIS_HOST === "localhost") {
      console.warn("[Queue] Redis offline — job queued in-memory fallback:", (err as Error).message);
      const { getActionDb, markActionExecutedDb } = await import("../store/pg-store.js");
      const { executeByType } = await import("../tools/execute.js");
      const action = await getActionDb(actionId);
      if (action) {
        if (extraData?.simulate_failure) {
          await markActionExecutedDb(actionId, "failed", "Simulated execution failure", action.store_id);
        } else {
          await executeByType(action);
        }
      }
    } else {
      throw err;
    }
  }
}
