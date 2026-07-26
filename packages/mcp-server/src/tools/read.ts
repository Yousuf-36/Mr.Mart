/**
 * Read tools — power the cockpit's read-only monitoring screens.
 * Called by the Frontend (via Backend). Never change any state.
 * Doc 02 §1, Read tools table.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Helper: wrap result in a record shape the MCP SDK requires.
// Arrays must be wrapped in { items: [] } — the SDK validates structuredContent is a record object.
function sc<T>(val: T): Record<string, unknown> {
  if (Array.isArray(val)) return { items: val };
  return val as unknown as Record<string, unknown>;
}

import {
  mockProducts,
  mockStockLevels,
  mockSalesTxns,
  mockActions,
  computeStockStatus,
} from "../store/mock-store.js";

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
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(15)
          .describe("Max results (default 15)"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ category, limit = 15 }) => {
      let products = mockProducts.filter((p) => p.active);
      if (category) {
        products = products.filter(
          (p) => p.category.toLowerCase() === category.toLowerCase()
        );
      }
      products = products.slice(0, limit);

      const result = products.map((p) => {
        const qty = mockStockLevels[p.sku] ?? 0;
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
      });

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
        period: z
          .enum(["today", "week"])
          .default("today")
          .describe("Time window to summarise"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ period = "today" }) => {
      // In mock mode every transaction is "today"
      const txns =
        period === "today"
          ? mockSalesTxns
          : mockSalesTxns; // same mock — Stage 1 will query by date range

      const total_amount = txns.reduce((s, t) => s + t.amount, 0);
      const cash_amount = txns
        .filter((t) => t.payment_type === "cash")
        .reduce((s, t) => s + t.amount, 0);
      const digital_amount = txns
        .filter((t) => t.payment_type === "digital")
        .reduce((s, t) => s + t.amount, 0);
      const txn_count = txns.length;

      const result = { period, total_amount, cash_amount, digital_amount, txn_count };
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
        direction: z
          .enum(["top", "bottom"])
          .default("top")
          .describe("top = best sellers, bottom = slowest movers"),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ period = "today", direction = "top", limit = 10 }) => {
      // Aggregate units sold per SKU
      const unitsBySku: Record<string, number> = {};
      for (const txn of mockSalesTxns) {
        unitsBySku[txn.sku] = (unitsBySku[txn.sku] ?? 0) + txn.qty;
      }

      const entries = Object.entries(unitsBySku)
        .sort(([, a], [, b]) => (direction === "top" ? b - a : a - b))
        .slice(0, limit);

      const result = entries.map(([sku, units_sold]) => {
        const product = mockProducts.find((p) => p.sku === sku);
        return {
          sku,
          name: product?.name ?? sku,
          photo_url: product?.photo_url ?? null,
          placeholder_category_icon: product?.placeholder_category_icon ?? "📦",
          units_sold,
          trend: units_sold > 5 ? ("up" as const) : ("down" as const),
          period,
        };
      });

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
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const resolved = mockActions
        .filter(
          (a) =>
            a.status !== "pending" &&
            (a.decided_at ?? a.executed_at ?? a.created_at) >= today
        )
        .slice(0, limit)
        .map((a) => ({
          action_id: a.id,
          type: a.type,
          sku: a.sku,
          status: a.status,
          decided_at: a.decided_at?.toISOString() ?? null,
          executed_at: a.executed_at?.toISOString() ?? null,
        }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(resolved, null, 2) }],
        structuredContent: sc(resolved),
      };
    }
  );
}
