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
});

export const jobQueue = new Queue("mrmart-jobs", { connection });

export async function enqueueExecuteJob(actionId: string): Promise<void> {
  if (connection.status !== "ready" && connection.status !== "connecting") {
    await connection.connect();
  }
  await jobQueue.add("execute", { action_id: actionId });
}
