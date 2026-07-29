/**
 * Draft tools — background automation layer (Stage 3, doc 03 §1–7).
 * Compute a complete action (supplier, qty, price, message) and write it as a
 * pending action in Postgres. They NEVER touch inventory, prices, or supplier systems.
 *
 * Doc 02 §1, Draft tools table.
 * Doc 02 §2: "Draft tools compute the full decision server-side — the LLM calls them
 * with just an identifying sku/trigger, it does not invent the numbers itself."
 *
 * Security (doc 05 §2): draft tools are NOT registered on the MCP server's public
 * HTTP surface. They are registered as MCP tools so an agent inside the Worker can
 * compose them, but they must never be reachable by the Frontend.
 *
 * Phase 1 remediations applied: D-1, D-5, D-10.
 * mock-store.ts is preserved for legacy reference but has no runtime path here.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  draftReorderForSkuDb,
  createPendingActionDb,
  getProduct,
  getSettings,
  getCurrentStock,
  hasPendingAction,
  getExpiryBatch,
  hasPendingMarkdownForBatch,
  markdownElapsedForBatch,
  getOnDutyStaff,
  getTrailing7DayAvgDailySales,
  getTrailing30DayAvgDailySales,
  getActionDb,
  hasPendingSupplierFollowup,
  getTodayCashSales,
  DEFAULT_STORE_ID,
} from "../store/pg-store.js";

import {
  calculateMarkdownPrice,
  calculateWriteoffValue,
  calculateRestockQty,
  isSlowMover,
  calculateSlowMoverReorderPoint,
  calculateDiscrepancy,
} from "../formulas/stage3.js";

// Helper: wrap result in a record shape the MCP SDK requires.
function sc<T>(val: T): Record<string, unknown> {
  if (Array.isArray(val)) return { items: val };
  return val as unknown as Record<string, unknown>;
}

export function registerDraftTools(server: McpServer): void {
  // ── mrmart_draft_reorder ─────────────────────────────────────────────────
  // Stage 1: Unchanged — already backed by real Postgres via draftReorderForSkuDb.
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
      const storeId = store_id ?? DEFAULT_STORE_ID;
      const action = await draftReorderForSkuDb(sku, storeId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_expiry_markdown ─────────────────────────────────────────
  // Stage 3 (doc 03 §2): discount curve from settings; price floor enforced.
  server.registerTool(
    "mrmart_draft_expiry_markdown",
    {
      title: "Draft an expiry markdown",
      description:
        "Computes a discount price for a batch entering its expiry window using the settings markdown curve. Enforces a minimum margin price floor. Saves as a pending action. Does NOT update any price.",
      inputSchema: {
        sku: z.string(),
        batch_id: z.string().describe("UUID of the expiry batch to mark down"),
        store_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sku, batch_id, store_id }) => {
      const storeId = store_id ?? DEFAULT_STORE_ID;

      const [product, batch, settings] = await Promise.all([
        getProduct(sku, storeId),
        getExpiryBatch(batch_id, storeId),
        getSettings(storeId),
      ]);

      if (!product) throw new Error(`Product not found: ${sku}`);
      if (!batch) throw new Error(`Expiry batch not found or has no remaining qty: ${batch_id}`);
      if (batch.days_left <= 0) {
        throw new Error(`Batch ${batch_id} is already expired (days_left=${batch.days_left}). Use mrmart_draft_expiry_writeoff instead.`);
      }
      if (batch.days_left > settings.markdown_threshold_days) {
        throw new Error(`Batch ${batch_id} has ${batch.days_left} days left — above markdown threshold (${settings.markdown_threshold_days}).`);
      }

      const alreadyPending = await hasPendingMarkdownForBatch(batch_id, storeId);
      if (alreadyPending) {
        throw new Error(`Duplicate guardrail: a markdown action is already pending/approved for batch ${batch_id}.`);
      }

      const result = calculateMarkdownPrice(
        product.price,
        product.unit_cost,
        batch.days_left,
        settings.markdown_curve,
        settings.min_margin_pct
      );

      const payload = {
        sku,
        product_name: product.name,
        batch_id,
        discount_pct: result.discountPct,
        new_price: result.newPrice,
        original_price: product.price,
        qty: batch.batch_qty,
        expiry_date: batch.expiry_date instanceof Date ? batch.expiry_date.toISOString() : batch.expiry_date,
        days_until_expiry: batch.days_left,
        capped_at_floor: result.cappedAtFloor,
        label: result.label,
      };

      const action = await createPendingActionDb("markdown", sku, payload, storeId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_expiry_writeoff ─────────────────────────────────────────
  // Stage 3 (doc 03 §3): only fires after markdown window has elapsed.
  server.registerTool(
    "mrmart_draft_expiry_writeoff",
    {
      title: "Draft an expiry write-off",
      description:
        "Creates a write-off draft for a batch that has passed expiry with remaining unsold qty. Guardrail: only fires once a markdown action has had its window to clear the stock. Does NOT post to ledger.",
      inputSchema: {
        sku: z.string(),
        batch_id: z.string().describe("UUID of the expired expiry batch"),
        store_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sku, batch_id, store_id }) => {
      const storeId = store_id ?? DEFAULT_STORE_ID;

      const [product, batch] = await Promise.all([
        getProduct(sku, storeId),
        getExpiryBatch(batch_id, storeId),
      ]);

      if (!product) throw new Error(`Product not found: ${sku}`);
      if (!batch) throw new Error(`Expiry batch not found or has no remaining qty: ${batch_id}`);
      if (batch.days_left > 0) {
        throw new Error(`Batch ${batch_id} has not yet expired (days_left=${batch.days_left}). Wait for expiry before writing off.`);
      }

      // Write-off guardrail (doc 03 §3): markdown must have had its window
      const markdownElapsed = await markdownElapsedForBatch(batch_id, storeId);
      if (!markdownElapsed) {
        throw new Error(`Write-off guardrail: no markdown action has been attempted for batch ${batch_id}. Draft a markdown first.`);
      }

      // Duplicate check
      const alreadyPending = await hasPendingAction(sku, "writeoff", storeId);
      if (alreadyPending) {
        throw new Error(`Duplicate guardrail: an active writeoff action already exists for SKU ${sku}.`);
      }

      const { writeoffQty, writeoffValue } = calculateWriteoffValue(batch.batch_qty, product.unit_cost);

      const payload = {
        sku,
        product_name: product.name,
        batch_id,
        qty: writeoffQty,
        value: writeoffValue,
        unit_cost: product.unit_cost,
        expiry_date: batch.expiry_date instanceof Date ? batch.expiry_date.toISOString() : batch.expiry_date,
        days_past_expiry: Math.abs(batch.days_left),
      };

      const action = await createPendingActionDb("writeoff", sku, payload, storeId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_shelf_restock_task ──────────────────────────────────────
  // Stage 3 (doc 03 §4): real stock_ledger backroom qty; real staff assignment.
  server.registerTool(
    "mrmart_draft_shelf_restock_task",
    {
      title: "Draft a shelf restock task",
      description:
        "Creates a staff task to move stock from backroom to shelf. Guardrail: blocked when backroom qty is 0 (stockout → route to Auto-Reorder). Does NOT move any stock.",
      inputSchema: {
        sku: z.string(),
        location: z.string().describe("Aisle/shelf label where the empty flag was detected"),
        store_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sku, location, store_id }) => {
      const storeId = store_id ?? DEFAULT_STORE_ID;

      const [product, backroomQty, staff] = await Promise.all([
        getProduct(sku, storeId),
        getCurrentStock(sku, storeId),
        getOnDutyStaff(storeId),
      ]);

      if (!product) throw new Error(`Product not found: ${sku}`);

      // Shelf restock guardrail (doc 03 §4): no stock = auto-reorder, not restock
      const { restockQty, blockedByZeroBackroom } = calculateRestockQty(
        product.shelf_capacity,
        0,            // shelf_qty_estimate: 0 on a manual empty-flag (camera is Stage 7)
        backroomQty
      );

      if (blockedByZeroBackroom) {
        throw new Error(
          `Shelf restock blocked: backroom_qty=0 for SKU ${sku}. This is a stockout — route to mrmart_draft_reorder instead.`
        );
      }

      // Duplicate check
      const alreadyPending = await hasPendingAction(sku, "restock_task", storeId);
      if (alreadyPending) {
        throw new Error(`Duplicate guardrail: an active restock_task already exists for SKU ${sku}.`);
      }

      const assignee = staff ? `${staff.name} (${staff.id})` : "owner (no staff found)";

      const payload = {
        sku,
        product_name: product.name,
        location,
        qty: restockQty,
        shelf_capacity: product.shelf_capacity,
        backroom_qty: backroomQty,
        assignee,
      };

      const action = await createPendingActionDb("restock_task", sku, payload, storeId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_slowmover_adjustment ────────────────────────────────────
  // Stage 3 (doc 03 §5): real 7d vs 30d sales comparison; D-5 trigger fixed.
  server.registerTool(
    "mrmart_draft_slowmover_adjustment",
    {
      title: "Draft a slow-mover reorder point adjustment",
      description:
        "Detects a sustained sales drop (7-day avg < 60% of 30-day avg) and drafts a reorder point reduction (current × 0.5). Does NOT update the product record.",
      inputSchema: {
        sku: z.string(),
        store_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sku, store_id }) => {
      const storeId = store_id ?? DEFAULT_STORE_ID;

      const [product, settings, trailing7d, trailing30d] = await Promise.all([
        getProduct(sku, storeId),
        getSettings(storeId),
        getTrailing7DayAvgDailySales(sku, storeId),
        getTrailing30DayAvgDailySales(sku, storeId),
      ]);

      if (!product) throw new Error(`Product not found: ${sku}`);

      // Slow-mover trigger (doc 03 §5, D-5 fix): real 7d vs 30d comparison
      if (!isSlowMover(trailing7d, trailing30d, settings.slowmover_drop_pct)) {
        throw new Error(
          `No slow-mover condition detected for ${sku}: ` +
          `7d_avg=${trailing7d}, 30d_avg=${trailing30d}, drop_threshold=${settings.slowmover_drop_pct}.`
        );
      }

      // Duplicate check
      const alreadyPending = await hasPendingAction(sku, "reorder_point_adjustment", storeId);
      if (alreadyPending) {
        throw new Error(`Duplicate guardrail: an active reorder_point_adjustment already exists for SKU ${sku}.`);
      }

      const newReorderPoint = calculateSlowMoverReorderPoint(product.reorder_point);

      const payload = {
        sku,
        product_name: product.name,
        current_reorder_point: product.reorder_point,
        new_reorder_point: newReorderPoint,
        trailing_7d_avg: trailing7d,
        trailing_30d_avg: trailing30d,
        drop_pct: settings.slowmover_drop_pct,
        window_days: settings.slowmover_window_days,
      };

      const action = await createPendingActionDb("reorder_point_adjustment", sku, payload, storeId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_supplier_followup ───────────────────────────────────────
  // Stage 3 (doc 03 §6): real Postgres — checks executed reorders past delivery date.
  // Interface updated: takes action_id (the reorder to follow up on) instead of sku/supplier_id.
  server.registerTool(
    "mrmart_draft_supplier_followup",
    {
      title: "Draft a supplier follow-up message",
      description:
        "Composes a follow-up message for a reorder whose expected_delivery_date has passed. Takes the reorder action ID. Does NOT send the message.",
      inputSchema: {
        action_id: z.string().describe("UUID of the executed reorder action that missed its delivery date"),
        store_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ action_id, store_id }) => {
      const storeId = store_id ?? DEFAULT_STORE_ID;

      const reorderAction = await getActionDb(action_id, storeId);
      if (!reorderAction) throw new Error(`Action not found: ${action_id}`);
      if (reorderAction.type !== "reorder") throw new Error(`Expected a reorder action, got: ${reorderAction.type}`);
      if (reorderAction.status !== "executed") throw new Error(`Reorder ${action_id} is not yet executed (status=${reorderAction.status}).`);

      const expectedDeliveryDate = reorderAction.payload["expected_delivery_date"] as string | undefined;
      if (!expectedDeliveryDate) {
        throw new Error(`Reorder action ${action_id} has no expected_delivery_date in payload.`);
      }
      const deliveryDate = new Date(expectedDeliveryDate);
      if (deliveryDate >= new Date()) {
        throw new Error(`Delivery date ${expectedDeliveryDate} has not yet passed — no follow-up needed yet.`);
      }

      // Duplicate guard: one follow-up per missed delivery
      const alreadyFollowedUp = await hasPendingSupplierFollowup(action_id, storeId);
      if (alreadyFollowedUp) {
        throw new Error(`Follow-up already drafted for reorder action ${action_id}.`);
      }

      const supplier = (reorderAction.payload["supplier"] as string) ?? "Supplier";
      const supplierPhone = (reorderAction.payload["supplier_phone"] as string | null) ?? null;
      const productName = (reorderAction.payload["product_name"] as string) ?? reorderAction.sku ?? "product";
      const qty = reorderAction.payload["qty"] as number;

      // Template message (doc 03 §6; LLM-composed in later stages)
      const messageText =
        `Hello ${supplier}, we placed an order for ${qty} units of ${productName} ` +
        `expected by ${expectedDeliveryDate}, but it has not arrived. ` +
        `Could you please confirm the delivery status? Thank you.`;

      const payload = {
        ref_action_id: action_id,
        sku: reorderAction.sku,
        product_name: productName,
        supplier,
        supplier_phone: supplierPhone,
        message_text: messageText,
        expected_delivery_date: expectedDeliveryDate,
        qty,
      };

      const action = await createPendingActionDb("supplier_message", reorderAction.sku, payload, storeId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );

  // ── mrmart_draft_day_close ───────────────────────────────────────────────
  // Stage 3 (doc 03 §7): real Postgres sales totals; discrepancy from settings.
  server.registerTool(
    "mrmart_draft_day_close",
    {
      title: "Draft day-close reconciliation",
      description:
        "Reads today's cash and digital totals from sales_txn. Compares cash total against the physical count provided. Flags if discrepancy exceeds the store threshold. Does NOT close the ledger.",
      inputSchema: {
        date: z.string().describe("ISO date string for the day being closed (e.g. 2025-01-15)"),
        actual_cash: z.number().describe("Physical cash counted at close (₹)"),
        store_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ date, actual_cash, store_id }) => {
      const storeId = store_id ?? DEFAULT_STORE_ID;

      // Duplicate guard: only one day-close per store per day
      const alreadyPending = await hasPendingAction(null, "day_close", storeId);
      if (alreadyPending) {
        throw new Error("Duplicate guardrail: a day_close action is already pending/approved for today.");
      }

      const [todaySales, settings] = await Promise.all([
        getTodayCashSales(storeId),
        getSettings(storeId),
      ]);

      const { discrepancy, absDiscrepancy, flagged } = calculateDiscrepancy(
        actual_cash,
        todaySales.cash_amount,
        settings.discrepancy_threshold
      );

      const payload = {
        date,
        cash_amount: actual_cash,
        expected_cash: todaySales.cash_amount,
        digital_amount: todaySales.digital_amount,
        discrepancy,
        abs_discrepancy: absDiscrepancy,
        discrepancy_flagged: flagged,
        discrepancy_threshold: settings.discrepancy_threshold,
        txn_count: todaySales.txn_count,
      };

      const action = await createPendingActionDb("day_close", null, payload, storeId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(action, null, 2) }],
        structuredContent: sc({ action_id: action.id, status: action.status, payload: action.payload }),
      };
    }
  );
}
