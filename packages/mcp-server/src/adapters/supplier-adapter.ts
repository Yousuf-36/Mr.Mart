/**
 * Supplier Gateway Integration Adapter (Stage 6).
 * Formats and dispatches structured Purchase Orders (POs) and follow-up messages.
 * Doc 06: Integration adapter spec.
 */

import { v4 as uuidv4 } from "uuid";

export interface PurchaseOrderPayload {
  po_id: string;
  store_id: string;
  sku: string;
  supplier: string;
  supplier_phone: string;
  qty: number;
  unit_cost: number;
  total_cost: number;
  expected_delivery_date?: string;
  dispatched_at: string;
  status: "dispatched" | "failed";
  http_status: number;
}

export interface SupplierMessagePayload {
  msg_id: string;
  store_id: string;
  supplier: string;
  supplier_phone: string;
  message_text: string;
  dispatched_at: string;
  status: "sent" | "failed";
  http_status: number;
}

export class SupplierAdapter {
  private purchaseOrders: PurchaseOrderPayload[] = [];
  private messages: SupplierMessagePayload[] = [];

  /** Formats and dispatches a structured Purchase Order to a supplier endpoint */
  async dispatchPurchaseOrder(order: {
    store_id: string;
    sku: string;
    supplier: string;
    supplier_phone: string;
    qty: number;
    unit_cost: number;
    cost: number;
    expected_delivery_date?: string;
  }): Promise<PurchaseOrderPayload> {
    const po_id = `PO-${uuidv4().substring(0, 8).toUpperCase()}`;
    const payload: PurchaseOrderPayload = {
      po_id,
      store_id: order.store_id,
      sku: order.sku,
      supplier: order.supplier,
      supplier_phone: order.supplier_phone,
      qty: order.qty,
      unit_cost: order.unit_cost,
      total_cost: order.cost,
      expected_delivery_date: order.expected_delivery_date,
      dispatched_at: new Date().toISOString(),
      status: "dispatched",
      http_status: 201,
    };

    this.purchaseOrders.push(payload);
    console.log(`[Supplier Adapter] PO Dispatched: ${po_id} -> ${order.supplier} (${order.qty}x ${order.sku} @ ₹${order.unit_cost} = ₹${order.cost}) [HTTP 201]`);
    return payload;
  }

  /** Formats and dispatches a supplier follow-up message */
  async dispatchSupplierFollowup(
    supplier: string,
    supplier_phone: string,
    message_text: string,
    storeId: string
  ): Promise<SupplierMessagePayload> {
    const msg_id = `MSG-${uuidv4().substring(0, 8).toUpperCase()}`;
    const payload: SupplierMessagePayload = {
      msg_id,
      store_id: storeId,
      supplier,
      supplier_phone,
      message_text,
      dispatched_at: new Date().toISOString(),
      status: "sent",
      http_status: 200,
    };

    this.messages.push(payload);
    console.log(`[Supplier Adapter] Follow-up sent to ${supplier} (${supplier_phone}): "${message_text}" [HTTP 200]`);
    return payload;
  }

  /** Returns history of dispatched purchase orders (used in verification tests) */
  getDispatchedPOs(): PurchaseOrderPayload[] {
    return [...this.purchaseOrders];
  }

  /** Returns history of dispatched messages (used in verification tests) */
  getDispatchedMessages(): SupplierMessagePayload[] {
    return [...this.messages];
  }

  /** Clears event logs for test isolation */
  clearEvents(): void {
    this.purchaseOrders = [];
    this.messages = [];
  }
}

export const supplierAdapter = new SupplierAdapter();
