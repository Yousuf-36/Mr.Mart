#!/usr/bin/env node
/**
 * Migration runner for Mr. Mart.
 * Runs all .sql files in apps/backend/migrations/ in numeric order.
 * Tracks applied migrations in a _migrations table to avoid re-running.
 *
 * Usage:
 *   node apps/backend/migrations/run-migrations.js
 *
 * Requires: DATABASE_URL environment variable.
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is required");
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname);

async function run() {
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    console.log("🔌 Connecting to database...");
    await client.connect();
    console.log("✅ Connected");

    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        filename   TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get already-applied migrations
    const applied = await client.query(
      "SELECT filename FROM _migrations ORDER BY id"
    );
    const appliedSet = new Set(applied.rows.map((r) => r.filename));

    // Find all .sql files, sorted numerically
    const sqlFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (sqlFiles.length === 0) {
      console.log("⚠️  No migration files found in", MIGRATIONS_DIR);
      return;
    }

    let ran = 0;
    for (const file of sqlFiles) {
      if (appliedSet.has(file)) {
        console.log(`  ⏭  ${file} (already applied)`);
        continue;
      }

      console.log(`  ▶  Running ${file}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO _migrations (filename) VALUES ($1)",
          [file]
        );
        console.log(`  ✅ ${file} — done`);
        ran++;
      } catch (err) {
        console.error(`  ❌ ${file} — FAILED:`, err.message);
        process.exit(1);
      }
    }

    if (ran === 0) {
      console.log("✅ All migrations already applied — nothing to run");
    } else {
      console.log(`\n✅ ${ran} migration(s) applied successfully`);
    }
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error("❌ Migration runner failed:", err.message);
  process.exit(1);
});
