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
import { requireAuth } from "./middleware/auth.js";
import {
  getPendingActionsDb,
  getActionDb,
  markActionApprovedDb,
  markActionRejectedDb,
  canApproveAction,
  getProducts,
  getCurrentStock,
  computeStockStatus,
  DEFAULT_STORE_ID,
  query,
  checkAccountDegraded,
} from "@mrmart/mcp-server/store/pg-store.js";
import { enqueueExecuteJob } from "@mrmart/mcp-server/queue/index.js";

import onboardingRouter from "./routes/onboarding.js";
import billingRouter from "./routes/billing.js";

const PORT = parseInt(process.env.BACKEND_PORT ?? "3001", 10);

const app = express();
app.use(cors());
app.use(express.json());

// Mount Routers
app.use("/api/onboarding", onboardingRouter);
app.use("/api/billing", billingRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mrmart-backend",
    stage: 8,
    timestamp: new Date().toISOString(),
  });
});

// ── Approval Queue Endpoints (Protected by requireAuth) ───────────────────────

// GET /api/actions/pending — List pending approval cards for authenticated store
app.get("/api/actions/pending", requireAuth, async (req, res, next) => {
  try {
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const storeId = req.user!.store_id;
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

// POST /api/actions/:id/approve — Approve card (RBAC & Golden Rule choke point)
app.post("/api/actions/:id/approve", requireAuth, async (req, res, next) => {
  try {
    const actionId = req.params.id;
    const user = req.user!;

    // 0. Stage 8: Check if account is degraded (read-only mode)
    const degradedCheck = await checkAccountDegraded(user.store_id);
    if (degradedCheck.isDegraded) {
      res.status(403).json({ error: degradedCheck.reason || "Forbidden: Account status is degraded" });
      return;
    }

    // 1. Fetch action scoped to authenticated store
    const action = await getActionDb(actionId, user.store_id);
    if (!action) {
      res.status(404).json({ error: `Action not found or unauthorized for store: ${actionId}` });
      return;
    }

    // 2. State machine guard: action must be in 'pending' or 'failed' state
    if (action.status !== "pending" && action.status !== "failed") {
      res.status(409).json({ error: `State Machine Block: Action ${actionId} is already in '${action.status}' state` });
      return;
    }

    // 3. Enforce RBAC role permissions
    const check = canApproveAction(user.role, action);
    if (!check.allowed) {
      res.status(403).json({ error: check.reason || "Forbidden: Role permissions insufficient for action" });
      return;
    }

    // 4. Update status in Postgres
    const approvedAction = await markActionApprovedDb(actionId, user.user_id, user.store_id);

    const simulateFailure = req.body.simulate_failure;

    // 5. Enqueue execution job
    try {
      await enqueueExecuteJob(approvedAction.id, simulateFailure ? { simulate_failure: true } : undefined);
    } catch (qErr) {
      console.warn("[Backend] Redis queue unavailable, execution fallback triggered:", qErr);
    }

    res.json({
      success: true,
      action: {
        id: approvedAction.id,
        status: approvedAction.status,
        decided_at: approvedAction.decided_at?.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/actions/:id/reject — Reject card
app.post("/api/actions/:id/reject", requireAuth, async (req, res, next) => {
  try {
    const actionId = req.params.id;
    const user = req.user!;
    const reason = req.body.reason || "Rejected by user";

    // 0. Stage 8: Check if account is degraded (read-only mode)
    const degradedCheck = await checkAccountDegraded(user.store_id);
    if (degradedCheck.isDegraded) {
      res.status(403).json({ error: degradedCheck.reason || "Forbidden: Account status is degraded" });
      return;
    }

    const action = await getActionDb(actionId, user.store_id);
    if (!action) {
      res.status(404).json({ error: `Action not found or unauthorized for store: ${actionId}` });
      return;
    }

    if (user.role === "staff" && action.type !== "restock_task") {
      res.status(403).json({ error: "Staff role is forbidden from rejecting financial automations" });
      return;
    }

    const rejectedAction = await markActionRejectedDb(actionId, reason, user.user_id, user.store_id);

    res.json({
      success: true,
      action: {
        id: rejectedAction.id,
        status: rejectedAction.status,
        reject_reason: rejectedAction.reject_reason,
        decided_at: rejectedAction.decided_at?.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── Monitoring Screen Endpoints (Protected by requireAuth) ────────────────────

// GET /api/monitoring/stock — Stock Pulse
app.get("/api/monitoring/stock", requireAuth, async (req, res, next) => {
  try {
    const storeId = req.user!.store_id;
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
app.get("/api/monitoring/top-sellers", requireAuth, async (req, res, next) => {
  try {
    const storeId = req.user!.store_id;
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
app.get("/api/monitoring/sales-summary", requireAuth, async (req, res, next) => {
  try {
    const storeId = req.user!.store_id;

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

// ── Vision Camera Webhook Endpoints (Protected by x-camera-api-key) ───────────

import { visionAdapter } from "@mrmart/mcp-server/adapters/vision-adapter.js";

const CAMERA_API_KEY = process.env.CAMERA_API_KEY || "cam_secret_key_123";

function validateCameraApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKey = req.headers["x-camera-api-key"] || req.query.api_key;
  if (!apiKey || apiKey !== CAMERA_API_KEY) {
    res.status(401).json({ error: "Unauthorized: Invalid or missing x-camera-api-key hardware header" });
    return;
  }
  next();
}

// POST /api/webhooks/vision/shelf — Ingest shelf camera stockout telemetry
app.post("/api/webhooks/vision/shelf", validateCameraApiKey, async (req, res, next) => {
  try {
    const result = await visionAdapter.processShelfCameraPayload(req.body);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

// POST /api/webhooks/vision/queue — Ingest checkout camera congestion telemetry
app.post("/api/webhooks/vision/queue", validateCameraApiKey, async (req, res, next) => {
  try {
    const result = await visionAdapter.processCheckoutCameraPayload(req.body);
    res.json({ success: true, result });
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
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err && (err.code === "22P02" || (err.message && err.message.includes("invalid input syntax for type uuid")))) {
    res.status(400).json({ error: "Bad Request: Invalid UUID syntax format" });
    return;
  }
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
