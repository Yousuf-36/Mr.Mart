/**
 * Database seed script for Mr. Mart Stage 1.
 * Inserts realistic multi-tenant account, store, settings, staff, suppliers,
 * products, stock ledger, and 14+ days of sales transactions.
 */

import { v4 as uuidv4 } from "uuid";
import { query } from "./index.js";

export async function seedDatabase() {
  console.log("🌱 Initializing DB and seeding data...");

  // Clean existing data
  await query("DELETE FROM actions;");
  await query("DELETE FROM shelf_flags;");
  await query("DELETE FROM expiry_batches;");
  await query("DELETE FROM sales_txn;");
  await query("DELETE FROM stock_ledger;");
  await query("DELETE FROM products;");
  await query("DELETE FROM suppliers;");
  await query("DELETE FROM staff;");
  await query("DELETE FROM settings;");
  await query("DELETE FROM stores;");
  await query("DELETE FROM subscriptions;");
  await query("DELETE FROM accounts;");

  console.log("👤 Creating seed account and store...");
  const accountRes = await query(`
    INSERT INTO accounts (id, name, owner_phone, plan, trial_ends_at)
    VALUES ('a0000000-0000-0000-0000-000000000001'::uuid, 'Supermart Mart Owner', '+919876543210', 'trial', NOW() + INTERVAL '14 days')
    RETURNING id;
  `);
  const accountId = accountRes.rows[0].id;

  await query(`
    INSERT INTO subscriptions (id, account_id, plan, status)
    VALUES ($1::uuid, $2::uuid, 'trial', 'active');
  `, [uuidv4(), accountId]);

  const storeRes = await query(`
    INSERT INTO stores (id, account_id, name, phone, language, timezone)
    VALUES ('b0000000-0000-0000-0000-000000000001'::uuid, $1::uuid, 'Mr. Mart Main Branch', '+919876543210', 'en', 'Asia/Kolkata')
    RETURNING id;
  `, [accountId]);
  const storeId = storeRes.rows[0].id;

  console.log("⚙️ Inserting store settings...");
  await query(`
    INSERT INTO settings (
      store_id, safety_factor, review_period_days, large_order_value_threshold,
      markdown_threshold_days, min_margin_pct, slowmover_drop_pct, slowmover_window_days, discrepancy_threshold
    ) VALUES (
      $1, 1.3, 1, 5000, 3, 0.02, 0.40, 7, 200
    );
  `, [storeId]);

  console.log("👥 Inserting staff and suppliers...");
  await query(`
    INSERT INTO staff (id, store_id, name, phone, role, active)
    VALUES 
      ('c0000000-0000-0000-0000-000000000001', $1, 'Rajesh Owner', '+919876543210', 'owner', true),
      ('c0000000-0000-0000-0000-000000000002', $1, 'Suresh Helper', '+919876543211', 'staff', true);
  `, [storeId]);

  const supFreshRes = await query(`
    INSERT INTO suppliers (id, store_id, name, phone, lead_time_days)
    VALUES ('d0000000-0000-0000-0000-000000000001', $1, 'Fresh Direct Traders', '+919876500001', 1)
    RETURNING id;
  `, [storeId]);
  const supFreshId = supFreshRes.rows[0].id;

  const supStaplesRes = await query(`
    INSERT INTO suppliers (id, store_id, name, phone, lead_time_days)
    VALUES ('d0000000-0000-0000-0000-000000000002', $1, 'Metro Staples Wholesale', '+919876500002', 2)
    RETURNING id;
  `, [storeId]);
  const supStaplesId = supStaplesRes.rows[0].id;

  console.log("📦 Inserting core products...");
  // Products: RICE-5KG, MILK-1L, BREAD-WW, OIL-1L, EGGS-12
  await query(`
    INSERT INTO products (sku, store_id, supplier_id, name, category, unit, unit_cost, price, reorder_point, max_order_qty, shelf_capacity, shelf_life_days)
    VALUES 
      ('RICE-5KG', $1, $2, 'Basmati Rice 5kg', 'Grains', 'bag', 600.00, 750.00, 20.00, 10.00, 30, 365),
      ('MILK-1L', $1, $3, 'Full Cream Milk 1L', 'Dairy', 'packet', 58.00, 72.00, 30.00, 120.00, 50, 7),
      ('BREAD-WW', $1, $3, 'Whole Wheat Bread', 'Bakery', 'loaf', 35.00, 48.00, 15.00, 60.00, 25, 5),
      ('OIL-1L', $1, $2, 'Sunflower Oil 1L', 'Oils', 'bottle', 130.00, 155.00, 25.00, 80.00, 40, 365),
      ('EGGS-12', $1, $3, 'Eggs (Tray of 12)', 'Dairy', 'tray', 78.00, 95.00, 20.00, 100.00, 30, 21);
  `, [storeId, supStaplesId, supFreshId]);

  console.log("📊 Inserting initial stock ledger...");
  const initialStock = [
    { sku: "RICE-5KG", qty: 4.0 },
    { sku: "MILK-1L", qty: 45.0 },
    { sku: "BREAD-WW", qty: 6.0 },
    { sku: "OIL-1L", qty: 30.0 },
    { sku: "EGGS-12", qty: 25.0 },
  ];

  for (const item of initialStock) {
    await query(`
      INSERT INTO stock_ledger (id, sku, store_id, delta_qty, reason)
      VALUES ($1, $2, $3, $4, 'delivery_received');
    `, [uuidv4(), item.sku, storeId, item.qty]);
  }

  console.log("📈 Seeding 14+ days of realistic sales transaction history...");
  const salesConfig = [
    { sku: "RICE-5KG", price: 399, avgDaily: 6 },
    { sku: "MILK-1L", price: 72, avgDaily: 15 },
    { sku: "BREAD-WW", price: 48, avgDaily: 8 },
    { sku: "OIL-1L", price: 155, avgDaily: 5 },
    { sku: "EGGS-12", price: 95, avgDaily: 7 },
  ];

  let totalTxnCount = 0;
  for (let day = 14; day >= 1; day--) {
    for (const item of salesConfig) {
      const dailyQty = item.avgDaily;
      const cashQty = Math.floor(dailyQty / 2);
      const digitalQty = dailyQty - cashQty;

      if (cashQty > 0) {
        await query(`
          INSERT INTO sales_txn (id, sku, store_id, qty, amount, payment_type, created_at)
          VALUES ($1, $2, $3, $4, $5, 'cash', NOW() - INTERVAL '${day} days');
        `, [uuidv4(), item.sku, storeId, cashQty, cashQty * item.price]);
        totalTxnCount++;
      }
      if (digitalQty > 0) {
        await query(`
          INSERT INTO sales_txn (id, sku, store_id, qty, amount, payment_type, created_at)
          VALUES ($1, $2, $3, $4, $5, 'digital', NOW() - INTERVAL '${day} days');
        `, [uuidv4(), item.sku, storeId, digitalQty, digitalQty * item.price]);
        totalTxnCount++;
      }
    }
  }


  // ── Stage 3: Expiry Batches (doc 03 §2–3) ────────────────────────────────
  console.log("🥛 Seeding Stage 3 expiry batches...");
  const breadBatchId = uuidv4();
  const milkBatchId = uuidv4();

  await query(`
    INSERT INTO expiry_batches (id, sku, store_id, batch_qty, expiry_date)
    VALUES
      ($1, 'BREAD-WW', $2, 10.0, CURRENT_DATE + 2),
      ($3, 'MILK-1L',  $2, 5.0,  CURRENT_DATE - 2);
  `, [breadBatchId, storeId, milkBatchId]);
  // BREAD-WW: 2 days left → within markdown_threshold_days=3 → markdown trigger
  // MILK-1L : expired 2 days ago → days_left=-2 → writeoff trigger

  // Seeding an already-executed markdown for the expired MILK-1L batch
  // so the writeoff guardrail (markdown window must have elapsed) passes.
  await query(`
    INSERT INTO actions (id, store_id, type, sku, payload, status, escalated, decided_at, executed_at)
    VALUES ($1, $2, 'markdown', 'MILK-1L', $3, 'executed', false, NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days');
  `, [uuidv4(), storeId, JSON.stringify({
    batch_id: milkBatchId,
    product_name: "Full Cream Milk 1L",
    discount_pct: 0.50,
    new_price: 36.00,
    original_price: 72.00,
    qty: 5,
    label: "50% off",
    days_until_expiry: 0,
  })]);

  // ── Stage 3: Shelf Flag (doc 03 §4) ──────────────────────────────────────
  console.log("🏪 Seeding Stage 3 shelf flag...");
  await query(`
    INSERT INTO shelf_flags (sku, store_id, location, source)
    VALUES ('OIL-1L', $1, 'A3-Oils', 'manual');
  `, [storeId]);
  // OIL-1L: manual empty-flag on shelf A3-Oils → restock task trigger

  // ── Stage 3: Past Executed Reorder for Supplier Follow-up (doc 03 §6) ───
  console.log("📦 Seeding Stage 3 past-delivery reorder...");
  const pastReorderActionId = uuidv4();
  const ownerStaffId = "c0000000-0000-0000-0000-000000000001";
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  await query(`
    INSERT INTO actions (id, store_id, type, sku, payload, status, escalated, decided_by, decided_at, executed_at)
    VALUES ($1, $2, 'reorder', 'RICE-5KG', $3, 'executed', false, $4, NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days');
  `, [pastReorderActionId, storeId, JSON.stringify({
    sku: "RICE-5KG",
    product_name: "Basmati Rice 5kg",
    supplier: "Metro Staples Wholesale",
    supplier_phone: "+919876500002",
    qty: 10,
    cost: 6000,
    unit_cost: 600,
    unit: "bag",
    expected_delivery_date: yesterday,
    reorder_point: 20,
    qty_on_hand: 4,
    capped_by_storage_limit: false,
    requires_second_confirmation: false,
  }), ownerStaffId]);
  // expected_delivery_date = yesterday → past delivery → supplier follow-up trigger

  // ── Stage 5: RBAC Users, Store Users & API Tokens ─────────────────────────
  console.log("🔐 Seeding Stage 5 RBAC Users, Store Users, API Tokens & Store B...");

  // Clean RBAC tables
  await query("DELETE FROM api_tokens;");
  await query("DELETE FROM store_users;");
  await query("DELETE FROM users WHERE email LIKE '%@mrmart.app';");

  const userOwnerAId = uuidv4();
  const userManagerAId = uuidv4();
  const userStaffAId = uuidv4();
  const userOwnerBId = uuidv4();

  const storeBId = "b0000000-0000-0000-0000-000000000002";

  await query(`
    INSERT INTO users (id, email, phone, name)
    VALUES
      ($1::uuid, 'owner.a@mrmart.app',   '+919876543210', 'Rajesh Owner A'),
      ($2::uuid, 'manager.a@mrmart.app', '+919876543212', 'Vikram Manager A'),
      ($3::uuid, 'staff.a@mrmart.app',   '+919876543211', 'Suresh Staff A'),
      ($4::uuid, 'owner.b@mrmart.app',   '+919876543299', 'Anita Owner B');
  `, [userOwnerAId, userManagerAId, userStaffAId, userOwnerBId]);

  // Store B insertion
  await query(`
    INSERT INTO stores (id, account_id, name, phone, language, timezone)
    VALUES ($1::uuid, $2::uuid, 'Mr. Mart Store B Branch', '+919876543299', 'en', 'Asia/Kolkata')
    ON CONFLICT (id) DO NOTHING;
  `, [storeBId, accountId]);

  // Store Users (Owner & Staff roles per doc 05 §2)
  await query(`
    INSERT INTO store_users (id, user_id, store_id, role)
    VALUES
      ($1::uuid, $2::uuid, $5::uuid, 'owner'),
      ($3::uuid, $4::uuid, $5::uuid, 'staff'),
      ($6::uuid, $7::uuid, $8::uuid, 'owner');
  `, [uuidv4(), userOwnerAId, uuidv4(), userStaffAId, storeId, uuidv4(), userOwnerBId, storeBId]);

  // API Tokens (Expires in 1 year)
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  await query(`
    INSERT INTO api_tokens (id, user_id, store_id, token, expires_at)
    VALUES
      ($1::uuid, $2::uuid, $5::uuid, 'token_owner_store_a', $9),
      ($3::uuid, $4::uuid, $5::uuid, 'token_staff_store_a', $9),
      ($6::uuid, $7::uuid, $8::uuid, 'token_owner_store_b', $9);
  `, [uuidv4(), userOwnerAId, uuidv4(), userStaffAId, storeId, uuidv4(), userOwnerBId, storeBId, farFuture]);

  // Seed one pending action for Store B to test Store Isolation
  const storeBActionId = uuidv4();
  await query(`
    INSERT INTO actions (id, store_id, type, sku, payload, status, escalated)
    VALUES ($1::uuid, $2::uuid, 'reorder', 'RICE-5KG', $3, 'pending', false);
  `, [storeBActionId, storeBId, JSON.stringify({
    sku: "RICE-5KG",
    product_name: "Basmati Rice 5kg (Store B)",
    qty: 5,
    cost: 1500,
  })]);

  console.log("✅ Seed completed successfully!");

  console.log(`   Store ID: ${storeId}`);
  console.log(`   5 core products seeded with 14 days of sales history (${totalTxnCount} transactions).`);
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
