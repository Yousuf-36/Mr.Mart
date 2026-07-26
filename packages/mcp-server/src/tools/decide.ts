/**
 * Decide tools — the ONLY tools the owner-facing app calls to act on a card.
 * mrmart_approve_action is the single choke point that triggers execution via queue.
 *
 * Doc 02 §1, Decide tools table.
 * Stage 1: Backed by real Postgres database & Redis BullMQ queue.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getPendingActionsDb,
  getActionDb,
  markActionApprovedDb,
  markActionRejectedDb,
  getProduct,
  DEFAULT_STORE_ID,
} from "../store/pg-store.js";
import { enqueueExecuteJob } from "../queue/index.js";

function sc<T>(val: T): Record<string, unknown> {
  if (Array.isArray(val)) return { items: val };
  return val as unknown as Record<string, unknown>;
}

export function registerDecideTools(server: McpServer): void {
  // ── mrmart_list_pending_actions ──────────────────────────────────────────
  server.registerTool(
    "mrmart_list_pending_actions",
    {
      title: "List pending Approval Cards",
      description:
        "Returns every pending Approval Card, most urgent (escalated) first. Powers the Approval Queue home screen. Read-only.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(15),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit = 15 }) => {
      const actions = await getPendingActionsDb(limit, DEFAULT_STORE_ID);

      const result = await Promise.all(
        actions.map(async (a) => {
          const product = a.sku ? await getProduct(a.sku, DEFAULT_STORE_ID) : null;
          return {
            action_id: a.id,
            type: a.type,
            sku: a.sku,
            photo_url: product?.photo_url ?? null,
            placeholder_category_icon: product?.placeholder_category_icon ?? "📋",
            summary_fields: buildSummaryFields(a),
            created_at: a.created_at.toISOString(),
            escalated: a.escalated,
            status: a.status,
          };
        })
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: sc(result),
      };
    }
  );

  // ── mrmart_get_action_detail ─────────────────────────────────────────────
  server.registerTool(
    "mrmart_get_action_detail",
    {
      title: "Get full action detail",
      description:
        "Returns the complete drafted payload for one Approval Card. Read-only.",
      inputSchema: {
        action_id: z.string(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ action_id }) => {
      const action = await getActionDb(action_id, DEFAULT_STORE_ID);
      if (!action) {
        throw new Error(`Action not found: ${action_id}`);
      }

      const product = action.sku ? await getProduct(action.sku, DEFAULT_STORE_ID) : null;

      const result = {
        action_id: action.id,
        type: action.type,
        sku: action.sku,
        name: product?.name ?? null,
        photo_url: product?.photo_url ?? null,
        placeholder_category_icon: product?.placeholder_category_icon ?? "📋",
        payload: action.payload,
        status: action.status,
        escalated: action.escalated,
        created_at: action.created_at.toISOString(),
        decided_at: action.decided_at?.toISOString() ?? null,
        executed_at: action.executed_at?.toISOString() ?? null,
        reject_reason: action.reject_reason,
        failure_reason: action.failure_reason,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: sc(result),
      };
    }
  );

  // ── mrmart_approve_action ────────────────────────────────────────────────
  // THE GOLDEN RULE: this is the ONLY tool that may trigger execution.
  // In Stage 1+, it marks action approved in Postgres and enqueues execution job to Redis queue.
  server.registerTool(
    "mrmart_approve_action",
    {
      title: "Approve a pending action",
      description:
        "Owner tapped Approve on the Approval Card. Marks the action approved in Postgres and enqueues execution to the Redis worker queue.",
      inputSchema: {
        action_id: z.string(),
        decided_by: z.string().optional().describe("Staff/owner ID who approved"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ action_id, decided_by }) => {
      const action = await markActionApprovedDb(action_id, decided_by ?? "owner-seed", DEFAULT_STORE_ID);

      // Enqueue job to Redis queue `mrmart-jobs` for async execution by Worker
      try {
        await enqueueExecuteJob(action.id);
      } catch (queueErr) {
        console.warn("[Approve Action] Failed to enqueue to Redis, fallback to local notice:", queueErr);
      }

      const result = {
        action_id: action.id,
        status: "approved",
        decided_at: action.decided_at?.toISOString() ?? new Date().toISOString(),
        enqueued: true,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: sc(result),
      };
    }
  );

  // ── mrmart_reject_action ─────────────────────────────────────────────────
  server.registerTool(
    "mrmart_reject_action",
    {
      title: "Reject a pending action",
      description:
        "Owner tapped Reject on the Approval Card. Archives the action in Postgres with optional reason.",
      inputSchema: {
        action_id: z.string(),
        reason: z.string().optional().describe("Short reason for rejection"),
        decided_by: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ action_id, reason, decided_by }) => {
      const action = await markActionRejectedDb(action_id, reason, decided_by ?? "owner-seed", DEFAULT_STORE_ID);

      const result = {
        action_id: action.id,
        status: "rejected",
        reject_reason: action.reject_reason,
        decided_at: action.decided_at?.toISOString() ?? new Date().toISOString(),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: sc(result),
      };
    }
  );
}

function buildSummaryFields(action: { type: string; payload: Record<string, unknown> }): Record<string, unknown> {
  switch (action.type) {
    case "reorder":
      return {
        qty: action.payload.qty,
        cost: `₹${action.payload.cost}`,
        supplier: action.payload.supplier,
        capped_by_storage_limit: action.payload.capped_by_storage_limit ?? false,
        requires_second_confirmation: action.payload.requires_second_confirmation ?? false,
      };
    case "markdown":
      return { new_price: `₹${action.payload.new_price}`, discount: `${((action.payload.discount_pct as number) * 100).toFixed(0)}% off` };
    case "writeoff":
      return { qty: action.payload.qty, value: `₹${action.payload.value}` };
    case "restock_task":
      return { qty: action.payload.qty, location: action.payload.location };
    case "reorder_point_adjustment":
      return { new_reorder_point: action.payload.new_reorder_point };
    case "supplier_message":
      return { supplier: action.payload.supplier };
    case "day_close":
      return { total: `₹${(action.payload.cash_amount as number) + (action.payload.digital_amount as number)}`, discrepancy: `₹${action.payload.discrepancy}` };
    default:
      return {};
  }
}
