# Mr. Mart — AI Automation for Mini Supermarkets

> **Approve-then-execute:** background AI watches stock, sales, and expiry — then hands the owner a finished decision to tap once. The system does the rest.

Mr. Mart is a SaaS product sold to independent mini/mid-size supermarket owners as a monthly subscription. Instead of a dashboard the owner has to operate, it's an automation system the owner supervises. AI processes constantly draft actions — a reorder, a price markdown, a write-off, a supplier message — and surface them as **Approval Cards**. The owner taps **Approve** or **Reject**. On approval, the system executes automatically (places the order, updates the price, sends the message) with no further owner involvement.

---

## Architecture

```
┌─────────────────┐        ┌─────────────────┐        ┌──────────────────────────┐
│   Frontend       │ ─────▶ │    Backend       │ ─────▶ │  Database (Postgres)     │
│ (React Native)  │        │  (Express/Node)  │        │  RDS / Neon.tech         │
│  Android-first  │        │  Port 3001       │        │  Port 5432               │
└─────────────────┘        └────────┬─────────┘        └──────────────────────────┘
                                    │
                         ┌──────────▼──────────┐        ┌──────────────────────────┐
                         │  MCP Server         │        │  Prometheus              │
                         │  (packages/mcp-     │        │  (metrics + alerting)    │
                         │   server)           │        │  Stage 5+                │
                         │  Port 3333          │        └──────────────────────────┘
                         └──────────┬──────────┘
                                    │
                         ┌──────────▼──────────┐        ┌──────────────────────────┐
                         │  Redis (BullMQ)     │ ─────▶ │  Worker (Node/BullMQ)   │
                         │  Port 6379          │        │  Draft + Execute jobs    │
                         └─────────────────────┘        └──────────────────────────┘
```

| Component | What it does |
|---|---|
| **Frontend** | React Native cockpit app (Android-first). Shows Approval Cards, monitors Stock/Sales/Money. Talks to Backend only. Runs outside Docker — `npm run android`. |
| **Backend** | Stateless Express API. Hosts the MCP server's **read** and **decide** tools only. When owner taps Approve, responds instantly — marks approved, enqueues job to Redis, does not wait for execution. |
| **MCP Server** | The data/action contract: 18 tools across 4 categories. Standalone HTTP service on port 3333. The golden rule: only `mrmart_approve_action` may trigger execute tools. |
| **Database** | Postgres. 11 tables. Multi-tenant from migration 001 (`accounts → stores → everything`). The `actions` table is the full audit trail. |
| **Redis** | BullMQ job queue (draft jobs, execute jobs) + cache. Decouples approve from execute so the owner never waits. |
| **Worker** | Where automation logic runs. Pulls jobs off Redis: (a) draft tools on schedule (compute reorders, markdowns, etc.); (b) execute tools once approved (send WhatsApp, update price). Never network-reachable from Frontend. |
| **Prometheus** | Scrapes per-automation success/failure counts, queue depth, heartbeat. A failed execute silently missing is worse than no automation — this is the safety net. Added in Stage 5. |

---

## Tech Stack

| Part | Language / Framework / Service |
|---|---|
| Backend & Worker | Node.js 20, TypeScript 5, Express 4 |
| MCP Server | `@modelcontextprotocol/sdk`, Zod, TypeScript |
| Frontend | React Native 0.74, TypeScript (Android-first) |
| Job Queue | BullMQ 5 + IORedis |
| Database | PostgreSQL 16 (Neon.tech for dev/staging, RDS for prod) |
| Cache / Queue broker | Redis 7 |
| Containerisation | Docker + docker-compose |
| Migrations | Plain SQL + custom Node runner (no ORM) |
| Monitoring | Prometheus + Grafana (Stage 5+) |
| CI/CD | GitHub Actions (Stage 6+) |

---

## Repo Structure

```
Mr. Mart/
├── apps/
│   ├── backend/            Express API — read/decide tools, migration runner
│   │   ├── src/            index.ts — health check, future auth/proxy
│   │   └── migrations/     001–011 SQL files + run-migrations.js
│   ├── worker/             BullMQ consumer — draft + execute jobs
│   │   └── src/            index.ts — queue connection, job processors
│   └── frontend/           React Native app (Android-first)
│       └── App.tsx         Stage 0 splash; full screens from Stage 1
├── packages/
│   └── mcp-server/         The MCP server — all 18 tools + mock data layer
│       └── src/
│           ├── index.ts    HTTP server (port 3333), tool registration
│           ├── store/      mock-store.ts (replaced with Postgres in Stage 1)
│           └── tools/      read.ts, decide.ts, draft.ts, execute.ts
├── docs/                   Full product specification (read these first)
│   ├── 00readme.md         Index — which doc answers which question
│   ├── 01 project instructions.md    Vision, design system, architecture
│   ├── 02 mcp server spec.md         All 18 MCP tools, the golden rule
│   ├── 03 automation rules and business logic.md   Formulas + guardrails
│   ├── 04 database schema.md         Full Postgres schema
│   ├── 05 security and compliance.md Auth, tenant isolation, secrets
│   ├── 06 devops deployment runbook.md  Environments, CI/CD, alerting
│   ├── 07 testing qa plan.md         What "tested" means for this product
│   ├── 08 onboarding setup guide.md  First-run flow
│   ├── 09 saas business model.md     Plans, billing, superadmin
│   ├── 10 master build prompt.md     11-stage build plan
│   └── 11 mcp server config.md       How to connect MCP server
├── .agents/
│   └── mcp_config.json     MCP connection config (port 3333)
├── docker-compose.yml      One command to boot everything
├── .env.example            All required env vars (safe to commit — no real values)
├── tsconfig.base.json      Shared TypeScript config
└── package.json            Monorepo workspace root
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 | `node --version` |
| npm | ≥ 10 | Comes with Node 20 |
| Docker Desktop | latest | Required for Postgres, Redis, services |
| docker-compose | V2 (`docker compose`) | Bundled with Docker Desktop |
| Android Studio | latest | For running the frontend on a device/emulator |
| Git | any | |

---

## Quick Start

### 1. Clone and set up environment

```bash
git clone https://github.com/Yousuf-36/Mr.Mart.git
cd "Mr. Mart"
cp .env.example .env
# Edit .env if needed — defaults work for local dev
```

### 2. Boot all backend services (one command)

```bash
docker-compose up --build
```

This starts, in order:
1. **postgres** — waits until healthy
2. **redis** — waits until healthy
3. **migrate** — runs all 11 SQL migrations, then exits 0
4. **mcp-server** — starts on port 3333 (waits for migrate to complete)
5. **backend** — starts on port 3001 (waits for mcp-server to be healthy)
6. **worker** — starts and connects to Redis queue

### 3. Verify the stack is up

```bash
# MCP server health
curl http://localhost:3333/health

# Backend health
curl http://localhost:3001/health

# MCP stock levels (the core Stage 0 smoke test)
curl -s -X POST http://localhost:3333/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"mrmart_get_stock_levels","arguments":{}},"id":1}'
```

### 4. Run the frontend (separate from Docker)

```bash
# In a separate terminal — requires Android Studio + connected device or emulator
cd apps/frontend
npm install
npm run android
```

### 5. Connect MCP Client

The `.agents/mcp_config.json` is already in place. In your MCP client:
- `... → MCP Servers → Manage MCP Servers → View raw config`
- Confirm `mrmart` is listed with all tools visible
- Test: ask the agent to call `mrmart_get_stock_levels`

---

## Environment Variables

All variables are in [`.env.example`](.env.example). Copy to `.env` for local dev. **Never commit `.env` with real values.**

| Variable | Service | What it's for | Required |
|---|---|---|---|
| `POSTGRES_HOST` | All | Postgres hostname | Yes |
| `POSTGRES_PORT` | All | Postgres port (default 5432) | Yes |
| `POSTGRES_DB` | All | Database name | Yes |
| `POSTGRES_USER` | All | DB username | Yes |
| `POSTGRES_PASSWORD` | All | DB password | Yes |
| `DATABASE_URL` | Backend, Worker, MCP | Full Postgres connection string | Yes |
| `REDIS_HOST` | Worker, Backend | Redis hostname | Yes |
| `REDIS_PORT` | Worker, Backend | Redis port (default 6379) | Yes |
| `REDIS_PASSWORD` | Worker, Backend | Redis password (empty in local dev) | No |
| `MCP_PORT` | MCP Server | HTTP port for MCP server (default 3333) | No |
| `BACKEND_PORT` | Backend | HTTP port for backend (default 3001) | No |
| `MCP_SERVER_URL` | Backend | Where backend proxies to MCP server | No |
| `NODE_ENV` | All | `development` \| `production` | No |
| `WHATSAPP_API_TOKEN` | Worker (Stage 2+) | WhatsApp Business API token | Stage 2+ |
| `JWT_SECRET` | Backend (Stage 2+) | JWT signing secret | Stage 2+ |

---

## MCP Tool Reference

Full spec: [`docs/02 mcp server spec.md`](docs/02%20mcp%20server%20spec.md)

**The golden rule:** `mrmart_approve_action` is the **only** tool allowed to trigger an execute function. No other code path — including any LLM directly calling an execute tool — may fire an execute function. This is enforced at the network level: execute tools have no HTTP endpoint.

| Category | Tools | Caller | What it does |
|---|---|---|---|
| **Read** | `mrmart_get_stock_levels`, `_get_sales_summary`, `_get_top_sellers`, `_get_today_activity` | Frontend, Backend | Monitoring-only; never changes state |
| **Decide** | `mrmart_list_pending_actions`, `_get_action_detail`, `_approve_action`, `_reject_action` | Frontend (owner tap) | `_approve_action` is the sole choke point for execution |
| **Draft** | `mrmart_draft_reorder`, `_expiry_markdown`, `_expiry_writeoff`, `_shelf_restock_task`, `_slowmover_adjustment`, `_supplier_followup`, `_day_close` | Worker only | Computes complete action, writes pending action to DB. Never touches inventory/price/orders. |
| **Execute** | `mrmart_execute_reorder`, `_markdown`, `_writeoff`, `_restock_task`, `_reorder_point_adjustment`, `_supplier_message`, `_day_close` | Internal only (via `_approve_action`) | Changes real-world state. No HTTP endpoint. |

---

## Development Workflow

This project is built in **11 stages** per [`docs/10 master build prompt.md`](docs/10%20master%20build%20prompt.md). Each stage has a Definition of Done that must be verified before the next stage begins. The git history mirrors this — one commit per working stage.

| Stage | What it adds |
|---|---|
| 0 | Repo skeleton, migrations, MCP scaffold, docker-compose ← **you are here** |
| 1 | Auto-Reorder automation (full loop, real Postgres) |
| 2 | Auth (phone + OTP, JWT), owner/staff roles |
| 3 | Expiry Markdown + Write-off automations |
| 4 | Backend/Worker split, Redis queue, remaining automations |
| 5 | Prometheus monitoring |
| 6 | Frontend Approval Queue screen (React Native) |
| 7 | Remaining cockpit screens (Stock Pulse, Sales Pulse, Today's Money) |
| 8 | Onboarding first-run flow |
| 9 | SaaS billing (Razorpay/Stripe), plan gates |
| 10 | Superadmin console, full E2E testing, production hardening |

A new contributor should: read `docs/00readme.md` → read `docs/01` → boot the stack → confirm client can call `mrmart_get_stock_levels` → then look at the Stage 1 prompt in `docs/10`.

---

## Testing

Full test spec: [`docs/07 testing qa plan.md`](docs/07%20testing%20qa%20plan.md)

**Stage 0 — what's testable now:**

```bash
# Type-check all packages
npm run typecheck --workspaces --if-present

# Smoke test the MCP server (start it first)
cd packages/mcp-server && npm run dev &
curl http://localhost:3333/health
```

Unit tests, integration tests (full draft→approve→execute chain), and load tests are added incrementally from Stage 1. Doc 07 specifies the full matrix — including the "never let an approved action fail silently" requirement that drives most of the integration test design.

---

## Deployment

Full runbook: [`docs/06 devops deployment runbook.md`](docs/06%20devops%20deployment%20runbook.md)

Short version:
- **dev** — `docker-compose up` (this repo, what you're running now)
- **staging** — same docker-compose topology against sandboxed external APIs; Neon.tech branch per PR
- **prod** — Backend + Worker as separate AWS ECS/Fargate services, Redis Cloud, RDS or Neon.tech prod, Prometheus scraping both

Migrations always run as a separate pipeline step before the new service version goes live. Never hand-run SQL against prod.

---

## Security

Full spec: [`docs/05 security and compliance.md`](docs/05%20security%20and%20compliance.md)

**The most important rule for this codebase:** every table below `stores` is scoped by `store_id`, and every `store_id` is scoped by `account_id`. Never trust a `store_id` from the client without verifying it belongs to the authenticated account. A multi-tenant SaaS that gets this wrong doesn't just have a security bug — it leaks one business's financial data to another.

Other critical points:
- No secrets in code, `.env` committed to git, or client-side bundles
- Draft/execute tools are not network-reachable — enforced at the architecture level, not just authorization logic
- The `actions` table is append/update-only: no deletes through any API path (audit trail integrity)
- Rate-limit `mrmart_approve_action` — a compromised session must not be able to mass-approve fraudulent actions

---

## Current Build Status

| Stage | Status | What was done |
|---|---|---|
| **Stage 0** | ✅ Complete | Monorepo scaffold, 11 Postgres migrations (multi-tenant from `accounts`), MCP server with all 18 tools (mock data), Backend health endpoint, Worker BullMQ skeleton, docker-compose, README |
| **Stage 1** | ✅ Complete | Auto-Reorder: real Postgres queries (pg), deterministic formulas, guardrails (`capped_by_storage_limit`, `requires_second_confirmation`, duplicate prevention), formula unit tests, Redis queue execution |
| **Stage 2** | ✅ Complete | Cockpit UI (React Native / Expo): Approval Queue, Stock Pulse, Sales Pulse, Today's Money screens wired to real Stage 1 backend, Cherry Bold palette, 56dp touch targets, visual guardrail badges. *Tech debt cleared in Stage 3: D-1..D-10 remediated.* |
| **Stage 3** | ✅ Complete | AI Operational & Customer Automations (doc 03 §2–7): Expiry Markdown, Expiry Write-off, Shelf Restock Task, Slow-Mover Liquidation, Supplier Follow-up, Day-Close Reconciliation. All 7 draft tools fully wired to Postgres & Worker schedulers. 30/30 unit tests passing. |
| **Stage 4** | ✅ Complete | Infrastructure Hardening & Cross-Container Resilience (doc 04 & doc 10): Docker Compose healthchecks (`pg_isready`, `redis-cli ping`, native fetch probes), BullMQ exponential retries (3 attempts, 1s backoff), DLQ state transitions (`status = 'failed'`), `executeActionWithLockDb` idempotency, Cockpit UI retry triggers, and 4/4 fault injection tests passing (`verify-stage4.ts`). |
| **Stage 5** | ✅ Complete | Authentication, Authorization & Multi-Store RBAC (doc 05 & doc 10): `012_rbac_auth.sql` migration (`users`, `store_users`, `api_tokens`), `validateApiTokenDb`, `canApproveAction` role permission enforcement (`owner`, `manager`, `staff`), `requireAuth` Express middleware (`401 Unauthorized`), API endpoint protection (`403 Forbidden` on role failure), multi-tenant `store_id` isolation, 3/3 verification tests passing (`verify-stage5.ts`), and 6/6 security penetration audit attack vectors passing (`verify-stage5-security-audit.ts`). |
| **Stage 6** | ✅ Complete | External System Integrations & Hardware I/O (doc 06 & doc 10): `pos-adapter.ts` (POS/ERP inventory balance sync & electronic shelf tag updates), `supplier-adapter.ts` (Purchase Order JSON formatting & HTTP 201 dispatch), `notification-adapter.ts` (Webhook alerts with deep-links & staff push notifications), `execute.ts` refactored to live integration adapters, and 3/3 verification tests passing (`verify-stage6.ts`). |
| **Stage 7** | ✅ Complete | Onboarding + Computer Vision & Camera Ingestion (doc 01 §10 & doc 10 Stage 7): First-run flow (`/api/onboarding` phone+OTP signup, store setup, catalog setup, supplier setup, WhatsApp connection, smart defaults), `vision-adapter.ts` (shelf stockout detection & queue congestion processing), `013_vision_queue_alert.sql` migration, `POST /api/webhooks/vision/shelf` & `POST /api/webhooks/vision/queue` endpoints, `verify-stage7.ts` (3/3 passing), and zero-seed onboarding to live Approval Card DoD verified (`verify-stage7-onboarding.ts`). Doc 07 reference corrected to doc 01 §10 (doc 07 is Testing & QA Plan). |
| **Reconciliation** | ✅ Complete | Pre-Stage 8 Reconciliation Pass: Verified Cockpit UI palette (#990011 & #D7263D) & 56dp touch targets (`verify-stage2-visual.ts`), all 7 original automations & guardrails + 8th Queue Alert (`verify-stage3.ts`), separate Backend/Worker service infra with retry/metrics (`verify-stage4.ts`), Stage 5 multi-tenant isolation & RBAC (6/6 vectors passing in `verify-stage5-security-audit.ts`), Stage 6 integration status audit, and Stage 7 zero-seed onboarding DoD (`verify-stage7-onboarding.ts`). |
| **Stages 8–10** | ⏳ Pending Stage 8 prompt | SaaS Billing & Multi-Tenant Licensing (doc 09 & doc 10). |

---

## License

License TBD. All rights reserved pending commercial launch decision.
