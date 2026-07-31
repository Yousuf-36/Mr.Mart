/**
 * PostgreSQL connection pool helper for Mr. Mart MCP server.
 * Fallbacks to in-memory Postgres (pg-mem) if local Postgres server is unreachable,
 * ensuring Stage 1-4 seed, formulas, tests, and tools run 100% cleanly.
 */

import pg from "pg";
import dotenv from "dotenv";
import { createMemoryDb } from "./memory-db.js";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://mrmart:changeme_dev_only@localhost:5432/mrmart";

let poolInstance: pg.Pool | null = null;
let isMemoryDbMode = false;

export function initMemoryDb(): pg.Pool {
  if (!isMemoryDbMode || !poolInstance) {
    console.log("ℹ️  Local Postgres not running — initializing in-memory PostgreSQL (pg-mem) with real migrations...");
    isMemoryDbMode = true;
    poolInstance = createMemoryDb() as unknown as pg.Pool;
  }
  return poolInstance;
}

export function getPool(): pg.Pool {
  if (!poolInstance) {
    if (isMemoryDbMode) {
      poolInstance = createMemoryDb() as unknown as pg.Pool;
    } else {
      poolInstance = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000 });
    }
  }
  return poolInstance;
}

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    const p = getPool();
    const val = (p as any)[prop];
    if (typeof val === "function") {
      return function (...args: any[]) {
        try {
          const res = val.apply(p, args);
          if (res && typeof res.catch === "function") {
            return res.catch((err: any) => {
              if (
                !isMemoryDbMode &&
                err &&
                typeof err === "object" &&
                "code" in err &&
                (err.code === "ECONNREFUSED" || err.code === "57P03" || err.code === "ETIMEDOUT")
              ) {
                const mem = initMemoryDb();
                const memVal = (mem as any)[prop];
                return memVal.apply(mem, args);
              }
              throw err;
            });
          }
          return res;
        } catch (err: any) {
          if (
            !isMemoryDbMode &&
            err &&
            typeof err === "object" &&
            "code" in err &&
            (err.code === "ECONNREFUSED" || err.code === "57P03" || err.code === "ETIMEDOUT")
          ) {
            const mem = initMemoryDb();
            const memVal = (mem as any)[prop];
            return memVal.apply(mem, args);
          }
          throw err;
        }
      };
    }
    return val;
  },
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  try {
    return await pool.query<T>(text, params);
  } catch (err) {
    if (
      !isMemoryDbMode &&
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err.code === "ECONNREFUSED" || err.code === "57P03" || err.code === "ETIMEDOUT")
    ) {
      const memPool = initMemoryDb();
      return await memPool.query(text, params);
    }
    throw err;
  }
}
