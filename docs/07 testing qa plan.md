# Mr. Mart — Testing & QA Plan

Automations that place real orders and change real prices need a different testing posture than a typical CRUD app: the cost of a wrong answer isn't a bad UI, it's the owner's money. This doc defines what "tested" means for this product.

---

## 1. Unit Tests — Formula Correctness

Every formula in `03_Automation_Rules_and_Business_Logic.md` is a pure function and should be tested as one, independent of the database or queue:

- Reorder point calculation across a matrix of `avg_daily_sales` / `lead_time_days` / `safety_factor` inputs, including edge cases: zero sales history (new SKU), extremely high velocity, missing supplier lead time (falls back to default).
- Suggested reorder quantity, including the `max_order_qty` cap and the "capped by storage limit" flag being set correctly.
- Markdown discount curve at each `days_left` value, including the price-floor guardrail actually engaging when cost margin would otherwise go negative.
- Write-off value calculation.
- Restock quantity `min()` logic, including `backroom_qty == 0` correctly *not* firing the automation.
- Slow-mover sustained-drop detection — test with a single bad day (should NOT fire) vs. 7 consecutive bad days (should fire).
- Day-close discrepancy calculation and threshold flagging.

**Target:** 100% coverage on the business-logic module — this is the highest-value code to test in the entire product, since a formula bug directly costs the owner money.

## 2. Integration Tests — The Full Chain

For each automation, test the complete `trigger → draft → pending action → approve → execute → status update` chain against a test database and mocked external APIs (WhatsApp sandbox, mock POS endpoint):

- Happy path: trigger fires, draft is correct, approval flips status, execute succeeds, action reaches `executed`.
- Reject path: draft is correct, reject archives it with reason, no execute call ever fires (assert the mock external API was never called).
- Duplicate-prevention: trigger fires twice before the first draft is decided — assert only one `pending` action exists per SKU+type.
- Execute failure + retry: mock the external API to fail twice then succeed — assert the action still reaches `executed` and the retry count is logged.
- Execute permanent failure: mock the external API to always fail — assert the action reaches `failed` with a `failure_reason`, and re-surfaces as a card rather than disappearing.

## 3. Queue & Load Tests

- Burst scenario: simulate 50 SKUs crossing their reorder point in the same 15-minute check cycle — verify the Worker drains the queue without dropping jobs and Prometheus's queue-depth metric reflects the backlog accurately.
- Redis outage simulation: kill the Redis connection mid-test — verify the Backend still responds to reads (degrades gracefully) and queued-but-unprocessed jobs are recoverable once Redis returns (per the reconciliation-sweep note in the DevOps runbook).

## 4. Security Tests

- Staff-role account attempts to call `mrmart_approve_action` on a `reorder`-type action — must be rejected server-side (per `05_Security_and_Compliance.md` Section 2), not just hidden client-side.
- Attempt to call a `mrmart_draft_*` or `mrmart_execute_*` tool directly from an app-authenticated session — must not be reachable at all (network-level, not just authorization-level).
- Expired/invalid JWT on any decide-tool call — must be rejected, not silently treated as unauthenticated-read access.

## 5. Non-Functional / UX Tests

- **3-second rule:** every Approval Card and monitoring screen must render its core information (photo, number, color) within 3 seconds on a low-end Android device on a throttled 3G connection — test on actual low-end hardware, not just a simulator on a fast laptop.
- **Offline queue:** approve a card in airplane mode, confirm it queues locally; reconnect, confirm it actually executes and doesn't silently drop (per the Frontend offline-first requirement in the Project Instructions doc).
- **One-tap rule:** manually audit every screen against Design Principle #10 (Approve/Reject are always the two biggest things, unmistakable by color/icon alone) — this is a design-review checklist, not an automated test, but should be run before every release that touches an Approval Card layout.

## 6. User Acceptance Testing (UAT)

- Pilot with 1-2 real store owners for 2 weeks before wider rollout.
- **Primary signal to watch: the reject rate.** A high reject rate on any automation type means the drafting logic (formula, thresholds, or defaults) doesn't match that store's reality — that's a tuning problem, not a UI problem, and should route back to `03_Automation_Rules_and_Business_Logic.md`'s defaults, not a redesign of the card.
- Ask the pilot owner directly, in their language, whether they trust the system enough to stop double-checking it manually — that's the actual product goal, and it's not something a functional test can measure.

## 7. Release Checklist

Before any prod deploy that touches an automation:
- [ ] Unit tests green on the business-logic module
- [ ] Integration test for that automation's full chain green
- [ ] Guardrails manually verified against at least one deliberately-extreme input (e.g. a SKU with absurd sales velocity) to confirm the cap actually engages
- [ ] Prometheus alert thresholds reviewed — new automation types need their own success/failure metrics, not just a shared bucket
- [ ] Staging soak: automation has run for at least 24h in staging against realistic seed data with no unexpected `failed` actions