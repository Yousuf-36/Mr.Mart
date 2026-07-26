# Mr. Mart — Database Schema
**Postgres (RDS or Neon.tech). Full field list, relationships, and indexing notes.**

This expands the minimum-viable model in `02_MCP_Server_Spec.md` Section 4 into the actual tables to generate migrations for.

---

## Entity Relationship Overview

```
stores ──< staff
   │
   ├──< products ──< stock_ledger
   │        │  ├──< expiry_batches
   │        │  └──< sales_txn
   │        │
   │        └──< shelf_flags
   │
   ├──< suppliers ──< products (supplier_id FK)
   │
   ├──< actions (references products, staff, suppliers via nullable FKs)
   │
   └──< settings (one row of config per store)
```

Single-store v1 can treat `stores` as a single implicit row, but including the table now avoids a painful migration when multi-store (Phase 2) arrives.

---

## Tables

### `stores`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| phone | text | owner's WhatsApp number, used for notifications |
| language | text | for the few unavoidable text labels |
| timezone | text | for day-close scheduling |
| created_at | timestamptz | |

### `staff`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| store_id | uuid FK → stores | |
| name | text | |
| phone | text | |
| role | text | `owner` \| `staff` — staff can action Shelf Restock Tasks only, never financial automations |
| active | boolean | for on-duty roster logic (Section 4, Shelf Restock assignee) |
| created_at | timestamptz | |

### `suppliers`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| store_id | uuid FK → stores | |
| name | text | |
| phone | text | WhatsApp number for Auto-Reorder / Supplier Follow-up |
| lead_time_days | int | default 2, used in reorder-point formula |
| created_at | timestamptz | |

### `products`
| Column | Type | Notes |
|---|---|---|
| sku | text PK | |
| store_id | uuid FK → stores | |
| supplier_id | uuid FK → suppliers, nullable | |
| name | text | |
| photo_url | text, nullable | falls back to category placeholder icon if null |
| category | text | |
| unit | text | e.g. "packet", "bag" |
| unit_cost | numeric | for markdown floor and reorder cost calcs |
| price | numeric | current shelf price |
| reorder_point | numeric | recomputed nightly, see `03_Automation_Rules_and_Business_Logic.md` §1 |
| max_order_qty | numeric | storage-capacity cap |
| shelf_capacity | numeric | facings × units-per-facing, for Shelf Restock Task |
| shelf_life_days | int | |
| active | boolean | soft-delete flag |
| created_at, updated_at | timestamptz | |

**Index:** `(store_id, category)`, `(store_id, active)`.

### `stock_ledger`
Append-only. Current stock = `SUM(delta_qty)` per SKU.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sku | text FK → products | |
| delta_qty | numeric | positive = stock in, negative = stock out |
| reason | text | `sale` \| `delivery_received` \| `manual_correction` \| `expiry_writeoff` \| `shrinkage` |
| ref_action_id | uuid FK → actions, nullable | links back to the automation that caused this movement, if any |
| created_at | timestamptz | |

**Index:** `(sku, created_at)` — the hot path for computing current stock fast; consider a materialized `current_stock` view or cached column refreshed on write if this table grows large.

### `sales_txn`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sku | text FK → products | |
| qty | numeric | |
| amount | numeric | |
| payment_type | text | `cash` \| `digital` |
| created_at | timestamptz | |

**Index:** `(sku, created_at)`, `(created_at)` for daily/weekly summaries.

### `expiry_batches`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sku | text FK → products | |
| batch_qty | numeric | remaining quantity in this batch |
| expiry_date | date | |
| received_at | timestamptz | |

**Index:** `(sku, expiry_date)`.

### `shelf_flags`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sku | text FK → products | |
| location | text | aisle/shelf label |
| flagged_at | timestamptz | |
| cleared_at | timestamptz, nullable | set once Shelf Restock Task executes |
| source | text | `camera` \| `manual` |

### `actions`
The automation/approval audit trail — the single most important table in the schema.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | this is the `action_id` referenced throughout the MCP spec |
| store_id | uuid FK → stores | |
| type | text | `reorder` \| `markdown` \| `writeoff` \| `restock_task` \| `reorder_point_adjustment` \| `supplier_message` \| `day_close` |
| sku | text FK → products, nullable | null for `day_close` |
| payload | jsonb | type-specific fields, see `03_Automation_Rules_and_Business_Logic.md` for what each type computes |
| status | text | `pending` \| `approved` \| `rejected` \| `executed` \| `failed` |
| escalated | boolean | flips true once the automation's escalation window passes unactioned |
| decided_by | uuid FK → staff, nullable | who tapped Approve/Reject |
| reject_reason | text, nullable | |
| created_at | timestamptz | |
| decided_at | timestamptz, nullable | |
| executed_at | timestamptz, nullable | |
| failure_reason | text, nullable | set on `failed`, drives the retry/error state on the card |

**Index:** `(store_id, status, escalated)` — the exact query the Approval Queue screen runs on every load. `(sku, type, status)` — enforces the "no duplicate pending action per SKU+type" guardrail.

**This table is append/update-only — no deletes.** It is the audit trail referenced throughout the Project Instructions doc.

### `settings`
One row per store; every threshold from `03_Automation_Rules_and_Business_Logic.md` lives here so it's configurable without a redeploy.
| Column | Type | Default |
|---|---|---|
| store_id | uuid PK/FK → stores | |
| safety_factor | numeric | 1.3 |
| review_period_days | int | 1 |
| large_order_value_threshold | numeric | 5000 |
| markdown_threshold_days | int | 3 |
| markdown_curve | jsonb | `{"3":0.10,"2":0.25,"1":0.40,"0":0.50}` |
| min_margin_pct | numeric | 0.02 |
| slowmover_drop_pct | numeric | 0.40 |
| slowmover_window_days | int | 7 |
| discrepancy_threshold | numeric | 200 |
| day_close_time | time | 21:00 |
| reorder_escalation_hours | int | 48 |
| markdown_escalation | text | `same_day` |
| restock_escalation_hours | int | 2 |
| supplier_followup_escalation_hours | int | 24 |

---

## Implementation Notes

- Generate this as versioned migrations (one file per table), not a single monolithic schema file — makes the "add the remaining automations" workflow from the MCP spec doc easier to track over time.
- `actions.payload` is intentionally jsonb rather than one column per possible field across all 7 types — keeps the table narrow and matches the MCP spec's per-type payload shapes exactly (copy those shapes as the jsonb contract, ideally validated with a Zod schema shared between Worker and Backend).
- Every FK from `actions` back to `products`/`staff`/`suppliers` should be `ON DELETE SET NULL`, not cascade — an audit row must never disappear because a product was deactivated.