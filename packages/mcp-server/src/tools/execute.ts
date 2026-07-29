/**
 * Execute tools — system-only, fired ONLY from mrmart_approve_action flow.
 * These tools change real-world state: send orders, update prices, post write-offs.
 *
 * GOLDEN RULE (doc 02 §2): no code path other than mrmart_approve_action may call these.
 *
 * These are NOT registered on the MCP server's public HTTP transport.
 * They are plain functions imported and called internally by the decide layer.
 * Doc 05 §2: draft/execute tools must not be reachable at the public Backend URL.
 *
 * D-2 fix: all execute functions now use DbAction from pg-store (not MockAction from mock-store).
 * D-3 note (established architecture): the Worker calls markActionExecutedDb directly for
 * the reorder type rather than routing through executeByType. This is the documented pattern
 * for Stage 1–3. The executeByType function is the MCP-callable path; both paths converge
 * on markActionExecutedDb in pg-store.
 *
 * External integrations (WhatsApp, POS, ledger) remain log-only stubs for Stages 1–3.
 * Real I/O is added in Stage 6 (external integrations).
 */

import {
  DbAction,
  markActionExecutedDb,
  postWriteoffLedgerEntry,
} from "../store/pg-store.js";

export type ExecuteResult = {
  action_id: string;
  status: "executed" | "failed";
  executed_at: string;
  result: Record<string, unknown>;
};

/** Internal dispatch: routes to the correct execute function by action type */
export async function executeByType(action: DbAction): Promise<ExecuteResult> {
  try {
    let result: Record<string, unknown>;

    switch (action.type) {
      case "reorder":
        result = await executeReorder(action);
        break;
      case "markdown":
        result = await executeMarkdown(action);
        break;
      case "writeoff":
        result = await executeWriteoff(action);
        break;
      case "restock_task":
        result = await executeRestockTask(action);
        break;
      case "reorder_point_adjustment":
        result = await executeReorderPointAdjustment(action);
        break;
      case "supplier_message":
        result = await executeSupplierMessage(action);
        break;
      case "day_close":
        result = await executeDayClose(action);
        break;
      default:
        throw new Error(`Unknown action type: ${(action as DbAction).type}`);
    }

    const executed_at = new Date().toISOString();
    await markActionExecutedDb(action.id, "executed", undefined, action.store_id);

    return { action_id: action.id, status: "executed", executed_at, result };
  } catch (err) {
    const failure_reason = err instanceof Error ? err.message : String(err);
    await markActionExecutedDb(action.id, "failed", failure_reason, action.store_id);
    return {
      action_id: action.id,
      status: "failed",
      executed_at: new Date().toISOString(),
      result: { error: failure_reason },
    };
  }
}

// ── Individual execute functions ──────────────────────────────────────────────

async function executeReorder(action: DbAction): Promise<Record<string, unknown>> {
  const { supplier, supplier_phone, qty, cost } = action.payload as {
    supplier: string;
    supplier_phone: string;
    qty: number;
    cost: number;
  };
  // Stages 1–3: log-only. Stage 6: WhatsApp Business API call.
  console.log(
    `[EXECUTE reorder] Would send WhatsApp to ${supplier} (${supplier_phone}): order ${qty} units for ₹${cost}`
  );
  return { sent_to: supplier, phone: supplier_phone, qty, cost, channel: "log-only" };
}

async function executeMarkdown(action: DbAction): Promise<Record<string, unknown>> {
  const { new_price, sku, qty } = action.payload as {
    new_price: number;
    sku: string;
    qty: number;
  };
  // Stages 1–3: log-only. Stage 6: POS/price update API call.
  console.log(
    `[EXECUTE markdown] Would update shelf price for ${sku} to ₹${new_price} (${qty} units)`
  );
  return { sku, new_price, qty, channel: "log-only" };
}

async function executeWriteoff(action: DbAction): Promise<Record<string, unknown>> {
  const { sku, qty, value } = action.payload as {
    sku: string;
    qty: number;
    value: number;
  };
  // Stage 3: post real ledger entry (D-2 fix — the one execute path with a clear Postgres write).
  await postWriteoffLedgerEntry(sku, qty, action.id, action.store_id);
  console.log(`[EXECUTE writeoff] Posted ledger entry: ${qty} units of ${sku}, value ₹${value}`);
  return { sku, qty, value, ledger_entry: "posted" };
}

async function executeRestockTask(action: DbAction): Promise<Record<string, unknown>> {
  const { sku, qty, assignee } = action.payload as {
    sku: string;
    qty: number;
    assignee: string;
  };
  // Stages 1–3: log-only. Stage 6: push notification to staff.
  console.log(`[EXECUTE restock_task] Would notify ${assignee}: bring ${qty} units of ${sku} to shelf`);
  return { sku, qty, assignee, notification: "log-only" };
}

async function executeReorderPointAdjustment(action: DbAction): Promise<Record<string, unknown>> {
  const { sku, new_reorder_point } = action.payload as {
    sku: string;
    new_reorder_point: number;
  };
  // Stages 1–3: log-only. Stage 4: UPDATE products SET reorder_point.
  console.log(`[EXECUTE reorder_point_adjustment] Would set reorder_point for ${sku} to ${new_reorder_point}`);
  return { sku, new_reorder_point, updated: "log-only" };
}

async function executeSupplierMessage(action: DbAction): Promise<Record<string, unknown>> {
  const { supplier, supplier_phone, message_text } = action.payload as {
    supplier: string;
    supplier_phone: string;
    message_text: string;
  };
  // Stages 1–3: log-only. Stage 6: WhatsApp Business API call.
  console.log(`[EXECUTE supplier_message] Would send to ${supplier}: "${message_text}"`);
  return { sent_to: supplier, phone: supplier_phone, message_text, channel: "log-only" };
}

async function executeDayClose(action: DbAction): Promise<Record<string, unknown>> {
  const { cash_amount, digital_amount, discrepancy } = action.payload as {
    cash_amount: number;
    digital_amount: number;
    discrepancy: number;
  };
  // Stages 1–3: log-only. Stage 6: write ledger close record.
  console.log(
    `[EXECUTE day_close] Day closed — cash: ₹${cash_amount}, digital: ₹${digital_amount}, discrepancy: ₹${discrepancy}`
  );
  return { cash_amount, digital_amount, discrepancy, ledger: "log-only" };
}
