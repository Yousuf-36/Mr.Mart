/**
 * In-memory PostgreSQL instance for local dev & testing when external Postgres is unavailable.
 * Uses pg-mem to run real PostgreSQL SQL migrations (001_accounts through 011_settings)
 * and provide a standard pg.Pool interface.
 */

import { newDb } from "pg-mem";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

export function createMemoryDb() {
  const db = newDb();

  // Register uuid helper functions for Postgres
  db.public.registerFunction({
    name: "gen_random_uuid",
    implementation: () => uuidv4(),
  });

  db.public.registerFunction({
    name: "uuid_generate_v4",
    implementation: () => uuidv4(),
  });

  // Load and execute migrations 001 through 011
  const migrationsDir = path.resolve(process.cwd(), "apps/backend/migrations");
  const sqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of sqlFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    // Strip transactions (BEGIN/COMMIT) for pg-mem execution
    const cleanSql = sql
      .replace(/^BEGIN;/gm, "")
      .replace(/^COMMIT;/gm, "");
    
    try {
      db.public.none(cleanSql);
    } catch (err) {
      console.warn(`[pg-mem] Warning during ${file}:`, err instanceof Error ? err.message : err);
    }
  }

  // Bind pg Pool adapter
  const { Pool } = db.adapters.createPg();
  return new Pool();
}
