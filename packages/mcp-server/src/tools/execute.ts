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
import { posAdapter } from "../adapters/pos-adapter.js";
import { supplierAdapter } from "../adapters/supplier-adapter.js";
import { notificationAdapter } from "../adapters/notification-adapter.js";

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
      case "queue_alert":
        result = await executeQueueAlert(action);
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
  const { sku, supplier, supplier_phone, qty, cost, unit_cost, expected_delivery_date } = action.payload as {
    sku?: string;
    supplier: string;
    supplier_phone: string;
    qty: number;
    cost: number;
    unit_cost?: number;
    expected_delivery_date?: string;
  };

  const targetSku = sku || (action.sku ?? "UNKNOWN-SKU");
  const unitCost = unit_cost || (qty > 0 ? cost / qty : cost);

  // 1. Dispatch Purchase Order to Supplier Gateway
  const poPayload = await supplierAdapter.dispatchPurchaseOrder({
    store_id: action.store_id,
    sku: targetSku,
    supplier,
    supplier_phone,
    qty,
    unit_cost: unitCost,
    cost,
    expected_delivery_date,
  });

  // 2. Sync incoming stock balance change with POS/ERP
  const posSync = await posAdapter.syncStockAdjustment(targetSku, qty, "purchase_order_incoming", action.store_id);

  return {
    po_payload: poPayload,
    pos_sync: posSync,
    channel: "supplier_adapter_http",
  };
}

async function executeMarkdown(action: DbAction): Promise<Record<string, unknown>> {
  const { new_price, sku, qty, product_name } = action.payload as {
    new_price: number;
    sku?: string;
    qty: number;
    product_name?: string;
  };
  const targetSku = sku || action.sku || "UNKNOWN-SKU";

  // 1. Dispatch electronic shelf price update to POS & Shelf Tags
  const priceUpdate = await posAdapter.updateShelfPrice(targetSku, new_price, action.store_id);

  // 2. Dispatch Action Alert Webhook
  const alert = await notificationAdapter.sendActionAlert({
    store_id: action.store_id,
    action_id: action.id,
    type: "markdown",
    title: `Markdown Applied: ${product_name || targetSku}`,
    body: `Price updated to ₹${new_price} for ${qty} units`,
    payload: action.payload,
  });

  return {
    shelf_price_update: priceUpdate,
    alert_dispatch: alert,
    channel: "pos_adapter_hardware",
  };
}

async function executeWriteoff(action: DbAction): Promise<Record<string, unknown>> {
  const payload = action.payload as {
    sku?: string;
    qty: number;
    value: number;
  };
  const targetSku = payload.sku || action.sku;
  if (!targetSku) {
    throw new Error(`Missing SKU for writeoff action: ${action.id}`);
  }
  const qty = payload.qty;
  const value = payload.value;

  // 1. Post negative ledger entry in Postgres
  await postWriteoffLedgerEntry(targetSku, qty, action.id, action.store_id);

  // 2. Sync negative inventory balance adjustment with POS/ERP
  const posSync = await posAdapter.syncStockAdjustment(targetSku, -qty, "spoilage_writeoff", action.store_id);

  return {
    sku: targetSku,
    qty,
    value,
    ledger_entry: "posted",
    pos_sync: posSync,
  };
}

async function executeRestockTask(action: DbAction): Promise<Record<string, unknown>> {
  const { sku, qty, assignee, location } = action.payload as {
    sku?: string;
    qty: number;
    assignee?: string;
    location?: string;
  };
  const targetSku = sku || action.sku || "UNKNOWN-SKU";

  // Dispatch staff push notification
  const notification = await notificationAdapter.sendStaffNotification(
    assignee || "On-duty Staff",
    targetSku,
    qty,
    location || "Sales Floor Shelf",
    action.store_id
  );

  return {
    sku,
    qty,
    assignee,
    staff_notification: notification,
  };
}

async function executeReorderPointAdjustment(action: DbAction): Promise<Record<string, unknown>> {
  const { sku, new_reorder_point } = action.payload as {
    sku: string;
    new_reorder_point: number;
  };
  console.log(`[EXECUTE reorder_point_adjustment] Setting reorder_point for ${sku} to ${new_reorder_point}`);
  return { sku, new_reorder_point, updated: true };
}

async function executeSupplierMessage(action: DbAction): Promise<Record<string, unknown>> {
  const { supplier, supplier_phone, message_text } = action.payload as {
    supplier: string;
    supplier_phone: string;
    message_text: string;
  };

  // Dispatch message via Supplier Adapter
  const messageDispatch = await supplierAdapter.dispatchSupplierFollowup(
    supplier,
    supplier_phone,
    message_text,
    action.store_id
  );

  return {
    sent_to: supplier,
    phone: supplier_phone,
    message_text,
    message_dispatch: messageDispatch,
  };
}

async function executeDayClose(action: DbAction): Promise<Record<string, unknown>> {
  const { cash_amount, digital_amount, discrepancy } = action.payload as {
    cash_amount: number;
    digital_amount: number;
    discrepancy: number;
  };

  // Dispatch day-close summary notification
  const alert = await notificationAdapter.sendActionAlert({
    store_id: action.store_id,
    action_id: action.id,
    type: "day_close",
    title: "Day-Close Reconciliation Finalized",
    body: `Cash: ₹${cash_amount}, Digital: ₹${digital_amount}, Discrepancy: ₹${discrepancy}`,
    payload: action.payload,
  });

  return {
    cash_amount,
    digital_amount,
    discrepancy,
    alert_dispatch: alert,
  };
}

async function executeQueueAlert(action: DbAction): Promise<Record<string, unknown>> {
  const { active_lanes, people_in_queue, ratio } = action.payload as {
    active_lanes: number;
    people_in_queue: number;
    ratio: number;
  };
  const notification = await notificationAdapter.sendStaffNotification(
    "Front-End Staff",
    "CHECKOUT-LANE",
    1,
    `Open Lane ${active_lanes + 1} (${people_in_queue} waiting)`,
    action.store_id
  );
  return {
    active_lanes,
    people_in_queue,
    ratio,
    lane_opened: active_lanes + 1,
    staff_notification: notification,
  };
}
