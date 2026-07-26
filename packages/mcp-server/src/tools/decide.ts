/**
 * Decide tools — the ONLY tools the owner-facing app calls to act on a card.
 * mrmart_approve_action is the single choke point that triggers execution.
 *
 * Doc 02 §1, Decide tools table.
 * Doc 02 §2: "mrmart_approve_action is the only tool allowed to call an execute tool."
 * Doc 05 §2: owner only (except restock_task which staff may also approve).
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
  mockActions,
  mockProducts,
  updateAction,
  getAction,
} from "../store/mock-store.js";
import { executeByType } from "./execute.js";

/** Urgency sort weight — escalated pending cards sort first */
function urgencyWeight(action: { status: string; escalated: boolean; created_at: Date }): number {
  if (action.status !== "pending") return 0;
  if (action.escalated) return 2;
  return 1;
}

export function registerDecideTools(server: McpServer): void {
  // ── mrmart_list_pending_actions ──────────────────────────────────────────
  server.registerTool(
    "mrmart_list_pending_actions",
    {
      title: "List pending Approval Cards",
      description:
        "Returns every pending Approval Card, most urgent (escalated) first. This is what the Approval Queue home screen renders. Read-only.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(15),
        cursor: z.string().optional().describe("Pagination cursor (action_id of last item seen)"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit = 15, cursor }) => {
      let pending = mockActions
        .filter((a) => a.status === "pending")
        .sort((a, b) => {
          const wa = urgencyWeight(a);
          const wb = urgencyWeight(b);
          if (wa !== wb) return wb - wa;
          return b.created_at.getTime() - a.created_at.getTime();
        });

      // Cursor-based pagination
      if (cursor) {
        const idx = pending.findIndex((a) => a.id === cursor);
        if (idx !== -1) pending = pending.slice(idx + 1);
      }
      pending = pending.slice(0, limit);

      const result = pending.map((a) => {
        const product = a.sku ? mockProducts.find((p) => p.sku === a.sku) : null;
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
      });

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
        "Returns the complete drafted payload for one Approval Card (shown when the owner taps to expand). Read-only.",
      inputSchema: {
        action_id: z.string(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ action_id }) => {
      const action = getAction(action_id);
      if (!action) {
        throw new Error(`Action not found: ${action_id}`);
      }

      const product = action.sku
        ? mockProducts.find((p) => p.sku === action.sku)
        : null;

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
  // THE GOLDEN RULE: this is the ONLY tool that may call an execute function.
  server.registerTool(
    "mrmart_approve_action",
    {
      title: "Approve a pending action",
      description:
        "Owner tapped Approve on the Approval Card. Marks the action approved, then triggers its execute function internally. This is the ONLY tool allowed to trigger execution — no other code path may call execute tools directly (doc 02 §2 golden rule).",
      inputSchema: {
        action_id: z.string(),
        decided_by: z.string().optional().describe("Staff/owner ID who approved (from JWT in Stage 2+)"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ action_id, decided_by }) => {
      const action = getAction(action_id);
      if (!action) throw new Error(`Action not found: ${action_id}`);
      if (action.status !== "pending") {
        throw new Error(`Action ${action_id} is already ${action.status} — cannot approve`);
      }

      // Mark approved
      updateAction(action_id, {
        status: "approved",
        decided_by: decided_by ?? "owner-mock",
        decided_at: new Date(),
      });

      // The ONLY place executeByType is called. Not exposed to any other caller.
      const executeResult = await executeByType(action);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(executeResult, null, 2) }],
        structuredContent: sc(executeResult),
      };
    }
  );

  // ── mrmart_reject_action ─────────────────────────────────────────────────
  server.registerTool(
    "mrmart_reject_action",
    {
      title: "Reject a pending action",
      description:
        "Owner tapped Reject on the Approval Card. Archives the action with optional reason. No real-world state changes — a rejected action is purely logged.",
      inputSchema: {
        action_id: z.string(),
        reason: z.string().optional().describe("Short reason for rejection (logged for audit trail)"),
        decided_by: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ action_id, reason, decided_by }) => {
      const action = getAction(action_id);
      if (!action) throw new Error(`Action not found: ${action_id}`);
      if (action.status !== "pending") {
        throw new Error(`Action ${action_id} is already ${action.status} — cannot reject`);
      }

      const updated = updateAction(action_id, {
        status: "rejected",
        reject_reason: reason ?? null,
        decided_by: decided_by ?? "owner-mock",
        decided_at: new Date(),
      });

      const result = {
        action_id,
        status: "rejected",
        reject_reason: reason ?? null,
        decided_at: updated?.decided_at?.toISOString() ?? new Date().toISOString(),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: sc(result),
      };
    }
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build the 1-2 field summary shown on the closed Approval Card (doc 01 §4) */
function buildSummaryFields(action: { type: string; payload: Record<string, unknown> }): Record<string, unknown> {
  switch (action.type) {
    case "reorder":
      return { qty: action.payload.qty, cost: `₹${action.payload.cost}`, supplier: action.payload.supplier };
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
