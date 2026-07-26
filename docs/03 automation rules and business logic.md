# Mr. Mart — Automation Rules & Business Logic
**The exact formulas behind every draft. This is what the Worker actually computes.**

Every automation in `01_Project_Instructions.md` Section 5 is defined here as: trigger condition → formula → guardrails → escalation window. Nothing here is "the AI decides" in a vague sense — the arithmetic is deterministic and testable; only wording (e.g. a supplier message) needs an LLM at all.

All thresholds below are **defaults** — they belong in the `settings` table (see `04_Database_Schema.md`) so they're configurable per store without a code change.

---

## 1. Auto-Reorder

**Trigger:** checked every 15 min by the Worker. Fires when `qty_on_hand <= reorder_point`.

**Reorder point (computed nightly per SKU, not per-check):**
```
reorder_point = avg_daily_sales × lead_time_days × safety_factor
```
- `avg_daily_sales`: trailing 14-day average units sold
- `lead_time_days`: days from order to delivery, per supplier (default 2 if unknown)
- `safety_factor`: default `1.3` — buffer against demand spikes

**Suggested reorder quantity:**
```
target_stock = avg_daily_sales × (lead_time_days + review_period_days)
suggested_qty = target_stock − qty_on_hand
```
- `review_period_days`: how often this automation effectively checks in, default `1`

**Guardrails:**
- Cap `suggested_qty` at `max_order_qty` (per-product, set from storage capacity) — if the formula exceeds it, draft the capped amount and flag the card "capped by storage limit" rather than silently under-ordering with no explanation.
- If `suggested_qty × unit_cost` exceeds `large_order_value_threshold` (default ₹5,000), require a **second confirmation tap** on the Approval Card rather than one tap — this is the "large-value reorder" case flagged as an open item in the Project Instructions doc.
- Never draft a second pending reorder for the same SKU while one is already `pending` or `approved`/`executing`.

**Escalation window:** 48 hours unactioned → re-surface pinned, escalated color.

---

## 2. Expiry Markdown

**Trigger:** batch's `days_left <= markdown_threshold_days` (default `3`) and `days_left > 0`.

**Discount curve (default, tune per category later):**
| Days left | Discount |
|---|---|
| 3 | 10% |
| 2 | 25% |
| 1 | 40% |
| 0 (today) | 50% |

**New price:**
```
new_price = original_price × (1 − discount_pct)
```

**Guardrails:**
- **Price floor:** `new_price` must never go below `cost × 1.02` (2% minimum margin). If the discount curve would breach the floor, cap the discount at the floor price and label the card "near-cost clearance" instead of the raw %.
- Only one active markdown per batch — a new markdown draft supersedes (cancels) any still-pending markdown draft for the same batch rather than stacking two cards.

**Escalation window:** same business day — perishables don't get a 48-hour grace period.

---

## 3. Expiry Write-off

**Trigger:** batch's `days_left <= 0` and `batch_qty > 0` still unsold (i.e. a markdown ran its course and didn't clear the stock).

**Draft:**
```
writeoff_qty = remaining batch_qty
writeoff_value = writeoff_qty × cost
```

**Guardrails:**
- Only drafts once a markdown automation (Section 2) has already had its full window to attempt clearance — a write-off should never fire before a markdown got a chance to sell the stock through.
- Write-offs post to the ledger as a negative stock adjustment with `reason: "expiry_writeoff"`, distinct from `reason: "manual_correction"`, so shrinkage reporting can separate the two later.

**Escalation window:** same day — this is a sunk loss, no benefit to delaying the decision.

---

## 4. Shelf Restock Task

**Trigger:** shelf flagged empty (camera Phase 1.5, or manual tap) **and** `backroom_qty > 0` for that SKU.

**Draft:**
```
restock_qty = min(shelf_capacity − shelf_qty_estimate, backroom_qty)
```
- `shelf_capacity`: facings × units-per-facing, set per product/aisle during onboarding
- `shelf_qty_estimate`: from CV count if available, else assumed `0` on a manual empty-flag

**Assignee logic:** default to staff currently on duty (from a simple roster); if no staff record exists, assign to the owner.

**Guardrails:** if `backroom_qty == 0`, this automation doesn't fire at all — that situation is actually a stockout and belongs to Auto-Reorder instead, not a restock task.

**Escalation window:** 2 hours — this is in-store, time-sensitive, and cheap to fix immediately.

---

## 5. Slow-Mover Flag

**Trigger:** `trailing_7d_avg_sales < 0.6 × trailing_30d_avg_sales` sustained for 7 consecutive days (a >40% sustained drop, not a single bad day).

**Draft:**
```
suggested_new_reorder_point = current_reorder_point × 0.5
```
plus a plain "pause auto-reorder for this SKU" option surfaced alongside the reduced-quantity option — two small buttons under the main Approve/Reject, not a third card.

**Guardrails:** never auto-adjusts silently — this automation only ever drafts, same as everything else; a slow week never removes a product from Auto-Reorder's radar without the owner's tap.

**Escalation window:** weekly re-surface if ignored, not urgent — low severity color (yellow, not red).

---

## 6. Supplier Follow-up

**Trigger:** `expected_delivery_date` has passed and the linked reorder action's status is still `executed` (order sent) rather than `received`.

**Draft:** a templated message — order reference, what was ordered, expected date, a polite ask for an update. Wording is the one place an LLM adds value (natural phrasing); the facts it's given (order ref, date, items) come from the `actions` table, not invented.

**Guardrails:** one follow-up per missed delivery — doesn't re-draft daily; the escalation window handles re-surfacing instead of spamming the supplier.

**Escalation window:** 24 hours after the drafted message goes unapproved, re-surface once, escalated color.

---

## 7. Day-Close Reconciliation

**Trigger:** scheduled cron at store close time (configurable, default 9pm) or a manual "close day" tap by the owner.

**Draft:**
```
expected_cash = sum(cash-payment sales_txn for the day)
discrepancy = |expected_cash − counted_cash|   (counted_cash entered by owner, or 0/omitted if skipped)
```

**Guardrails:**
- If `discrepancy > discrepancy_threshold` (default ₹200), the card is flagged for review rather than closing silently — still one tap to approve, but the card visually shows the gap in red so it's not glossed over.
- Once approved, the day's ledger is marked closed and prior-day sales_txn become immutable — this is the one automation whose approval has a "point of no return" quality, so it's worth stating plainly on the card itself, not just in this doc.

**Escalation window:** same night — don't let unreconciled days pile up.

---

## Global Guardrails (apply to every automation)

- **No auto-approval, ever**, regardless of value or urgency (locked in by the product's approve-then-execute choice) — these formulas only ever produce a `pending` action.
- **No duplicate pending actions** for the same SKU + automation type at once.
- **Every guardrail that alters or caps the "obvious" answer must be visible on the card**, not just logged — "capped by storage limit," "near-cost clearance," "large order — confirm again" are UI-visible states, not silent backend decisions.
- All thresholds in this doc are **defaults**, stored in `settings` (see `04_Database_Schema.md`) and editable without a redeploy.