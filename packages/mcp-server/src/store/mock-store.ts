/**
 * Mock in-memory data store for Stage 0.
 * All tools use this until Stage 1 replaces it with real Postgres queries.
 * Shape matches the DB schema in docs/04 exactly.
 */

import { v4 as uuidv4 } from "uuid";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StockStatus = "green" | "yellow" | "red";
export type PaymentType = "cash" | "digital";
export type TrendDirection = "up" | "down" | "flat";
export type ActionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";
export type ActionType =
  | "reorder"
  | "markdown"
  | "writeoff"
  | "restock_task"
  | "reorder_point_adjustment"
  | "supplier_message"
  | "day_close";

export interface MockProduct {
  sku: string;
  store_id: string;
  supplier_id: string | null;
  name: string;
  photo_url: string | null;
  placeholder_category_icon: string;
  category: string;
  unit: string;
  unit_cost: number;
  price: number;
  reorder_point: number;
  max_order_qty: number;
  shelf_capacity: number;
  shelf_life_days: number;
  active: boolean;
}

export interface MockStockLevel {
  sku: string;
  qty: number;
}

export interface MockSalesTxn {
  id: string;
  sku: string;
  qty: number;
  amount: number;
  payment_type: PaymentType;
  created_at: Date;
}

export interface MockExpiryBatch {
  id: string;
  sku: string;
  batch_qty: number;
  expiry_date: Date;
  received_at: Date;
}

export interface MockShelfFlag {
  id: string;
  sku: string;
  location: string;
  flagged_at: Date;
  cleared_at: Date | null;
  source: "camera" | "manual";
}

export interface MockAction {
  id: string;
  store_id: string;
  type: ActionType;
  sku: string | null;
  payload: Record<string, unknown>;
  status: ActionStatus;
  escalated: boolean;
  decided_by: string | null;
  reject_reason: string | null;
  failure_reason: string | null;
  created_at: Date;
  decided_at: Date | null;
  executed_at: Date | null;
}

export interface MockSupplier {
  id: string;
  store_id: string;
  name: string;
  phone: string;
  lead_time_days: number;
}

// ─── Seed Data ────────────────────────────────────────────────────────────────

const STORE_ID = "store-001-mock";
const SUPPLIER_FRESH_ID = "sup-fresh-001";
const SUPPLIER_STAPLES_ID = "sup-staples-001";

export const mockSuppliers: MockSupplier[] = [
  {
    id: SUPPLIER_FRESH_ID,
    store_id: STORE_ID,
    name: "Fresh Direct Traders",
    phone: "+919876543210",
    lead_time_days: 1,
  },
  {
    id: SUPPLIER_STAPLES_ID,
    store_id: STORE_ID,
    name: "Metro Staples Wholesale",
    phone: "+919876500001",
    lead_time_days: 2,
  },
];

export const mockProducts: MockProduct[] = [
  {
    sku: "RICE-5KG",
    store_id: STORE_ID,
    supplier_id: SUPPLIER_STAPLES_ID,
    name: "Basmati Rice 5kg",
    photo_url: null,
    placeholder_category_icon: "🌾",
    category: "Grains",
    unit: "bag",
    unit_cost: 320,
    price: 399,
    reorder_point: 20,
    max_order_qty: 100,
    shelf_capacity: 30,
    shelf_life_days: 365,
    active: true,
  },
  {
    sku: "MILK-1L",
    store_id: STORE_ID,
    supplier_id: SUPPLIER_FRESH_ID,
    name: "Full Cream Milk 1L",
    photo_url: null,
    placeholder_category_icon: "🥛",
    category: "Dairy",
    unit: "packet",
    unit_cost: 58,
    price: 72,
    reorder_point: 30,
    max_order_qty: 120,
    shelf_capacity: 50,
    shelf_life_days: 7,
    active: true,
  },
  {
    sku: "BREAD-WW",
    store_id: STORE_ID,
    supplier_id: SUPPLIER_FRESH_ID,
    name: "Whole Wheat Bread",
    photo_url: null,
    placeholder_category_icon: "🍞",
    category: "Bakery",
    unit: "loaf",
    unit_cost: 35,
    price: 48,
    reorder_point: 15,
    max_order_qty: 60,
    shelf_capacity: 25,
    shelf_life_days: 5,
    active: true,
  },
  {
    sku: "OIL-1L",
    store_id: STORE_ID,
    supplier_id: SUPPLIER_STAPLES_ID,
    name: "Sunflower Oil 1L",
    photo_url: null,
    placeholder_category_icon: "🫙",
    category: "Oils",
    unit: "bottle",
    unit_cost: 130,
    price: 155,
    reorder_point: 25,
    max_order_qty: 80,
    shelf_capacity: 40,
    shelf_life_days: 365,
    active: true,
  },
  {
    sku: "EGGS-12",
    store_id: STORE_ID,
    supplier_id: SUPPLIER_FRESH_ID,
    name: "Eggs (Tray of 12)",
    photo_url: null,
    placeholder_category_icon: "🥚",
    category: "Dairy",
    unit: "tray",
    unit_cost: 78,
    price: 95,
    reorder_point: 20,
    max_order_qty: 100,
    shelf_capacity: 30,
    shelf_life_days: 21,
    active: true,
  },
];

// Current stock levels (qty = sum of stock_ledger.delta_qty per SKU)
export const mockStockLevels: Record<string, number> = {
  "RICE-5KG": 18, // below reorder_point(20) → RED
  "MILK-1L": 32,  // above reorder_point(30), healthy → GREEN
  "BREAD-WW": 8,  // below reorder_point(15) → RED
  "OIL-1L": 27,   // between reorder_point(25) and 1.5x → YELLOW
  "EGGS-12": 22,  // above reorder_point(20) → GREEN
};

// Today's sales transactions (last 24 hours)
const today = new Date();
export const mockSalesTxns: MockSalesTxn[] = [
  { id: uuidv4(), sku: "MILK-1L", qty: 8, amount: 576, payment_type: "cash", created_at: today },
  { id: uuidv4(), sku: "BREAD-WW", qty: 5, amount: 240, payment_type: "digital", created_at: today },
  { id: uuidv4(), sku: "EGGS-12", qty: 3, amount: 285, payment_type: "cash", created_at: today },
  { id: uuidv4(), sku: "RICE-5KG", qty: 2, amount: 798, payment_type: "digital", created_at: today },
  { id: uuidv4(), sku: "OIL-1L", qty: 4, amount: 620, payment_type: "cash", created_at: today },
  { id: uuidv4(), sku: "MILK-1L", qty: 6, amount: 432, payment_type: "digital", created_at: today },
];

// Expiry batches — some are entering the warning window
const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
const oneDayFromNow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
export const mockExpiryBatches: MockExpiryBatch[] = [
  {
    id: "batch-bread-001",
    sku: "BREAD-WW",
    batch_qty: 8,
    expiry_date: threeDaysFromNow,
    received_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  },
  {
    id: "batch-milk-001",
    sku: "MILK-1L",
    batch_qty: 12,
    expiry_date: oneDayFromNow,
    received_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
  },
];

// In-memory actions store (the audit trail)
export const mockActions: MockAction[] = [
  // One pre-seeded pending reorder for RICE-5KG — demonstrates the Approval Card
  {
    id: "action-reorder-rice-001",
    store_id: STORE_ID,
    type: "reorder",
    sku: "RICE-5KG",
    payload: {
      supplier: "Metro Staples Wholesale",
      supplier_phone: "+919876500001",
      qty: 50,
      cost: 16000,
      unit_cost: 320,
      unit: "bag",
    },
    status: "pending",
    escalated: false,
    decided_by: null,
    reject_reason: null,
    failure_reason: null,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    decided_at: null,
    executed_at: null,
  },
  // One pending markdown for BREAD-WW (expiring in 3 days)
  {
    id: "action-markdown-bread-001",
    store_id: STORE_ID,
    type: "markdown",
    sku: "BREAD-WW",
    payload: {
      discount_pct: 0.10,
      new_price: 43.20,
      original_price: 48,
      qty: 8,
      batch_id: "batch-bread-001",
      expiry_date: threeDaysFromNow.toISOString(),
    },
    status: "pending",
    escalated: false,
    decided_by: null,
    reject_reason: null,
    failure_reason: null,
    created_at: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
    decided_at: null,
    executed_at: null,
  },
];

// ─── Helper Utilities ─────────────────────────────────────────────────────────

/**
 * Compute stock urgency band per doc 02 §2.
 * green: qty >= reorder_point * 1.5
 * yellow: reorder_point <= qty < reorder_point * 1.5
 * red: qty < reorder_point
 */
export function computeStockStatus(
  qty: number,
  reorderPoint: number
): StockStatus {
  if (qty < reorderPoint) return "red";
  if (qty < reorderPoint * 1.5) return "yellow";
  return "green";
}

/** Find a product by SKU */
export function getProduct(sku: string): MockProduct | undefined {
  return mockProducts.find((p) => p.sku === sku && p.active);
}

/** Find a supplier by id */
export function getSupplier(id: string): MockSupplier | undefined {
  return mockSuppliers.find((s) => s.id === id);
}

/** Create a new pending action and push to the in-memory store */
export function createPendingAction(
  type: ActionType,
  sku: string | null,
  payload: Record<string, unknown>
): MockAction {
  const action: MockAction = {
    id: uuidv4(),
    store_id: STORE_ID,
    type,
    sku,
    payload,
    status: "pending",
    escalated: false,
    decided_by: null,
    reject_reason: null,
    failure_reason: null,
    created_at: new Date(),
    decided_at: null,
    executed_at: null,
  };
  mockActions.push(action);
  return action;
}

/** Get an action by ID */
export function getAction(actionId: string): MockAction | undefined {
  return mockActions.find((a) => a.id === actionId);
}

/** Update an action in place */
export function updateAction(
  actionId: string,
  updates: Partial<MockAction>
): MockAction | null {
  const action = getAction(actionId);
  if (!action) return null;
  Object.assign(action, updates);
  return action;
}
