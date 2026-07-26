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
    VALUES ('a0000000-0000-0000-0000-000000000001', 'Supermart Mart Owner', '+919876543210', 'trial', NOW() + INTERVAL '14 days')
    RETURNING id;
  `);
  const accountId = accountRes.rows[0].id;

  await query(`
    INSERT INTO subscriptions (id, account_id, plan, status)
    VALUES ($1, $2, 'trial', 'active');
  `, [uuidv4(), accountId]);

  const storeRes = await query(`
    INSERT INTO stores (id, account_id, name, phone, language, timezone)
    VALUES ('b0000000-0000-0000-0000-000000000001', $1, 'Mr. Mart Main Branch', '+919876543210', 'en', 'Asia/Kolkata')
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
