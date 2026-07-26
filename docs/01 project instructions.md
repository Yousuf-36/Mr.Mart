# Mr. Mart — Project Instructions
**AI Automation Solution for Mini Supermarkets — Visual, Approve-Then-Execute**

> Think of "Mr. Mart" as the store's quiet second-in-command — always watching stock, sales, and expiry, and handing the owner a finished decision instead of a problem. The product's whole premise: the owner should *see* what to do, not read or listen to it — and now, mostly just *approve or reject* what Mr. Mart has already prepared.

Use this document as the base context/system prompt when generating build prompts. Paste relevant sections into each feature prompt so the agent always has the constraints in view.

---

## 1. Product Vision

**This is not a dashboard the owner operates. It's an automation system the owner supervises.**

Background AI processes constantly watch stock, sales, and expiry data and **draft actions** — a reorder, a markdown, a write-off, a supplier message. The owner never builds these from scratch. Their job shrinks to one motion: **look at a card, tap Approve or Reject.** Once approved, the system executes the action itself (places the order, updates the price, logs the write-off, sends the message) — no further manual work.

Target owner profile (unchanged from v1):
- Not comfortable reading/writing in English
- May have limited formal literacy in any language
- Run the business hands-on, on their feet, on a phone — not at a desk
- Wants decisions made *for* them, with a fast, low-risk way to say yes or no

**Core design law: no screen should require reading a sentence to understand the action, and no action should require more than one tap to approve.** Every insight and every proposed action is expressed through color, icon, size, position, and photograph — not paragraphs. Text is a *label*, never the *message*.

### The core loop (the whole product, really)

```
1. TRIGGER    → a background rule or the AI notices something (low stock, expiring batch, slow seller...)
2. DRAFT      → the automation layer prepares a concrete action with all details filled in
3. SURFACE    → the action appears as one card in the dashboard cockpit (and/or a WhatsApp notification)
4. DECIDE     → owner taps Approve or Reject — that's the entire interaction
5. EXECUTE    → on approval, the system performs the action automatically (order sent, price updated, etc.)
6. LOG        → every decision + execution is recorded for a same-language audit trail
```

Nothing in this product should ever ask the owner to fill a form, type a quantity, or navigate more than one level deep. If an automation can't confidently draft a complete action, it doesn't surface yet — it waits for more data rather than asking the owner to do the thinking.

---

## 2. Primary Persona

**The Owner** — runs one or a few store locations, manages stock personally or with 1-3 staff, checks the app in short bursts between customers (10-30 seconds at a time), uses WhatsApp and photos comfortably, may not type easily.

Design implication: every important screen must be understandable in **under 3 seconds**, one-handed, without zooming in to read text.

---

## 3. Core Design Principles

1. **Photo over text.** Every product is represented by its real photo (from a supplier catalog or a photo the owner took), not a typed name. Typed name is a secondary label underneath, small.
2. **Color and size ARE the data.** Red/yellow/green for urgency. Bigger icon = bigger issue or opportunity. No line charts, no tables, no percentages front-and-center.
3. **Icons are universal, not idiomatic.** Battery-style fill for stock level, a clock/hourglass for expiry, an arrow for trend direction, a rupee symbol for money. Avoid icons that require cultural/language-specific interpretation.
4. **One primary action per screen.** Never make the owner choose between 5 things. Surface the single most important item first, let them tap to see more.
5. **Large touch targets.** Minimum 56x56dp tap targets, thumb-reachable zones prioritized (bottom half of screen).
6. **No modal text walls.** Confirmations use icon + big yes/no buttons, not paragraphs.
7. **Numbers stay numbers.** Quantities, prices, and dates are language-agnostic — always shown in numerals, never spelled out.
8. **Everything works with almost no typing.** Search is photo/visual-first (browse by category icon/image) with numeric or voice fallback, not a keyboard-first search bar.
9. **Every draft action is a complete sentence in card form, never a fill-in-the-blank.** The AI has already decided the quantity, the price, the wording — the owner is reviewing a finished decision, not co-authoring one.
10. **Approve and Reject are always the two biggest things on the card.** Equal size, opposite ends, unmistakable which is which by color/icon alone (green check vs red cross) — never rely on the label text to tell them apart.

---

## 4. The Approval Card (the one UI pattern that carries the whole product)

Every automation, regardless of type, surfaces through the same card shape so the owner only has to learn one pattern once:

```
┌─────────────────────────────────────┐
│  [product/action photo]   [status]   │  ← what this is about, at a glance
│                                       │
│  Big number or price (the decision)  │  ← the AI's completed answer
│  1-2 word context label              │
│                                       │
│  [  ✕ Reject  ]      [  ✓ Approve  ] │  ← the only two things to tap
└─────────────────────────────────────┘
```

Rules for every Approval Card:
- The card must be understandable **without opening it** — quantity, price, or action is visible on the closed card, not behind a "details" tap.
- A card never disappears silently. Reject → archived with reason logged. Approve → moves to "executing" then "done," visible in a short history feed.
- If an approval sits unanswered past a set window (e.g. same day for perishables, 48h for reorders), it re-surfaces at the top with an escalated (more saturated) color rather than sending a second, separate alert.

---

## 5. Core Automations (v1 Scope)

Each automation follows the same loop: **trigger → AI drafts the action → Approval Card → owner taps → system executes.**

| Automation | Trigger | What the AI drafts | On approval, system does |
|---|---|---|---|
| **Auto-Reorder** | Stock crosses reorder point / sales velocity forecast | Supplier, SKU, quantity, cost | Sends the order (WhatsApp/email/supplier API) automatically |
| **Expiry Markdown** | Batch enters expiry window | Discount %, new price, affected qty | Updates shelf price / POS price automatically |
| **Expiry Write-off** | Batch passes expiry, unsold | Write-off quantity and value | Posts the write-off to the ledger automatically |
| **Shelf Restock Task** | Camera/manual flag: shelf empty but backroom has stock | Which item, how much to bring out, to whom | Assigns/notifies staff automatically |
| **Slow-Mover Flag** | SKU sales trend drops sharply over N days | Suggestion to reduce next order or stop stocking | Adjusts the reorder-point/default order quantity automatically |
| **Supplier Follow-up** | Expected delivery hasn't arrived by cutoff | A ready-to-send message to the supplier | Sends the message automatically |
| **Day-Close Reconciliation** | End of business day | Cash vs digital totals, discrepancy flag if any | Closes the day's ledger automatically |

Out of scope for v1: multi-store rollups, staff scheduling, delivery route automation, loyalty/CRM — flag as "Phase 2" in prompts.

---

## 6. The Cockpit (Dashboard)

The dashboard survives from v1, but its job changes: it's no longer a set of modules the owner browses — it's the **queue and history of automations**.

| Screen | What it does | Primary visual |
|---|---|---|
| **Approval Queue** (home) | Every pending Approval Card, most urgent first | Stacked Approval Cards, red-badge count on app icon |
| **Today's Activity** | What's already been approved/executed/rejected today | Compact timeline, green check / red cross icons |
| **Stock Pulse** | Current stock level per product (monitoring only, read-only) | Battery-fill icon per product photo |
| **Sales Pulse** | What's selling / not selling (monitoring only, read-only) | Product photos sized by sales volume, up/down arrow overlay |
| **Today's Money** | Total sales, cash vs digital | Big number + 2 icons, one bar |

The monitoring screens (Stock Pulse, Sales Pulse, Today's Money) are **look, don't touch** — they explain *why* a card appeared in the Approval Queue, but no action is taken from them directly. All action-taking happens through Approval Cards.

---

## 7. Visual Design System (Red Theme)

**Palette — "Cherry Bold"**
| Role | Hex | Usage |
|---|---|---|
| Primary (Cherry Red) | `#990011` | Headers, primary buttons, active states, brand |
| Base / Background | `#FCF6F5` | App background, cards |
| Ink (Text) | `#241111` | Primary text, high-contrast on light bg |
| Accent (Navy) | `#2F3C7E` | Secondary info only — never for urgency states |
| Status Green | `#1E8E3E` | Healthy stock, good sales |
| Status Yellow | `#F2A900` | Attention/soon |
| Status Red (Alert) | `#D7263D` | Critical/urgent — distinct from brand cherry so alerts stand out |

Rule: brand red ≠ alert red. Keep them visually distinct (see hex values above) so a screen full of brand chrome doesn't read as "everything is an emergency."

**Typography:** Large numerals (28-40pt for key stats), minimal text, high weight (Bold/SemiBold) for anything that must be read at a glance. Avoid thin/light font weights entirely.

**Motif:** Rounded-square photo frames with a colored status ring around each (green/yellow/red) — repeat this single motif everywhere so the owner learns one visual language.

**Approval Card states:**
| State | Color | Icon |
|---|---|---|
| Pending | Cherry red border, white card | none yet |
| Approved / executing | Status Green fill on the button, brief spinner motif | ✓ |
| Rejected | Status Red fill on the button, card fades to archive | ✕ |
| Escalated (no response in window) | Status Red border, card pinned to top | ⚠ |

---

## 8. Infrastructure Architecture

```
┌────────────┐      ┌────────────┐      ┌───────────────────────┐
│  Frontend  │ ───▶ │  Backend   │ ───▶ │  Database (RDS /       │
│ (CDN/AWS)  │      │  (AWS)     │      │  Neon.tech Postgres)   │
└────────────┘      └─────┬──────┘      └───────────────────────┘
                           │
                           ├──────────▶ ┌───────────────────────┐
                           │            │  Prometheus            │
                           │            │  (self-hosted/cloud)   │
                           │            └───────────────────────┘
                           │
                           ▼
                     ┌────────────┐      ┌────────────┐
                     │   Redis    │ ───▶ │   Worker   │
                     │ (Redis     │      │   (AWS)    │
                     │  Cloud)    │      └─────┬──────┘
                     └────────────┘            │
                           ▲                   │
                           └───────────────────┘
                        (worker writes results back to
                         Database + Redis; Backend reads
                         Database for status updates)
```

**Why this shape fits the approve-then-execute model exactly:** the two things this product must never do are (1) make the owner wait, and (2) fail silently on a real-world action. Splitting Backend and Worker across a Redis queue solves both.

| Component | Role in this product |
|---|---|
| **Frontend (CDN/AWS)** | The mobile cockpit app (React Native) plus any web admin surface. Static assets/OTA bundles served from CDN for fast load on patchy store wifi. Talks only to Backend. |
| **Backend (AWS)** | Stateless API layer. Hosts the MCP server's **read** tools (Stock Pulse, Sales Pulse, etc.) and **decide** tools (`mrmart_list_pending_actions`, `mrmart_approve_action`, `mrmart_reject_action`). When the owner taps Approve, Backend responds *instantly* — it marks the action `approved` in the Database and enqueues the actual execution job to Redis. It does not wait for the supplier WhatsApp message to send before responding to the app. |
| **Database (RDS or Neon.tech)** | Postgres — the schema from the MCP spec doc (`products`, `stock_ledger`, `sales_txn`, `expiry_batches`, `actions`, etc.). Source of truth for every screen and the audit trail. |
| **Redis (Redis Cloud)** | Two jobs: (1) **job queue** (e.g. BullMQ) carrying scheduled trigger checks ("check reorder points every 15 min"), draft-generation jobs, and execution jobs created the moment an action is approved; (2) **cache** for hot read paths (current stock levels, today's pending-action count) so the cockpit feels instant even under load. |
| **Worker (AWS)** | Where the actual "AI Automation" lives. Pulls jobs off Redis and does the two things Backend deliberately doesn't: (a) run the **draft** tools on a schedule — compute reorder quantities, markdown %, supplier messages, and write them to the Database as `pending` actions; (b) run the **execute** tools once approved — the real WhatsApp/POS/supplier API calls, which can be slow or occasionally fail and retry. Writes results back to Database; Backend/Frontend pick up the new status on next read (short-poll or push). |
| **Prometheus (self-hosted/cloud)** | Non-negotiable for this product specifically: if a Worker job silently fails, an owner's approved reorder never actually gets sent, and they'll have no way to know until stock runs out. Track per-automation success/failure counts, queue depth, and job latency; pair with Alertmanager/Grafana so a failed execution pages someone *before* the owner notices. |

**Request trace for one approval (reorder example):**
1. Owner taps **Approve** on the Auto-Reorder card → Frontend calls Backend's `mrmart_approve_action`.
2. Backend marks the action `approved` in Postgres, pushes an `execute_reorder` job onto the Redis queue, returns `"approved · sending..."` to Frontend immediately.
3. Worker picks up the job, calls the WhatsApp Business API to message the supplier, writes `executed_at` + result back to Postgres (or `failed` + retry/backoff on error).
4. Frontend's next read of `mrmart_list_pending_actions`/`mrmart_get_today_activity` shows the card as **Done** — or, if it failed, re-surfaces it with an error state rather than pretending it succeeded.
5. Prometheus records the job's duration and outcome throughout, independent of whether the app ever re-opens to check.

**Where the LLM sits:** the LLM agent runs inside the Worker process (it's the thing calling draft tools with judgment-heavy inputs, like wording a supplier follow-up message). Deterministic triggers (stock crossed reorder point, batch hit expiry window) can enqueue draft jobs directly via simple rules — they don't need to go through the LLM at all. Reserve the LLM for the parts that genuinely need judgment, not for arithmetic Postgres can already do.

**Suggested stack details:**
- Backend & Worker: Node.js/TypeScript, same MCP server codebase — Backend registers read/decide tools on an HTTP transport; Worker imports the same draft/execute functions and runs them via a BullMQ consumer (stdio/in-process, not over MCP transport, since nothing owner-facing calls them directly)
- Frontend: React Native (Android-first)
- Computer vision (Phase 1.5+): runs as its own Worker job type, same queue
- Offline-first on Frontend: queue taps locally, replay against Backend once back online

---

## 9. How to Use This Document Set

When writing a build prompt for any screen/feature:
1. Paste the relevant automation row from Section 5, or the relevant cockpit screen from Section 6.
2. Paste the full Section 7 (design system, including Approval Card states) so color/motif stays consistent across every generated screen.
3. State explicitly: *"No body text longer than a 2-3 word label. The Approval Card must be understandable and actionable without opening it."*
4. Generate one automation's full loop at a time (trigger → draft → card → execute), not just the screen in isolation — the backend and frontend prompts should reference the same MCP tool names so they stay in sync.
5. Reference the MCP server tool names (companion doc) directly as the data/action contract each screen consumes.

---

## 10. Open Items (fill in before final build)

- [ ] Confirm base LLM/model choice for the agent layer (owner mentioned this is coming)
- [ ] Confirm target platform: Android-only vs Android+iOS
- [ ] Confirm whether Shelf Restock Task (camera) is v1 or Phase 2
- [ ] Confirm regional language(s) needed for the *few* unavoidable text labels
- [ ] Confirm approval-window timing per automation type (e.g. same-day for markdowns vs 48h for reorders)
- [ ] Confirm which executions need a second confirmation step (e.g. large-value reorders) vs single-tap
- [ ] Confirm RDS vs Neon.tech for Postgres (Neon = cheaper/serverless for early-stage, easier branch/test DBs; RDS = more standard AWS-native ops if you're already deep in AWS tooling)
- [ ] Confirm self-hosted vs managed Prometheus (self-hosted = no extra cost but you own the ops; managed/cloud = faster to get alerting live for a v1 launch)
- [ ] Confirm whether Backend and Worker deploy as separate AWS services from day one, or start as one process with an internal queue and split later once automation volume justifies it