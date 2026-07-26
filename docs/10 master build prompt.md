# Mr. Mart — Master Build Prompt

This is what to actually paste into the AI assistant. It's structured as **one persistent project-context prompt** (paste once, at the start) followed by **11 staged prompts** (paste one at a time, in order, only after the previous stage passes its gate). Building all of this in one shot produces something broken everywhere; building it stage by stage produces one thing that actually works before moving to the next.

**Before you start:** put all spec docs (`00` through `11`) and the `mcp-server/` scaffold into the project's root, e.g. under `/docs` and `/packages/mcp-server`. Every prompt below assumes the agent can read them from there.

---

## PERSISTENT PROJECT CONTEXT (paste this once, first)

```
You are building "Mr. Mart" — an AI automation SaaS product for mini/mid-size supermarkets,
sold to independent mart owners as a monthly subscription.

Read /docs/00_README_Documentation_Index.md first — it tells you which other doc to read for
any given feature. Do not build from memory or assumption when a doc answers the question;
these docs are the spec, not background reading.

Non-negotiable product rules, true for every stage of this build:
1. Approve-then-execute, always. No automation may change real-world state (place an order,
   change a price, post a write-off, send a message) without an owner tapping Approve on an
   Approval Card first. This is enforced in the architecture (draft/execute tools are not
   network-reachable from the app), not just in UI — see /docs/02_MCP_Server_Spec.md and
   /docs/05_Security_and_Compliance.md.
2. The UI is visual-first. No screen requires reading a sentence to understand it. Numbers,
   color, icon, and photo carry the meaning — never a paragraph. See
   /docs/01_Project_Instructions.md Sections 2-7 for the full design system (red theme,
   Approval Card spec, typography rules) before writing any UI code.
3. This is a real, sellable product, not a prototype. Production-quality code, real error
   handling, real loading/empty/failure states on every screen — not just the happy path.
   The target user is a working professional running a business; a broken or ugly screen
   costs actual customers and actual money.
4. Multi-tenant from the schema up. Every table below `stores` is scoped by `store_id`,
   every `store_id` by `account_id`. Never trust a store_id from the client without verifying
   it belongs to the authenticated account. See /docs/04_Database_Schema.md and
   /docs/05_Security_and_Compliance.md Section 10.
5. Follow the infra shape in /docs/01_Project_Instructions.md Section 8: Frontend (CDN) ->
   Backend (fast, read/decide tools only) -> Redis (queue + cache) -> Worker (draft/execute
   tools, the slow/real-world I/O) -> Database (Postgres). Prometheus watches all of it.

At the end of every stage below, stop and show me what you built against that stage's
"Definition of Done" before moving to the next stage. Do not skip ahead.
```

---

## STAGE 0 — Repo Skeleton & Local Dev Environment

**Goal:** a running skeleton — no automations yet, just the shape of the system, so every later stage has somewhere to plug in.

**Docs to reference:** `01` (Section 8, infra), `04` (full schema), `02` (Section 5, scaffold notes)

**Prompt:**
```
Set up the repo skeleton for Mr. Mart:
- /apps/backend (Node.js/TypeScript) — will host read + decide MCP tools
- /apps/worker (Node.js/TypeScript) — will host draft + execute logic, consumes a Redis queue
- /apps/frontend (React Native, Android-first per /docs/01_Project_Instructions.md)
- /packages/mcp-server — start from the existing scaffold at /docs/mcp-server, keep its
  read tools and the one reference draft->approve->execute chain (mrmart_draft_reorder)
  working exactly as-is
- Postgres schema migrations for every table in /docs/04_Database_Schema.md, INCLUDING the
  accounts/subscriptions tables and the account_id column on stores — build multi-tenant from
  the very first migration, don't retrofit it later
- docker-compose for local dev: Postgres, Redis, backend, worker — one command to run everything

Definition of Done: `docker-compose up` boots all services, migrations run clean, and the
existing mrmart_get_stock_levels tool returns mock data end to end through the Backend.
Once it's running, connect to it per /docs/11_MCP_Server_Config.md
so its tools are directly callable from the agent panel for every stage after this one.
Show me the repo tree and confirm this works before Stage 1.
```

---

## STAGE 1 — One Automation, Fully Real (Auto-Reorder)

**Goal:** prove the entire loop end-to-end with real logic, not mocks — this is the riskiest part of the whole product, so get it right once before replicating the pattern six more times.

**Docs to reference:** `03` (Section 1, exact formula), `02` (draft/decide/execute tool contract), `04` (`products`, `stock_ledger`, `actions`, `settings` tables)

**Prompt:**
```
Implement Auto-Reorder for real, following /docs/03_Automation_Rules_and_Business_Logic.md
Section 1 exactly — the reorder_point and suggested_qty formulas, the max_order_qty cap, the
large_order_value_threshold second-confirmation rule, and the duplicate-pending-action guard.

- Worker: a scheduled job (every 15 min) that checks real stock_ledger-derived quantities
  against reorder_point, and calls mrmart_draft_reorder for any SKU that qualifies
- mrmart_draft_reorder must read its thresholds from the settings table, not hardcoded values
- Backend: mrmart_list_pending_actions, mrmart_approve_action, mrmart_reject_action working
  against the real database, with account_id/store_id scoping enforced
- Approving triggers mrmart_execute_reorder via the Redis queue (not inline) — Worker picks
  it up and logs a mock "sent to supplier" (real WhatsApp integration is Stage 6)
- Write the unit tests from /docs/07_Testing_QA_Plan.md Section 1 for this formula specifically

Definition of Done: seed the database with 5 realistic products (varying stock levels), run
the scheduler, see a real pending action appear, approve it via a raw API call, see it reach
'executed' status in the database, with the escalation-window and large-order-confirmation
guardrails both demonstrably working on deliberately-extreme seed data. Show me the test
results before Stage 2.
```

---

## STAGE 2 — The Cockpit UI (Approval Queue + Monitoring Screens)

**Goal:** the first real screen the owner will actually use — this is where "great UI" either happens or doesn't, so give it real design attention, not a placeholder.

**Docs to reference:** `01` (Section 4 Approval Card spec, Section 6 cockpit screens, Section 7 full design system) — treat the red palette, typography rules, and Approval Card layout as strict constraints, not suggestions

**Prompt:**
```
Build the Approval Queue screen and the read-only monitoring screens (Stock Pulse, Sales
Pulse, Today's Money) exactly per /docs/01_Project_Instructions.md Sections 4, 6, and 7.

Hard constraints, not suggestions:
- Approval Cards must be understandable and actionable without opening them — quantity/price
  visible on the closed card
- Approve and Reject are the two biggest tap targets on every card, distinguishable by
  color/icon alone
- Cherry Bold palette exactly as specified (#990011 brand, distinct #D7263D alert red so
  brand chrome never reads as "everything is an emergency")
- No body text over a 2-3 word label anywhere
- Real states: empty queue (nothing pending), loading, a failed-execution card (per the
  DevOps runbook's "never disappears silently" rule), and the escalated/pinned state

This should look and feel like a real, polished consumer app — smooth transitions, correct
touch target sizing (56dp min), tested one-handed on a real or emulated low-end Android
device per /docs/07_Testing_QA_Plan.md Section 5's 3-second rule on throttled 3G.

Wire it to Stage 1's real backend — approving a card in this UI should actually move
through the real pipeline, not a mock.

Definition of Done: a working Approval Queue screen against live Stage-1 data, screenshots
or a recording of the approve/reject flow, and a design walkthrough of how each hard
constraint above was met. Show me before Stage 3.
```

---

## STAGE 3 — Remaining 6 Automations

**Goal:** clone the Stage 1 pattern six more times. This should now be fast and low-risk, since the hard architectural problem is already solved.

**Docs to reference:** `03` (Sections 2-7, one formula per automation), `02` (tool list)

**Prompt:**
```
Using the exact pattern established in Stage 1 (mrmart_draft_reorder ->
mrmart_approve_action -> mrmart_execute_reorder), implement the remaining 6 automations
from /docs/03_Automation_Rules_and_Business_Logic.md, one at a time, in this order:
1. Expiry Markdown (Section 2) — including the price-floor guardrail
2. Expiry Write-off (Section 3)
3. Shelf Restock Task (Section 4) — manual flag only for now, camera detection is Stage 7
4. Slow-Mover Flag (Section 5)
5. Supplier Follow-up (Section 6) — draft the message text with a placeholder/mock LLM call
   for now if the model choice isn't finalized yet; keep the interface swappable
6. Day-Close Reconciliation (Section 7) — including the discrepancy-threshold flag

For each: implement the draft tool with the exact formula/guardrails from its section, the
matching execute tool, a unit test per /docs/07_Testing_QA_Plan.md Section 1, and its
Approval Card variant in the Stage 2 UI (same visual pattern, different content).

Definition of Done: all 7 automations demonstrable end-to-end against seed data, with
their guardrail edge cases specifically tested (not just the happy path). Show me before
Stage 4.
```

---

## STAGE 4 — Infra Hardening (Redis/Worker Split, Prometheus)

**Goal:** move from "runs locally" to "survives production load and failure."

**Docs to reference:** `01` (Section 8), `06` (full runbook)

**Prompt:**
```
Harden the infra per /docs/06_DevOps_Deployment_Runbook.md:
- Split Backend and Worker into genuinely separate deployable services (even if same repo)
- Real Redis-backed job queue (BullMQ) for trigger-checks, drafts, and executes — remove any
  remaining in-process shortcuts from earlier stages
- Retry with exponential backoff (3 attempts) on execute failures, landing in 'failed' status
  with a failure_reason, re-surfaced as an error-state Approval Card per the "never disappears
  silently" rule
- Prometheus metrics for every item in Section 5 of the runbook: queue depth, per-automation
  success/failure rate, execution latency, draft-cycle heartbeat
- Terraform/CDK for the AWS resources (ECS services, RDS or Neon connection, Secrets Manager
  entries) — no manual console setup

Definition of Done: kill the Worker mid-job, confirm the job retries/fails gracefully and
the failure is visible in both Prometheus and the Approval Queue UI. Show me the dashboard
and the failure-recovery demo before Stage 5.
```

---

## STAGE 5 — Auth, RBAC, and Tenant Isolation

**Goal:** lock down who can do what, and make sure one tenant can never see another's data.

**Docs to reference:** `05` (full doc, especially Section 10)

**Prompt:**
```
Implement auth and authorization per /docs/05_Security_and_Compliance.md:
- Phone + OTP login (WhatsApp or SMS — pick one and note it as a config choice)
- JWT sessions, short-lived + refresh
- Owner vs staff role enforcement, server-side, on every decide-tool call — not just hidden
  buttons client-side
- A single shared data-access layer that scopes every query by account_id -> store_id;
  write a test that deliberately tries to access another account's store_id and confirm
  it's rejected
- Rate limiting on approve/reject and OTP requests per Section 6 of the doc
- Secrets (DB, Redis, WhatsApp API keys) in AWS Secrets Manager, never in code or committed
  env files

Definition of Done: the cross-tenant access test fails safely (returns unauthorized, not
data), staff role genuinely cannot approve a financial action even via a direct API call,
and a security checklist walkthrough against this doc's Sections 1-7. Show me before Stage 6.
```

---

## STAGE 6 — Real External Integrations

**Goal:** replace every mock external call with the real thing.

**Docs to reference:** `01` (Section 8 execution connectors), `03` (Section 6 for message content), `05` (Section 8, WhatsApp compliance)

**Prompt:**
```
Replace mocked execute-tool integrations with real ones:
- WhatsApp Business API for supplier messages (Auto-Reorder, Supplier Follow-up) and owner
  notifications — respect the template-approval/24h-window rules in
  /docs/05_Security_and_Compliance.md Section 8
- POS/price-list integration for Expiry Markdown execution (if a specific POS system is
  targeted, ask me which one before building the connector — don't guess an API)
- Accounting export for Expiry Write-off and Day-Close (start with a simple CSV/webhook
  export if no specific accounting system is confirmed yet)

Definition of Done: one real end-to-end automation (Auto-Reorder is the best candidate)
firing an actual WhatsApp message in a sandbox/test environment when approved. Show me
before Stage 7.
```

---

## STAGE 7 — Onboarding + Computer Vision (Shelf Restock)

**Goal:** the first-run flow a real owner will go through, plus the one automation we deferred earlier.

**Docs to reference:** `08` (full onboarding flow), `01` (Section 10 open item on CV timing — confirm with me first if this should really be in v1 or deferred)

**Prompt:**
```
Build the first-run onboarding flow per /docs/08_Onboarding_Setup_Guide.md Section 1 —
phone+OTP, store basics, product catalog setup (manual quick-add first, catalog import as
a stretch goal), supplier setup, and WhatsApp Business connection. Ship with smart defaults
from /docs/03_Automation_Rules_and_Business_Logic.md silently applied — no settings form on
day one, per Section 1 point 5 of the onboarding doc.

Then implement Shelf Restock Task's camera-based detection (deferred from Stage 3) if we've
confirmed it's in v1 scope — otherwise implement the manual-flag path fully and stop there.

Definition of Done: a new test account can go from signup to seeing at least one real
Approval Card without any manual database seeding. Show me a full recording of this flow
before Stage 8.
```

---

## STAGE 8 — SaaS Layer (Billing, Plans, Superadmin Console)

**Goal:** turn the product into something that can actually charge money.

**Docs to reference:** `09` (full doc), `04` (`accounts`/`subscriptions` tables), `05` (Section 10, tenant isolation — re-verify against real billing data now flowing through)

**Prompt:**
```
Implement the SaaS layer per /docs/09_SaaS_Business_Model.md:
- Signup flow creates an `accounts` row with plan=trial per Section 4
- Stripe or Razorpay integration (confirm which with me if not already decided) for the
  billing mechanics in Section 2 — trial expiry and failed-payment handling must degrade
  gracefully (read-only, not a hard cutoff), exactly as specified
- Plan gating at the feature/store-count level only, never at automation quality, per
  Section 1's explicit warning
- A minimal superadmin console per Section 3: accounts list, account detail, billing health
  — build only these three screens for now, not the full list in that section

Definition of Done: a full trial signup -> simulated trial expiry -> payment method added ->
plan reactivated flow, demonstrated end-to-end in a sandbox payment environment. Show me
before Stage 9.
```

---

## STAGE 9 — Full Test Pass & Pilot Readiness

**Goal:** everything from `07_Testing_QA_Plan.md` that hasn't been covered stage-by-stage already, run as one full pass.

**Docs to reference:** `07` (full doc)

**Prompt:**
```
Run the full test plan from /docs/07_Testing_QA_Plan.md against the complete system:
- Section 2 integration tests for all 7 automations (happy path, reject path, duplicate
  prevention, execute failure + retry, permanent failure)
- Section 3 queue/load tests (burst scenario, Redis outage simulation)
- Section 4 security tests (staff-role restriction, direct draft/execute tool access attempt,
  expired JWT handling)
- Section 5 non-functional tests (3-second rule on real low-end hardware, offline queue,
  one-tap design audit)
- Walk through the Section 7 release checklist as a literal checklist, item by item

Definition of Done: a test report against every item above, with any failures fixed before
calling this pilot-ready. This is the last stage before real store owners touch it — treat
gaps found here as blockers, not follow-up tickets.
```

---

## STAGE 10 — Pilot Launch

**Goal:** get it in front of 1-2 real store owners and start learning from real reject-rate data.

**Docs to reference:** `07` (Section 6, UAT), `06` (monitoring — this is when the Prometheus alerts stop being theoretical)

**Prompt:**
```
Prepare for pilot launch with 1-2 real store owners per /docs/07_Testing_QA_Plan.md
Section 6:
- Confirm Prometheus alerting is live and actually paging someone (not just dashboards)
  before any real owner's money starts moving through this system
- Set up a way to track reject rate per automation, per account, from day one — this is the
  primary signal for whether /docs/03_Automation_Rules_and_Business_Logic.md's default
  formulas and thresholds need tuning for real-world conditions
- Have a rollback plan ready (per /docs/06_DevOps_Deployment_Runbook.md Section 3) in case
  something needs to be pulled back mid-pilot

This stage is inherently iterative — expect to come back to Stage 1's formulas with real
tuning data, not to write new features. Report back with real reject-rate numbers after the
first week; we'll adjust /docs/03 based on what you find, not on guesses.
```

---

## Notes on Using These Prompts

- **Paste the persistent context once**, at the very start of the session/project — most agentic IDEs support pinning this so it persists across the whole build rather than needing to be repeated per stage.
- **Don't skip a stage's Definition of Done.** The whole point of staging is catching a bad formula or a security gap in Stage 1 or 5, not discovering it in Stage 10 with real customer money involved.
- **Stage 6 and Stage 8 both have an explicit "ask me first" branch point** (which POS system, which payment provider) — these are real business decisions this document set doesn't make for you. Answer those when the agent asks, don't let it guess.
- If the output at any stage doesn't match that stage's Definition of Done, the right move is "fix this stage" — not "note it and move on." Automations that touch money don't get a pass on partial correctness.
- The UI/UX slide deck (`Mr_Mart_UIUX_Concept.pptx`) is still the pre-automation version and shouldn't be used as a literal build reference for Stage 2 — Section 4 and 7 of doc `01` are the authoritative UI spec now. Ask for a refreshed deck separately if you want one before Stage 2.