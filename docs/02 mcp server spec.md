# Mr. Mart MCP Server — Specification

Purpose: a single MCP server that exposes the store's data (inventory, sales, expiry) **and** the automation/approval workflow as tools an LLM agent can call. The agent has two jobs: (1) turn raw numbers into visual states (color/icon/size), and (2) run the automation loop — **draft an action → hold it pending → execute it only after the owner approves**. This is the data/action contract between backend, the AI layer, and frontend prompts.

**Transport:** Streamable HTTP (remote), stateless JSON. TypeScript SDK.
**Naming convention:** `mrmart_<verb>_<noun>`, action-oriented. Four tool categories: read (monitoring), draft (background automation), decide (owner-facing approve/reject), execute (system-only, fires after approval).

**The golden rule: no tool that changes real-world state (sends an order, updates a price, posts a write-off) may run without a corresponding `approved` action record.** Draft tools only ever write to the `actions` table in `pending` status — they never touch inventory, price, or supplier systems directly.

**Deployment topology (see `01_Project_Instructions.md` Section 8 for the full diagram):** read and decide tools run in the **Backend** service and must stay fast — decide tools only ever flip a status and enqueue a job, they never do the slow external I/O themselves. Draft and execute tools run in the **Worker** service, invoked off a Redis queue rather than over the MCP HTTP transport (nothing owner-facing calls them directly, so they don't need to be network-exposed tools at all — plain internal functions the Worker calls are enough; keeping them as MCP tools mainly helps an LLM agent reason about and compose them during drafting).

---

## 1. Tool List

### Read tools (monitoring — power the cockpit's read-only screens)

| Tool | Description | Key inputs | Key outputs |
|---|---|---|---|
| `mrmart_get_stock_levels` | Current stock per SKU with urgency banding | `category?`, `limit?` | `[{sku, name, photo_url, qty, unit, status: green/yellow/red}]` |
| `mrmart_get_sales_summary` | Today/period sales totals | `period` (today/week) | `{total_amount, cash_amount, digital_amount, txn_count}` |
| `mrmart_get_top_sellers` | Best/worst performing SKUs | `period`, `direction` (top/bottom), `limit?` | `[{sku, name, photo_url, units_sold, trend: up/down}]` |
| `mrmart_get_today_activity` | Everything approved/executed/rejected today | `limit?` | `[{action_id, type, status, decided_at}]` |

### Draft tools (background automation — never owner-facing, called by the scheduler)

Each corresponds to one automation in `01_Project_Instructions.md` Section 5. Every draft tool **creates a pending action** and returns its `action_id` — it does not change any real inventory/price/order state.

| Tool | Trigger it runs on | Key inputs | Creates pending action with |
|---|---|---|---|
| `mrmart_draft_reorder` | Stock crosses reorder point | `sku` | `{type: "reorder", sku, supplier, qty, cost}` |
| `mrmart_draft_expiry_markdown` | Batch enters expiry window | `sku, batch_id` | `{type: "markdown", sku, discount_pct, new_price, qty}` |
| `mrmart_draft_expiry_writeoff` | Batch passes expiry unsold | `sku, batch_id` | `{type: "writeoff", sku, qty, value}` |
| `mrmart_draft_shelf_restock_task` | Shelf flagged empty, backroom has stock | `sku, location` | `{type: "restock_task", sku, qty, assignee}` |
| `mrmart_draft_slowmover_adjustment` | Sales trend drops sharply over N days | `sku` | `{type: "reorder_point_adjustment", sku, new_reorder_point}` |
| `mrmart_draft_supplier_followup` | Delivery missed cutoff | `sku, supplier` | `{type: "supplier_message", supplier, message_text}` |
| `mrmart_draft_day_close` | End of business day | `date` | `{type: "day_close", cash_amount, digital_amount, discrepancy}` |

### Decide tools (owner-facing — the only tools the app UI calls directly)

| Tool | Description | Key inputs | Key outputs |
|---|---|---|---|
| `mrmart_list_pending_actions` | Every pending Approval Card, most urgent first | `limit?` | `[{action_id, type, photo_url, summary_fields, created_at, escalated}]` |
| `mrmart_get_action_detail` | Full detail behind one card, if the owner opens it | `action_id` | full drafted payload |
| `mrmart_approve_action` | Owner taps Approve | `action_id` | marks `approved`, triggers the matching execute tool, returns final status |
| `mrmart_reject_action` | Owner taps Reject | `action_id, reason?` | marks `rejected`, archives, no state change |

### Execute tools (system-only — fired internally by `mrmart_approve_action`, never called directly by the UI)

| Tool | Fires on approval of | What it actually does |
|---|---|---|
| `mrmart_execute_reorder` | `reorder` | Sends the order to the supplier (WhatsApp/email/API) |
| `mrmart_execute_markdown` | `markdown` | Updates POS/shelf price |
| `mrmart_execute_writeoff` | `writeoff` | Posts the write-off to the ledger |
| `mrmart_execute_restock_task` | `restock_task` | Notifies/assigns staff |
| `mrmart_execute_reorder_point_adjustment` | `reorder_point_adjustment` | Updates the product's reorder point |
| `mrmart_execute_supplier_message` | `supplier_message` | Sends the message |
| `mrmart_execute_day_close` | `day_close` | Closes the ledger for the day |

Every execute tool writes an `executed_at` timestamp on the action row and returns the updated object, so the UI can move the card from "executing" to "done" without a second read call.

---

## 2. Design Notes for the Agent Layer

- The MCP server returns **raw structured data only** (numbers, statuses, URLs) — it never returns natural-language sentences. Sentence generation, if ever needed, happens in a thin prompt layer on top, and the README in Section 5 assumes it's largely unnecessary since the UI is visual-first.
- `status`/`severity`/`urgency` fields are pre-computed **server-side** (not left to the LLM to infer) so the color-coding logic is deterministic, testable, and consistent — the LLM's job is orchestration (which tools to call, in what order), not deciding what counts as "red."
- **Draft tools compute the full decision server-side too** (quantity, discount %, message text) — the LLM calls them with just an identifying `sku`/trigger, it does not invent the numbers itself. This keeps every drafted action explainable and reproducible, which matters once real money/orders are involved.
- **`mrmart_approve_action` is the only tool allowed to call an execute tool.** No other code path — including the LLM directly calling `mrmart_execute_reorder` — should ever fire an execute tool. Enforce this in the server, not just by convention, so a prompt-injection or model mistake can't skip the human approval step.
- All photo-bearing responses include a `photo_url`; if no product photo exists yet, return a `placeholder_category_icon` key instead so the frontend always has something to render.
- Pagination: `limit`/`cursor` params on every list tool; default `limit` is small (10-15) since these feed a mobile card list, not a data table.

---

## 3. Example Tool Definitions (TypeScript / Zod) — the draft → approve → execute chain

```ts
// DRAFT — background scheduler calls this when stock crosses the reorder point.
// Computes everything server-side; only ever writes a pending action.
server.registerTool(
  "mrmart_draft_reorder",
  {
    title: "Draft a reorder",
    description:
      "Computes a complete reorder (supplier, quantity, cost) for a low-stock SKU and saves it as a pending action. Does not place the order.",
    inputSchema: { sku: z.string() },
    outputSchema: {
      action_id: z.string(),
      status: z.literal("pending"),
      payload: z.object({
        sku: z.string(), supplier: z.string(), qty: z.number(), cost: z.number(),
      }),
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ sku }) => {
    const payload = await computeReorderPayload(sku); // pure server-side logic
    const action = await createPendingAction("reorder", payload);
    return { content: [{ type: "text", text: JSON.stringify(action) }], structuredContent: action };
  }
);

// DECIDE — the only tool the owner-facing app calls to act on a card.
// This is the single choke point that's allowed to trigger execution.
server.registerTool(
  "mrmart_approve_action",
  {
    title: "Approve a pending action",
    description: "Owner approved the Approval Card. Marks it approved and runs its execute tool.",
    inputSchema: { action_id: z.string() },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ action_id }) => {
    const action = await markApproved(action_id);
    const result = await executeByType(action); // internal dispatch — see Section 1, Execute tools
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  }
);
```

---

## 4. Data Model (minimum viable)

```
products      (sku PK, name, photo_url, category, unit, reorder_point, shelf_life_days, price)
stock_ledger  (id PK, sku FK, delta_qty, reason, created_at)
sales_txn     (id PK, sku FK, qty, amount, payment_type, created_at)
expiry_batches(id PK, sku FK, batch_qty, expiry_date)
shelf_flags   (id PK, sku FK, location, flagged_at, cleared_at)

actions       (id PK, type, sku FK nullable, payload JSONB, status, escalated,
               created_at, decided_at, executed_at, reject_reason)
```

- `actions.status` is one of `pending | approved | rejected | executed | failed`.
- `actions.payload` holds the type-specific fields from the draft-tool table in Section 1 (e.g. `{supplier, qty, cost}` for a reorder) — this is exactly what the Approval Card renders and exactly what the matching execute tool consumes, so there's one source of truth for "what was decided."
- Current stock = sum of `stock_ledger.delta_qty` per SKU. Status bands (green/yellow/red) are computed against `reorder_point` and `expiry_batches` server-side per the note in Section 2.
- The `actions` table **is** the audit trail called for in the Project Instructions doc — every trigger-to-execution chain is reconstructable from one table.

---

## 5. What's in the accompanying code scaffold

A minimal working TypeScript MCP server (`mcp-server/`) with:
- Read tools wired to **mock in-memory data** (swap for the Postgres queries once the schema in Section 4 is live)
- One full draft → decide → execute chain implemented end-to-end (`mrmart_draft_reorder` → `mrmart_approve_action` / `mrmart_reject_action` → `mrmart_execute_reorder`) as the reference pattern for the other six automations
- Zod schemas for every input/output
- A `README.md` with run instructions and next steps for adding the remaining automations

**Note on the scaffold vs. the production topology in Section 1:** for simplicity, this scaffold runs everything — read, decide, draft, execute — in one process with no queue, so it's easy to run locally and inspect. Before this goes to production per the Backend/Worker split in `01_Project_Instructions.md` Section 8, `mrmart_approve_action` should be changed to enqueue an `execute_reorder` job to Redis rather than calling `executeReorder()` inline, and a separate Worker process should consume that queue. Implement that split once the single-process version is verified end-to-end.

Use it as the seed project — add the remaining draft/execute tool pairs following the exact same pattern, and replace the mock data layer with real DB calls once the backend exists, keeping every tool signature unchanged so frontend prompts built against this contract don't need to change.