/**
 * Read tools — power the cockpit's read-only monitoring screens.
 * Called by the Frontend (via Backend). Never change any state.
 * Doc 02 §1, Read tools table. Stage 1: Backed by real Postgres database.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getProducts,
  getCurrentStock,
  DEFAULT_STORE_ID,
  pool,
} from "../store/pg-store.js";
import { computeStockStatus } from "../store/pg-store.js";

function sc<T>(val: T): Record<string, unknown> {
  if (Array.isArray(val)) return { items: val };
  return val as unknown as Record<string, unknown>;
}

export function registerReadTools(server: McpServer): void {
  // ── mrmart_get_stock_levels ──────────────────────────────────────────────
  server.registerTool(
    "mrmart_get_stock_levels",
    {
      title: "Get stock levels",
      description:
        "Returns current stock per SKU with urgency banding (green/yellow/red). Powers the Stock Pulse screen. Read-only.",
      inputSchema: {
        category: z.string().optional().describe("Filter by product category"),
        limit: z.number().int().min(1).max(100).default(15).describe("Max results (default 15)"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ category, limit = 15 }) => {
      const products = await getProducts(category, limit, DEFAULT_STORE_ID);

      const result = await Promise.all(
        products.map(async (p) => {
          const qty = await getCurrentStock(p.sku, DEFAULT_STORE_ID);
          return {
            sku: p.sku,
            name: p.name,
            photo_url: p.photo_url,
            placeholder_category_icon: p.placeholder_category_icon,
            category: p.category,
            qty,
            unit: p.unit,
            reorder_point: p.reorder_point,
            status: computeStockStatus(qty, p.reorder_point),
          };
        })
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: sc(result),
      };
    }
  );

  // ── mrmart_get_sales_summary ─────────────────────────────────────────────
  server.registerTool(
    "mrmart_get_sales_summary",
    {
      title: "Get sales summary",
      description:
        "Returns aggregated sales totals for today or the current week. Powers the Today's Money screen. Read-only.",
      inputSchema: {
        period: z.enum(["today", "week"]).default("today").describe("Time window to summarise"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ period = "today" }) => {
      const interval = period === "today" ? "1 day" : "7 days";
      const res = await pool.query<{
        total_amount: number;
        cash_amount: number;
        digital_amount: number;
        txn_count: number;
      }>(
        `SELECT 
           COALESCE(SUM(amount), 0)::float as total_amount,
           COALESCE(SUM(CASE WHEN payment_type = 'cash' THEN amount ELSE 0 END), 0)::float as cash_amount,
           COALESCE(SUM(CASE WHEN payment_type = 'digital' THEN amount ELSE 0 END), 0)::float as digital_amount,
           COUNT(*)::int as txn_count
         FROM sales_txn
         WHERE store_id = $1 AND created_at >= NOW() - INTERVAL '${interval}'`,
        [DEFAULT_STORE_ID]
      );

      const result = { period, ...res.rows[0] };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: sc(result),
      };
    }
  );

  // ── mrmart_get_top_sellers ───────────────────────────────────────────────
  server.registerTool(
    "mrmart_get_top_sellers",
    {
      title: "Get top/bottom sellers",
      description:
        "Returns best or worst performing SKUs by units sold. Powers the Sales Pulse screen. Read-only.",
      inputSchema: {
        period: z.enum(["today", "week"]).default("today"),
        direction: z.enum(["top", "bottom"]).default("top").describe("top = best sellers, bottom = slowest movers"),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ period = "today", direction = "top", limit = 10 }) => {
      const interval = period === "today" ? "1 day" : "7 days";
      const order = direction === "top" ? "DESC" : "ASC";

      const res = await pool.query<{
        sku: string;
        name: string;
        photo_url: string | null;
        units_sold: number;
      }>(
        `SELECT s.sku, p.name, p.photo_url, COALESCE(SUM(s.qty), 0)::float as units_sold
         FROM sales_txn s
         JOIN products p ON s.sku = p.sku AND s.store_id = p.store_id
         WHERE s.store_id = $1 AND s.created_at >= NOW() - INTERVAL '${interval}'
         GROUP BY s.sku, p.name, p.photo_url
         ORDER BY units_sold ${order}
         LIMIT $2`,
        [DEFAULT_STORE_ID, limit]
      );

      const result = res.rows.map((row: { sku: string; name: string; photo_url: string | null; units_sold: number }) => ({
        ...row,
        placeholder_category_icon: "📦",
        trend: row.units_sold > 5 ? ("up" as const) : ("down" as const),
        period,
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: sc(result),
      };
    }
  );

  // ── mrmart_get_today_activity ────────────────────────────────────────────
  server.registerTool(
    "mrmart_get_today_activity",
    {
      title: "Get today's activity",
      description:
        "Returns all actions approved, executed, or rejected today. Powers the Today's Activity timeline. Read-only.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit = 20 }) => {
      const res = await pool.query<{
        action_id: string;
        type: string;
        sku: string | null;
        status: string;
        decided_at: Date | null;
        executed_at: Date | null;
      }>(
        `SELECT id as action_id, type, sku, status, decided_at, executed_at
         FROM actions
         WHERE store_id = $1 AND status != 'pending' AND created_at >= CURRENT_DATE
         ORDER BY created_at DESC
         LIMIT $2`,
        [DEFAULT_STORE_ID, limit]
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(res.rows, null, 2) }],
        structuredContent: sc(res.rows),
      };
    }
  );
}
