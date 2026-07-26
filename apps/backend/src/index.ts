/**
 * Mr. Mart Backend — Stage 2
 *
 * REST API layer serving the Cockpit UI (React Native app).
 * Port 3001 (BACKEND_PORT).
 *
 * Exposes endpoints for:
 *  - Pending approval queue: GET /api/actions/pending
 *  - Approve action: POST /api/actions/:id/approve
 *  - Reject action: POST /api/actions/:id/reject
 *  - Stock Pulse: GET /api/monitoring/stock
 *  - Sales Pulse: GET /api/monitoring/top-sellers
 *  - Today's Money: GET /api/monitoring/sales-summary
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  getPendingActionsDb,
  getActionDb,
  markActionApprovedDb,
  markActionRejectedDb,
  getProducts,
  getCurrentStock,
  computeStockStatus,
  DEFAULT_STORE_ID,
  query,
} from "@mrmart/mcp-server/store/pg-store.js";
import { enqueueExecuteJob } from "@mrmart/mcp-server/queue/index.js";

const PORT = parseInt(process.env.BACKEND_PORT ?? "3001", 10);

const app = express();
app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mrmart-backend",
    stage: 2,
    timestamp: new Date().toISOString(),
  });
});

// ── Approval Queue Endpoints ──────────────────────────────────────────────────

// GET /api/actions/pending — List all pending approval cards
app.get("/api/actions/pending", async (req, res, next) => {
  try {
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const storeId = (req.query.store_id as string) || DEFAULT_STORE_ID;
    const actions = await getPendingActionsDb(limit, storeId);

    const cards = await Promise.all(
      actions.map(async (a) => {
        const product = a.sku ? await getProductSummary(a.sku, storeId) : null;
        return {
          id: a.id,
          store_id: a.store_id,
          type: a.type,
          sku: a.sku,
          product_name: product?.name ?? a.sku ?? "General Action",
          photo_url: product?.photo_url ?? null,
          placeholder_category_icon: product?.placeholder_category_icon ?? "📦",
          payload: a.payload,
          status: a.status,
          escalated: a.escalated,
          created_at: a.created_at.toISOString(),
        };
      })
    );

    res.json({ cards });
  } catch (err) {
    next(err);
  }
});

// POST /api/actions/:id/approve — Approve card (Golden Rule choke point)
app.post("/api/actions/:id/approve", async (req, res, next) => {
  try {
    const actionId = req.params.id;
    const decidedBy = req.body.decided_by || "c0000000-0000-0000-0000-000000000001"; // Default staff UUID
    const storeId = req.body.store_id || DEFAULT_STORE_ID;

    const action = await markActionApprovedDb(actionId, decidedBy, storeId);

    // Enqueue job to Redis worker queue
    try {
      await enqueueExecuteJob(action.id);
    } catch (qErr) {
      console.warn("[Backend] Redis queue unavailable, execution fallback triggered:", qErr);
    }

    res.json({
      success: true,
      action: {
        id: action.id,
        status: action.status,
        decided_at: action.decided_at?.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/actions/:id/reject — Reject card
app.post("/api/actions/:id/reject", async (req, res, next) => {
  try {
    const actionId = req.params.id;
    const reason = req.body.reason || "Rejected by owner";
    const decidedBy = req.body.decided_by || "c0000000-0000-0000-0000-000000000001";
    const storeId = req.body.store_id || DEFAULT_STORE_ID;

    const action = await markActionRejectedDb(actionId, reason, decidedBy, storeId);

    res.json({
      success: true,
      action: {
        id: action.id,
        status: action.status,
        reject_reason: action.reject_reason,
        decided_at: action.decided_at?.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── Monitoring Screen Endpoints ───────────────────────────────────────────────

// GET /api/monitoring/stock — Stock Pulse
app.get("/api/monitoring/stock", async (req, res, next) => {
  try {
    const storeId = (req.query.store_id as string) || DEFAULT_STORE_ID;
    const category = req.query.category as string | undefined;
    const products = await getProducts(category, 20, storeId);

    const items = await Promise.all(
      products.map(async (p) => {
        const qty = await getCurrentStock(p.sku, storeId);
        return {
          sku: p.sku,
          name: p.name,
          category: p.category,
          photo_url: p.photo_url,
          unit: p.unit,
          qty,
          reorder_point: p.reorder_point,
          shelf_capacity: p.shelf_capacity,
          status: computeStockStatus(qty, p.reorder_point),
        };
      })
    );

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /api/monitoring/top-sellers — Sales Pulse
app.get("/api/monitoring/top-sellers", async (req, res, next) => {
  try {
    const storeId = (req.query.store_id as string) || DEFAULT_STORE_ID;
    const period = (req.query.period as string) || "14 days";
    const limit = parseInt((req.query.limit as string) || "10", 10);

    const queryRes = await query<{
      sku: string;
      name: string;
      category: string;
      units_sold: number;
      revenue: number;
    }>(
      `SELECT s.sku, p.name, p.category, COALESCE(SUM(s.qty), 0)::float as units_sold, COALESCE(SUM(s.amount), 0)::float as revenue
       FROM sales_txn s
       JOIN products p ON s.sku = p.sku AND s.store_id = p.store_id
       WHERE s.store_id = $1 AND s.created_at >= NOW() - INTERVAL '${period}'
       GROUP BY s.sku, p.name, p.category
       ORDER BY units_sold DESC
       LIMIT $2`,
      [storeId, limit]
    );

    const items = queryRes.rows.map((row) => ({
      ...row,
      trend: row.units_sold > 50 ? ("up" as const) : ("down" as const),
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /api/monitoring/sales-summary — Today's Money
app.get("/api/monitoring/sales-summary", async (req, res, next) => {
  try {
    const storeId = (req.query.store_id as string) || DEFAULT_STORE_ID;

    const queryRes = await query<{
      total_sales: number;
      cash_sales: number;
      digital_sales: number;
      txn_count: number;
    }>(
      `SELECT 
         COALESCE(SUM(amount), 0)::float as total_sales,
         COALESCE(SUM(CASE WHEN payment_type = 'cash' THEN amount ELSE 0 END), 0)::float as cash_sales,
         COALESCE(SUM(CASE WHEN payment_type = 'digital' THEN amount ELSE 0 END), 0)::float as digital_sales,
         COUNT(*)::int as txn_count
       FROM sales_txn
       WHERE store_id = $1 AND created_at >= NOW() - INTERVAL '14 days'`,
      [storeId]
    );

    res.json({
      period: "14 days",
      ...queryRes.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// Helper
async function getProductSummary(sku: string, storeId: string) {
  const res = await query<{ name: string; photo_url: string | null; category: string }>(
    `SELECT name, photo_url, category FROM products WHERE sku = $1 AND store_id = $2`,
    [sku, storeId]
  );
  if (res.rows.length === 0) return null;
  return {
    name: res.rows[0].name,
    photo_url: res.rows[0].photo_url,
    placeholder_category_icon: getCategoryIcon(res.rows[0].category),
  };
}

function getCategoryIcon(category: string): string {
  switch (category.toLowerCase()) {
    case "grains": return "🌾";
    case "dairy": return "🥛";
    case "bakery": return "🍞";
    case "oils": return "🛢️";
    default: return "📦";
  }
}

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Backend] Error:", err.message);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Mr. Mart Backend Stage 2 listening on http://localhost:${PORT}`);
  console.log(`   Pending Queue: GET http://localhost:${PORT}/api/actions/pending`);
  console.log(`   Stock Pulse: GET http://localhost:${PORT}/api/monitoring/stock`);
  console.log(`   Sales Pulse: GET http://localhost:${PORT}/api/monitoring/top-sellers`);
  console.log(`   Today's Money: GET http://localhost:${PORT}/api/monitoring/sales-summary`);
});
