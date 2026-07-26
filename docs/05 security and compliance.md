# Mr. Mart — Security & Compliance

This product executes real-world, money-affecting actions (orders, price changes, write-offs) on the owner's behalf. Security here isn't boilerplate — a compromised account could place fraudulent orders or hide theft in the audit trail. Treat this doc as a checklist for security requirements, not just background reading.

---

## 1. Authentication

- **Owner login:** phone number + OTP (via WhatsApp or SMS) — no passwords to forget, matches the "minimal typing" design principle. Session issued as a short-lived JWT (e.g. 1 hour) + refresh token.
- **Staff accounts:** same OTP pattern, scoped role (`staff`) — can only act on Shelf Restock Tasks assigned to them (mark done), cannot approve/reject any financial automation (`reorder`, `markdown`, `writeoff`, `day_close`). Enforce this server-side on every `mrmart_approve_action`/`mrmart_reject_action` call, not just by hiding the button in the UI.
- **Session binding:** tie sessions to device where practical (store owners typically use one phone) — makes a stolen/leaked token less useful.

## 2. Authorization (per MCP tool category)

| Tool category | Who can call it |
|---|---|
| Read (`mrmart_get_*`) | owner, staff (both roles can view monitoring screens) |
| Decide (`mrmart_approve_action`, `mrmart_reject_action`) | **owner only**, except restock-task type actions which staff may also approve |
| Draft (`mrmart_draft_*`) | system/Worker only — never callable from the app, not exposed on the public Backend endpoint at all |
| Execute (`mrmart_execute_*`) | system/Worker only, and only ever invoked internally from `mrmart_approve_action` (see MCP spec's "golden rule") |

Enforce this as a hard boundary at the network level too: draft/execute tools should not even be reachable on the Backend's public HTTP surface — they exist only inside the Worker process (per the infra architecture in the Project Instructions doc), so there's no endpoint to attack even if authorization logic had a bug.

## 3. Data Classification & Handling

| Data | Sensitivity | Handling |
|---|---|---|
| Owner/staff phone numbers | PII | Encrypted at rest (RDS/Neon native encryption), never logged in plaintext in application logs |
| Supplier contact info | PII (business) | Same as above |
| Sales transaction data | Business-sensitive | No customer-level PII in v1 (no customer accounts) — low risk, but still access-controlled to store owner |
| `actions` payload (order values, prices) | Business-sensitive | Immutable audit trail — access-controlled, never exposed publicly |
| WhatsApp/API credentials | Secret | AWS Secrets Manager (or equivalent) — never in source control, never in plain environment files committed to a repo |

## 4. Transport & Storage Security

- TLS everywhere: Frontend↔Backend, Backend↔Database, Backend↔Redis (Redis Cloud supports TLS — enable it), Worker↔external APIs (WhatsApp, POS, supplier).
- Database encryption at rest — both RDS and Neon.tech support this natively; enable it, don't leave it on defaults unchecked.
- Redis Cloud: use its access-control/ACL features to scope the queue credentials the Worker uses separately from any cache credentials the Backend uses, if traffic patterns ever diverge enough to warrant it.

## 5. Secrets Management

- No secrets in code, `.env` files committed to git, or client-side bundles.
- Use AWS Secrets Manager (or SSM Parameter Store) for: DB connection strings, Redis credentials, WhatsApp Business API tokens, any POS/supplier API keys.
- Rotate the WhatsApp Business API token and DB credentials on a schedule (e.g. quarterly) once the product is live — put this in the DevOps runbook as a recurring task, not a one-time setup step.

## 6. Rate Limiting & Abuse Prevention

- Rate-limit `mrmart_approve_action`/`mrmart_reject_action` per session (e.g. 30/minute) — generous for a real owner tapping through cards, but stops a compromised session from mass-approving fraudulent actions faster than a human could notice.
- Rate-limit OTP requests per phone number to prevent SMS/WhatsApp bombing.
- Log (but don't block) unusual approval velocity — e.g. 10 reorders approved in 10 seconds — as a signal worth a Prometheus alert (ties into the DevOps doc's alert list).

## 7. Audit & Non-Repudiation

- The `actions` table (see `04_Database_Schema.md`) is append/update-only, records `decided_by`, `decided_at` — this is the mechanism that lets an owner (or you, supporting them) answer "did I actually approve that ₹8,000 order?" with certainty.
- Never allow a hard delete of an `actions` row through any API path, including admin tooling — soft-state changes only (`rejected`, `failed`, etc.).

## 8. Compliance Notes

- **No PCI scope in v1:** the product doesn't process card payments directly — POS handles payment capture, this system only reads sales totals. If a payment gateway is integrated later (e.g. for supplier payments), use a tokenizing provider and never store raw card data — re-scope this doc at that point.
- **Data residency:** if operating in India, confirm whether local data-residency requirements (e.g. RBI guidance for payment-adjacent data, though this product itself isn't a payment processor) apply once real financial integrations are added — flag as a legal-review item before Phase 2, not a v1 blocker.
- **WhatsApp Business API terms:** automated supplier messages must comply with WhatsApp's business messaging policies (template approval for the first outbound message in a 24h window, opt-in from suppliers) — build the Supplier Follow-up automation's messaging within an already-open conversation window where possible to avoid template-approval friction.

## 9. Open Items

- [ ] Confirm staff-approval scope for Shelf Restock Tasks is actually wanted, vs. owner-only approval for everything including restock (simpler, but adds owner friction for a low-risk action)
- [ ] Confirm whether a second owner/manager account is needed for multi-person stores in v1, or deferred to Phase 2 multi-store work
- [ ] Confirm OTP delivery channel preference (WhatsApp vs SMS) based on target region's WhatsApp Business API costs and reliability