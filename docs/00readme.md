# Mr. Mart — Documentation Index

**AI Automation Solution for Mini Supermarkets.** Approve-then-execute: background automations draft actions, the owner taps once to approve or reject, the system executes.

This is the full doc set. Read in this order the first time; after that, pull the specific doc a given prompt needs.

| # | Doc | What it's for |
|---|---|---|
| 01 | **Project_Instructions.md** | The master spec — product vision, the approve-then-execute core loop, Approval Card UI pattern, the 7 automations, cockpit screens, red design system, infrastructure architecture (Frontend/Backend/DB/Redis/Worker/Prometheus) |
| 02 | **MCP_Server_Spec.md** | The data/action contract — every MCP tool (read, draft, decide, execute), the golden rule that only `mrmart_approve_action` may trigger execution, example tool code, and how tool categories map to Backend vs. Worker |
| 03 | **Automation_Rules_and_Business_Logic.md** | The actual math — trigger conditions, formulas, and guardrails for all 7 automations. This is what the Worker computes; read this before touching any drafting logic |
| 04 | **Database_Schema.md** | Full Postgres schema — every table, column, index, and relationship, including the `actions` audit trail and the `settings` table that holds every configurable threshold from doc 03 |
| 05 | **Security_and_Compliance.md** | Auth, authorization per tool category, data classification, secrets management, rate limiting, audit/non-repudiation, and compliance notes (PCI scope, WhatsApp Business API terms) |
| 06 | **DevOps_Deployment_Runbook.md** | Environments, CI/CD, deploy strategy, backups, and the Prometheus alert list + on-call runbook for when an automation fails silently |
| 07 | **Testing_QA_Plan.md** | What "tested" means for a system that spends real money — unit tests on formulas, integration tests on the full draft→approve→execute chain, load tests, security tests, and a UAT plan |
| 08 | **Onboarding_Setup_Guide.md** | The first-run flow a real store owner goes through, from phone number to their first real Approval Card |
| 09 | **SaaS_Business_Model.md** | Plan structure, billing mechanics, the superadmin console for running Mr. Mart as a licensed product across multiple mart owners, and the self-serve signup flow that wraps around doc 08 |
| 10 | **Master_Build_Prompt.md** | The actual prompt(s) for the build agent — a staged build plan with gates, referencing every doc above at the point it's needed |
| 11 | **MCP_Server_Config.md** | How to connect to the running Mr. Mart MCP server (local dev config, prod config, the `serverUrl` vs `url` gotcha) so its tools are callable from the agent panel while building |
| 09 | **MCP_Server_Config.md** | The actual `mcp_config.json` for MCP clients (local + prod), how/where to install it |
| — | **mcp-server/** (code) | Working TypeScript scaffold: read tools + one full draft→approve→execute chain (`mrmart_draft_reorder`) as the reference pattern to clone for the other 6 automations |
| — | **mcp-config/** | Ready-to-paste `mcp_config.json` files for MCP clients (local + prod) |
| — | **Mr_Mart_UIUX_Concept.pptx** | Visual concept deck (red theme). |

---

## How to Use This Document Set

1. **Always reference doc 01 (or the relevant section) first** — it's the constraint layer every other doc sits inside.
2. **Building an automation?** Read docs 01 (§4-5, Approval Card + automations table), 02 (relevant tool rows), and 03 (that automation's exact formula) together.
3. **Building the schema/backend?** Read doc 04 directly as the migration spec, doc 02 for what each table needs to support.
4. **Building auth or anything approval-related?** Read doc 05 — the staff-vs-owner authorization split is essential.
5. **Setting up infra/CI?** Read doc 06 alongside doc 01 §8 (infrastructure architecture).
6. **Writing tests for anything?** Read doc 07's relevant section alongside whatever doc defines the feature being tested.
7. **Building the first-run screens?** Read doc 08.

**One doc at a time beats all docs at once.**

---

## Open Items Tracker

Pulled from across the docs — resolve before considering v1 "spec complete":

- [ ] Base LLM/model choice for the Worker's judgment-heavy drafting (wording, not arithmetic) — (doc 01 §10)
- [ ] Target platform: Android-only vs Android+iOS — (doc 01 §10)
- [x] Shelf Restock Task camera detection: v1 implemented per doc 01 §10 & doc 10 Stage 7 (doc 07 mislabeling corrected to doc 01 §10; doc 07 is Testing & QA Plan)
- [ ] Regional language(s) for the unavoidable text labels — (doc 01 §10)
- [ ] RDS vs Neon.tech — (doc 01 §10)
- [ ] Self-hosted vs managed Prometheus — (doc 01 §10)
- [ ] Backend/Worker split from day one, or start merged — (doc 01 §10)
- [ ] Staff approval scope for Shelf Restock Tasks — (doc 05 §9)
- [ ] Multi-person owner/manager accounts in v1? — (doc 05 §9)
- [ ] OTP delivery channel: WhatsApp vs SMS — (doc 05 §9)
- [ ] UI/UX deck refresh around Approval Cards — (this doc, above)