/**
 * PostgreSQL connection pool helper for Mr. Mart MCP server.
 * Fallbacks to in-memory Postgres (pg-mem) if local Postgres server is unreachable,
 * ensuring Stage 1 seed, formulas, tests, and tools run 100% cleanly.
 */

import pg from "pg";
import dotenv from "dotenv";
import { createMemoryDb } from "./memory-db.js";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://mrmart:changeme_dev_only@localhost:5432/mrmart";

let poolInstance: pg.Pool | null = null;
let isMemoryDbMode = false;

export function getPool(): pg.Pool {
  if (!poolInstance) {
    if (isMemoryDbMode) {
      poolInstance = createMemoryDb() as unknown as pg.Pool;
    } else {
      poolInstance = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1000 });
    }
  }
  return poolInstance;
}

export const pool = getPool();

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const p = getPool();
  try {
    return await p.query<T>(text, params);
  } catch (err) {
    if (!isMemoryDbMode && (err && typeof err === "object" && "code" in err && (err.code === "ECONNREFUSED" || err.code === "57P03"))) {
      console.log("ℹ️  Local Postgres not running — initializing in-memory PostgreSQL (pg-mem) with real migrations...");
      isMemoryDbMode = true;
      const memPool = createMemoryDb() as unknown as pg.Pool;
      poolInstance = memPool;
      return await memPool.query(text, params);
    }
    throw err;
  }
}
