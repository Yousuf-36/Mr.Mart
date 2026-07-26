/**
 * Execute tools — system-only, fired ONLY from mrmart_approve_action.
 * These tools change real-world state: send orders, update prices, post write-offs.
 *
 * GOLDEN RULE (doc 02 §2): no code path other than mrmart_approve_action may call these.
 * In Stage 0 they are log-only (mock). Real I/O is added in later stages.
 *
 * These are NOT registered on the MCP server's public HTTP transport —
 * they are plain functions imported and called internally by the decide layer.
 * Doc 05 §2: draft/execute tools must not be reachable at the public Backend URL.
 */

import {
  getAction,
  updateAction,
  mockStockLevels,
  MockAction,
} from "../store/mock-store.js";

export type ExecuteResult = {
  action_id: string;
  status: "executed" | "failed";
  executed_at: string;
  result: Record<string, unknown>;
};

/** Internal dispatch: routes to the correct execute function by action type */
export async function executeByType(action: MockAction): Promise<ExecuteResult> {
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
        throw new Error(`Unknown action type: ${(action as MockAction).type}`);
    }

    const executed_at = new Date().toISOString();
    updateAction(action.id, { status: "executed", executed_at: new Date() });

    return { action_id: action.id, status: "executed", executed_at, result };
  } catch (err) {
    const failure_reason = err instanceof Error ? err.message : String(err);
    updateAction(action.id, { status: "failed", failure_reason });
    return {
      action_id: action.id,
      status: "failed",
      executed_at: new Date().toISOString(),
      result: { error: failure_reason },
    };
  }
}

// ── Individual execute functions ──────────────────────────────────────────────

async function executeReorder(action: MockAction): Promise<Record<string, unknown>> {
  const { supplier, supplier_phone, qty, cost } = action.payload as {
    supplier: string;
    supplier_phone: string;
    qty: number;
    cost: number;
  };
  // Stage 0: mock — log only. Stage 2+: WhatsApp Business API call.
  console.log(
    `[EXECUTE reorder] Would send WhatsApp to ${supplier} (${supplier_phone}): order ${qty} units for ₹${cost}`
  );
  return { sent_to: supplier, phone: supplier_phone, qty, cost, channel: "mock" };
}

async function executeMarkdown(action: MockAction): Promise<Record<string, unknown>> {
  const { new_price, sku, qty } = action.payload as {
    new_price: number;
    sku: string;
    qty: number;
  };
  // Stage 0: mock — log only. Stage 2+: POS/price update API call.
  console.log(
    `[EXECUTE markdown] Would update shelf price for ${sku} to ₹${new_price} (${qty} units)`
  );
  return { sku, new_price, qty, channel: "mock" };
}

async function executeWriteoff(action: MockAction): Promise<Record<string, unknown>> {
  const { sku, qty, value } = action.payload as {
    sku: string;
    qty: number;
    value: number;
  };
  // Stage 0: mock — deduct from in-memory stock.
  if (mockStockLevels[sku] !== undefined) {
    mockStockLevels[sku] = Math.max(0, mockStockLevels[sku] - qty);
  }
  console.log(`[EXECUTE writeoff] Posted write-off: ${qty} units of ${sku}, value ₹${value}`);
  return { sku, qty, value, ledger_entry: "mock" };
}

async function executeRestockTask(action: MockAction): Promise<Record<string, unknown>> {
  const { sku, qty, assignee } = action.payload as {
    sku: string;
    qty: number;
    assignee: string;
  };
  // Stage 0: mock — log only. Stage 2+: push notification to staff.
  console.log(`[EXECUTE restock_task] Would notify ${assignee}: bring ${qty} units of ${sku} to shelf`);
  return { sku, qty, assignee, notification: "mock" };
}

async function executeReorderPointAdjustment(action: MockAction): Promise<Record<string, unknown>> {
  const { sku, new_reorder_point } = action.payload as {
    sku: string;
    new_reorder_point: number;
  };
  // Stage 0: mock — log only. Stage 1+: UPDATE products SET reorder_point.
  console.log(`[EXECUTE reorder_point_adjustment] Would set reorder_point for ${sku} to ${new_reorder_point}`);
  return { sku, new_reorder_point, updated: "mock" };
}

async function executeSupplierMessage(action: MockAction): Promise<Record<string, unknown>> {
  const { supplier, supplier_phone, message_text } = action.payload as {
    supplier: string;
    supplier_phone: string;
    message_text: string;
  };
  // Stage 0: mock — log only. Stage 2+: WhatsApp Business API call.
  console.log(`[EXECUTE supplier_message] Would send to ${supplier}: "${message_text}"`);
  return { sent_to: supplier, phone: supplier_phone, message_text, channel: "mock" };
}

async function executeDayClose(action: MockAction): Promise<Record<string, unknown>> {
  const { cash_amount, digital_amount, discrepancy } = action.payload as {
    cash_amount: number;
    digital_amount: number;
    discrepancy: number;
  };
  // Stage 0: mock — log only. Stage 2+: write ledger close record.
  console.log(
    `[EXECUTE day_close] Day closed — cash: ₹${cash_amount}, digital: ₹${digital_amount}, discrepancy: ₹${discrepancy}`
  );
  return { cash_amount, digital_amount, discrepancy, ledger: "mock" };
}
