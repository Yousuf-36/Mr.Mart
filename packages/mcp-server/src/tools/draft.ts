/**
 * Draft tools — background automation layer.
 * Compute a complete action (supplier, qty, price, message) and write it as a
 * pending action. They NEVER touch inventory, prices, or supplier systems directly.
 *
 * Doc 02 §1, Draft tools table.
 * Doc 02 §2: "Draft tools compute the full decision server-side — the LLM calls them
 * with just an identifying sku/trigger, it does not invent the numbers itself."
 *
 * Security (doc 05 §2): draft tools are NOT registered on the MCP server's public
 * HTTP surface. They are registered as MCP tools so an LLM agent inside the Worker
 * can reason about and compose them, but they must never be reachable by the Frontend.
 * The server enforces this via a caller-source check on the HTTP transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { draftReorderForSkuDb, DEFAULT_STORE_ID } from "../store/pg-store.js";

// Helper: wrap result in a record shape the MCP SDK requires.
// Arrays must be wrapped in { items: [] } — the SDK validates structuredContent is a record object.
function sc<T>(val: T): Record<string, unknown> {
  if (Array.isArray(val)) return { items: val };
  return val as unknown as Record<string, unknown>;
}

import {
  getProduct,
  getSupplier,
  mockStockLevels,
  mockExpiryBatches,
  mockSalesTxns,
  createPendingAction,
} from "../store/mock-store.js";

/** Markdown discount curve from doc 04 settings defaults */
const MARKDOWN_CURVE: Record<number, number> = { 3: 0.10, 2: 0.25, 1: 0.40, 0: 0.50 };
const MIN_MARGIN_PCT = 0.02;
const SLOWMOVER_DROP_PCT = 0.40;
const SLOWMOVER_WINDOW_DAYS = 7;

/** Days until a date */
function daysUntil(date: Date): number {
  return Math.floor((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function registerDraftTools(server: McpServer): void {
  // ── mrmart_draft_reorder ─────────────────────────────────────────────────
  server.registerTool(
    "mrmart_draft_reorder",
    {
      title: "Draft a reorder",
      description:
        "Computes a complete reorder (supplier, quantity, cost) for a low-stock SKU and saves it as a pending action. Does NOT place the order. Called by the Worker scheduler when stock crosses the reorder point.",
      inputSchema: {
        sku: z.string().describe("SKU of the low-stock product"),
        store_id: z.string().optional().describe("Store ID (multi-tenant scope)"),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sku, store_id }) => {
      const action = await draftReorderForSkuDb(sku, store_id ?? DEFAULT_STORE_ID);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_expiry_markdown ─────────────────────────────────────────
  server.registerTool(
    "mrmart_draft_expiry_markdown",
    {
      title: "Draft an expiry markdown",
      description:
        "Computes a discount price for a batch entering its expiry window and saves it as a pending action. Does NOT update any price.",
      inputSchema: {
        sku: z.string(),
        batch_id: z.string(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sku, batch_id }) => {
      const product = getProduct(sku);
      if (!product) throw new Error(`Product not found: ${sku}`);

      const batch = mockExpiryBatches.find(
        (b) => b.id === batch_id && b.sku === sku
      );
      if (!batch) throw new Error(`Expiry batch not found: ${batch_id}`);

      const days = daysUntil(batch.expiry_date);
      // Find the applicable discount from the curve
      const curveKey = Object.keys(MARKDOWN_CURVE)
        .map(Number)
        .filter((k) => days <= k)
        .sort((a, b) => b - a)[0];

      const discountPct = curveKey !== undefined ? MARKDOWN_CURVE[curveKey] : 0.5;
      const minPrice = product.unit_cost * (1 + MIN_MARGIN_PCT);
      const newPrice = Math.max(
        parseFloat((product.price * (1 - discountPct)).toFixed(2)),
        parseFloat(minPrice.toFixed(2))
      );

      const action = createPendingAction("markdown", sku, {
        sku,
        batch_id,
        discount_pct: discountPct,
        new_price: newPrice,
        original_price: product.price,
        qty: batch.batch_qty,
        expiry_date: batch.expiry_date.toISOString(),
        days_until_expiry: days,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_expiry_writeoff ─────────────────────────────────────────
  server.registerTool(
    "mrmart_draft_expiry_writeoff",
    {
      title: "Draft an expiry write-off",
      description:
        "Creates a write-off draft for a batch that has passed expiry unsold. Does NOT post to ledger.",
      inputSchema: {
        sku: z.string(),
        batch_id: z.string(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sku, batch_id }) => {
      const product = getProduct(sku);
      if (!product) throw new Error(`Product not found: ${sku}`);

      const batch = mockExpiryBatches.find((b) => b.id === batch_id && b.sku === sku);
      if (!batch) throw new Error(`Expiry batch not found: ${batch_id}`);

      const value = batch.batch_qty * product.unit_cost;

      const action = createPendingAction("writeoff", sku, {
        sku,
        batch_id,
        qty: batch.batch_qty,
        value,
        expiry_date: batch.expiry_date.toISOString(),
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_shelf_restock_task ──────────────────────────────────────
  server.registerTool(
    "mrmart_draft_shelf_restock_task",
    {
      title: "Draft a shelf restock task",
      description:
        "Creates a restock task (move stock from backroom to shelf) as a pending action for staff. Does NOT move any stock.",
      inputSchema: {
        sku: z.string(),
        location: z.string().describe("Aisle/shelf label where the gap was detected"),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sku, location }) => {
      const product = getProduct(sku);
      if (!product) throw new Error(`Product not found: ${sku}`);

      const currentShelf = mockStockLevels[sku] ?? 0;
      const qtyToMove = Math.max(0, product.shelf_capacity - currentShelf);

      // Assign to first active staff (Stage 0: mock — no real staff table lookup)
      const assignee = "staff-001 (mock)";

      const action = createPendingAction("restock_task", sku, {
        sku,
        location,
        qty: qtyToMove,
        assignee,
        shelf_capacity: product.shelf_capacity,
        current_shelf_qty: currentShelf,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_slowmover_adjustment ────────────────────────────────────
  server.registerTool(
    "mrmart_draft_slowmover_adjustment",
    {
      title: "Draft a slow-mover reorder point adjustment",
      description:
        "Computes a reduced reorder point for a slow-moving SKU and saves it as a pending action. Does NOT update the product.",
      inputSchema: {
        sku: z.string(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sku }) => {
      const product = getProduct(sku);
      if (!product) throw new Error(`Product not found: ${sku}`);

      // Compute rolling avg units/day over mock window
      const windowStart = new Date(Date.now() - SLOWMOVER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const recentSales = mockSalesTxns.filter(
        (t) => t.sku === sku && t.created_at >= windowStart
      );
      const totalUnits = recentSales.reduce((s, t) => s + t.qty, 0);
      const avgPerDay = totalUnits / SLOWMOVER_WINDOW_DAYS;

      // New reorder point = avgPerDay * lead_time_days (simplified — doc 03 has the full formula)
      const new_reorder_point = Math.max(
        1,
        Math.round(avgPerDay * 2) // safety_factor placeholder
      );

      const action = createPendingAction("reorder_point_adjustment", sku, {
        sku,
        current_reorder_point: product.reorder_point,
        new_reorder_point,
        avg_daily_sales: avgPerDay,
        window_days: SLOWMOVER_WINDOW_DAYS,
        drop_pct: SLOWMOVER_DROP_PCT,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_supplier_followup ───────────────────────────────────────
  server.registerTool(
    "mrmart_draft_supplier_followup",
    {
      title: "Draft a supplier follow-up message",
      description:
        "Composes a ready-to-send follow-up message for a late delivery and saves it as a pending action. Does NOT send the message.",
      inputSchema: {
        sku: z.string(),
        supplier_id: z.string(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sku, supplier_id }) => {
      const product = getProduct(sku);
      if (!product) throw new Error(`Product not found: ${sku}`);

      const supplier = getSupplier(supplier_id);
      if (!supplier) throw new Error(`Supplier not found: ${supplier_id}`);

      // Stage 0: template message. Stage 2+: LLM-generated in Worker (doc 01 §8).
      const message_text =
        `Hello ${supplier.name}, we haven't received our order for ${product.name}. ` +
        `Could you please confirm the delivery status? Thank you.`;

      const action = createPendingAction("supplier_message", sku, {
        sku,
        supplier: supplier.name,
        supplier_phone: supplier.phone,
        supplier_id,
        message_text,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_day_close ───────────────────────────────────────────────
  server.registerTool(
    "mrmart_draft_day_close",
    {
      title: "Draft day-close reconciliation",
      description:
        "Computes today's cash vs digital totals and any discrepancy, saving a pending day-close action. Does NOT close the ledger.",
      inputSchema: {
        date: z.string().describe("ISO date string for the day being closed (e.g. 2025-01-15)"),
        actual_cash: z.number().describe("Physical cash counted at close"),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ date, actual_cash }) => {
      const cash_from_sales = mockSalesTxns
        .filter((t) => t.payment_type === "cash")
        .reduce((s, t) => s + t.amount, 0);

      const digital_amount = mockSalesTxns
        .filter((t) => t.payment_type === "digital")
        .reduce((s, t) => s + t.amount, 0);

      const discrepancy = parseFloat((actual_cash - cash_from_sales).toFixed(2));

      const action = createPendingAction("day_close", null, {
        date,
        cash_amount: actual_cash,
        expected_cash: cash_from_sales,
        digital_amount,
        discrepancy,
        txn_count: mockSalesTxns.length,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );
}
