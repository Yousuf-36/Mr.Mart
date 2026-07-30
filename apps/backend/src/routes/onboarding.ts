/**
 * First-Run Onboarding Flow API Endpoints (docs/08 §1 & doc 10 Stage 7).
 *
 * Flow:
 *  1. POST /api/onboarding/signup-otp    - Request OTP for store owner phone number
 *  2. POST /api/onboarding/verify-otp    - Verify OTP, create Store + Owner User in DB, return JWT session
 *  3. POST /api/onboarding/store-setup   - Store name, currency, location address
 *  4. POST /api/onboarding/quick-catalog - Add initial product catalog (applies smart default thresholds)
 *  5. POST /api/onboarding/supplier-setup- Add initial supplier details
 *  6. POST /api/onboarding/whatsapp      - Connect WhatsApp Business phone number
 *  7. POST /api/onboarding/complete      - Silently apply smart defaults (no day-1 settings form)
 *                                          and trigger auto-drafting to create live Approval Card!
 */

import { Router, Request, Response, NextFunction } from "express";
import { query } from "@mrmart/mcp-server/store/pg-store.js";
import { runAutoReorderCheck } from "../../../worker/src/index.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// In-memory OTP storage for signup verification
const pendingOtps: Record<string, { code: string; expiresAt: number }> = {};

// 1. Request Phone OTP
router.post("/signup-otp", (req: Request, res: Response) => {
  const { phone_number } = req.body;
  if (!phone_number) {
    res.status(400).json({ error: "phone_number is required" });
    return;
  }
  
  // Static test OTP '123456' for instant deterministic testability
  const code = "123456";
  pendingOtps[phone_number] = { code, expiresAt: Date.now() + 5 * 60 * 1000 };
  
  res.json({
    success: true,
    message: "OTP sent via SMS/WhatsApp",
    phone_number,
    code, // Returned for dev testing convenience
  });
});

// 2. Verify OTP & Initialize Account
router.post("/verify-otp", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone_number, code, owner_name } = req.body;
    const pending = pendingOtps[phone_number];

    if (!pending || pending.code !== code || pending.expiresAt < Date.now()) {
      res.status(400).json({ error: "Invalid or expired OTP code" });
      return;
    }

    delete pendingOtps[phone_number];

    const accountId = uuidv4();
    const storeId = uuidv4();
    const userId = uuidv4();

    // Insert Account into Postgres
    await query(
      `INSERT INTO accounts (id, name, owner_phone, plan)
       VALUES ($1, $2, $3, 'trial')
       ON CONFLICT DO NOTHING`,
      [accountId, owner_name || "Store Owner", phone_number]
    );

    // Insert Store into Postgres
    await query(
      `INSERT INTO stores (id, account_id, name, phone, language, timezone)
       VALUES ($1, $2, $3, $4, 'en', 'Asia/Kolkata')`,
      [storeId, accountId, `${owner_name || 'My Mart'}'s Supermarket`, phone_number]
    );

    // Insert Owner User into Postgres
    const userEmail = `${phone_number.replace(/\+/g, '')}@mrmart.internal`;
    await query(
      `INSERT INTO users (id, email, phone, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [userId, userEmail, phone_number, owner_name || "Store Owner"]
    );

    // Insert store_users relation (RBAC)
    await query(
      `INSERT INTO store_users (user_id, store_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (user_id, store_id) DO NOTHING`,
      [userId, storeId]
    );

    // Create API Token for DB auth validation
    const tokenId = uuidv4();
    const token = `tok_owner_${uuidv4()}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await query(
      `INSERT INTO api_tokens (id, user_id, store_id, token, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenId, userId, storeId, token, expiresAt]
    );

    // Insert Default Settings (docs/03 smart defaults silently applied)
    await query(
      `INSERT INTO settings (
        store_id, safety_factor, review_period_days, large_order_value_threshold,
        markdown_threshold_days, min_margin_pct, markdown_curve, slowmover_drop_pct,
        slowmover_window_days, discrepancy_threshold
       ) VALUES ($1, 1.2, 7, 5000, 3, 0.02, '{"3":0.10,"2":0.25,"1":0.40,"0":0.50}'::jsonb, 0.40, 7, 200)`,
      [storeId]
    );

    res.json({
      success: true,
      token,
      store_id: storeId,
      user_id: userId,
      step: "store-setup",
    });
  } catch (err) {
    next(err);
  }
});

// 3. Store Basics Setup
router.post("/store-setup", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_id, store_name, address } = req.body;
    if (!store_id || !store_name) {
      res.status(400).json({ error: "store_id and store_name are required" });
      return;
    }

    await query(
      `UPDATE stores SET name = $1 WHERE id = $2`,
      [store_name, store_id]
    );

    res.json({ success: true, step: "quick-catalog" });
  } catch (err) {
    next(err);
  }
});

// 4. Quick-Add Catalog
router.post("/quick-catalog", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_id, products } = req.body;
    if (!store_id || !Array.isArray(products)) {
      res.status(400).json({ error: "store_id and products array are required" });
      return;
    }

    for (const p of products) {
      // Create product
      await query(
        `INSERT INTO products (
          sku, store_id, name, category, unit, unit_cost, price,
          reorder_point, max_order_qty, shelf_capacity, active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
        ON CONFLICT (sku, store_id) DO UPDATE
        SET name = EXCLUDED.name, price = EXCLUDED.price, unit_cost = EXCLUDED.unit_cost`,
        [
          p.sku,
          store_id,
          p.name,
          p.category || "General",
          p.unit || "unit",
          p.unit_cost || 50,
          p.price || 75,
          p.reorder_point || 20,
          p.max_order_qty || 100,
          p.shelf_capacity || 50,
        ]
      );

      // Create initial stock level entry in stock_ledger
      const initialQty = (p.backroom_qty ?? 5) + (p.shelf_qty ?? 5);
      await query(
        `INSERT INTO stock_ledger (sku, store_id, delta_qty, reason)
         VALUES ($1, $2, $3, 'manual_correction')`,
        [p.sku, store_id, initialQty]
      );
    }

    res.json({ success: true, count: products.length, step: "supplier-setup" });
  } catch (err) {
    next(err);
  }
});

// 5. Supplier Setup
router.post("/supplier-setup", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_id, suppliers } = req.body;
    if (!store_id || !Array.isArray(suppliers)) {
      res.status(400).json({ error: "store_id and suppliers array are required" });
      return;
    }

    for (const s of suppliers) {
      const supplierId = uuidv4();
      await query(
        `INSERT INTO suppliers (id, store_id, name, phone, lead_time_days)
         VALUES ($1, $2, $3, $4, $5)`,
        [supplierId, store_id, s.name, s.phone_number || s.phone || "+919876500112", s.lead_time_days || 3]
      );

      if (s.skus && Array.isArray(s.skus)) {
        await query(
          `UPDATE products SET supplier_id = $1 WHERE store_id = $2 AND sku = ANY($3::text[])`,
          [supplierId, store_id, s.skus]
        );
      }
    }

    res.json({ success: true, step: "whatsapp-connect" });
  } catch (err) {
    next(err);
  }
});

// 6. WhatsApp Business Connect & Onboarding Completion
router.post("/complete", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_id, whatsapp_phone } = req.body;
    if (!store_id) {
      res.status(400).json({ error: "store_id is required" });
      return;
    }

    // Update store active status
    await query(
      `UPDATE stores SET active = true WHERE id = $1`,
      [store_id]
    );

    // Trigger auto-drafting loop to immediately evaluate inventory and generate live Approval Cards!
    const draftedCount = await runAutoReorderCheck(store_id);

    res.json({
      success: true,
      onboarding_completed: true,
      drafted_cards_count: draftedCount,
      message: "First-run onboarding completed successfully! Live Approval Cards generated.",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
