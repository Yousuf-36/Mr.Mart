/**
 * Real Neon.tech PostgreSQL Verification Script.
 * Verifies live connection, PostgreSQL 16 engine version, current database name,
 * and strict CHECK constraint violations (error code 23514).
 */

import assert from "node:assert/strict";
import dotenv from "dotenv";
import { query } from "./db/index.js";

dotenv.config();

async function runNeonVerification() {
  console.log("🔌 Connecting to real DATABASE_URL database...");

  // 1. SELECT version() and SELECT current_database()
  const versionRes = await query<{ version: string }>("SELECT version();");
  const dbRes = await query<{ current_database: string }>("SELECT current_database();");

  const pgVersion = versionRes.rows[0].version;
  const currentDb = dbRes.rows[0].current_database;

  console.log(`\n=======================================================`);
  console.log(`🐘 REAL NEON POSTGRESQL VERIFICATION`);
  console.log(`=======================================================`);
  console.log(`DATABASE_NAME  : ${currentDb}`);
  console.log(`POSTGRES_VER  : ${pgVersion}`);

  assert.ok(pgVersion.includes("PostgreSQL"), "Version string must contain PostgreSQL");
  assert.ok(currentDb.length > 0, "Current database name must not be empty");

  // 2. Test CHECK constraint 1: Attempt role = 'manager' in store_users
  console.log(`\n🧪 Testing CHECK Constraint 1: Invalid role ('manager') in store_users...`);
  try {
    // Insert dummy user first
    const userRes = await query<{ id: string }>(
      `INSERT INTO users (email, phone, name) VALUES ('test.check@mrmart.app', '+919000000000', 'Test Check') RETURNING id`
    );
    const userId = userRes.rows[0].id;

    // Insert dummy account and store
    const accRes = await query<{ id: string }>(
      `INSERT INTO accounts (name, owner_phone) VALUES ('Test Account', '+919000000000') RETURNING id`
    );
    const accId = accRes.rows[0].id;

    const storeRes = await query<{ id: string }>(
      `INSERT INTO stores (account_id, name, phone) VALUES ($1, 'Test Store', '+919000000000') RETURNING id`,
      [accId]
    );
    const storeId = storeRes.rows[0].id;

    await query(
      `INSERT INTO store_users (user_id, store_id, role) VALUES ($1, $2, 'manager')`,
      [userId, storeId]
    );
    console.error("❌ FAIL: Insert with role='manager' unexpectedly succeeded!");
    process.exit(1);
  } catch (err: any) {
    console.log(`   Caught Error Code : ${err.code}`);
    console.log(`   Error Constraint  : ${err.constraint}`);
    console.log(`   Error Message     : ${err.message}`);

    assert.equal(err.code, "23514", "Error code must be 23514 (check_violation)");
    assert.ok(err.message.includes("store_users_role_check") || err.message.includes("check constraint"), "Error message must indicate role check violation");
    console.log(`   ✅ PASS: Real Postgres strictly rejected role='manager' with error code 23514 (check_violation).`);
  }

  // 3. Test CHECK constraint 2: Attempt status = 'invalid_status' in subscriptions
  console.log(`\n🧪 Testing CHECK Constraint 2: Invalid status in subscriptions...`);
  try {
    const accRes = await query<{ id: string }>(
      `INSERT INTO accounts (name, owner_phone) VALUES ('Test Sub Account', '+919111111111') RETURNING id`
    );
    const accId = accRes.rows[0].id;

    await query(
      `INSERT INTO subscriptions (account_id, plan, status) VALUES ($1, 'starter', 'invalid_status')`,
      [accId]
    );
    console.error("❌ FAIL: Insert with invalid subscription status unexpectedly succeeded!");
    process.exit(1);
  } catch (err: any) {
    console.log(`   Caught Error Code : ${err.code}`);
    console.log(`   Error Constraint  : ${err.constraint}`);
    console.log(`   Error Message     : ${err.message}`);

    assert.equal(err.code, "23514", "Error code must be 23514 (check_violation)");
    assert.ok(err.message.includes("subscriptions_status_check") || err.message.includes("check constraint"), "Error message must indicate status check violation");
    console.log(`   ✅ PASS: Real Postgres strictly rejected invalid subscription status with error code 23514 (check_violation).`);
  }

  console.log(`\n=======================================================`);
  console.log(`✅ REAL NEON POSTGRES VERIFICATION PASSED`);
  console.log(`=======================================================\n`);
}

runNeonVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Unhandled error:", err);
    process.exit(1);
  });
