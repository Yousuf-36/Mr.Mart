# Mr. Mart — DevOps, Deployment & Monitoring Runbook

Maps the infra architecture in `01_Project_Instructions.md` Section 8 to actual environments, pipelines, and on-call behavior.

---

## 1. Environments

| Environment | Purpose | Notes |
|---|---|---|
| **dev** | local development environment, using the mock-data MCP server scaffold | no real AWS resources; run everything in one process |
| **staging** | integration testing against real (but sandboxed) external APIs | separate AWS account/VPC recommended; WhatsApp Business API sandbox, test Postgres branch (Neon makes this trivial — branch per PR) |
| **prod** | live store(s) | full topology: Backend + Worker as separate services, Redis Cloud, RDS/Neon prod instance, Prometheus scraping both |

## 2. CI/CD

- **Pipeline:** GitHub Actions (or equivalent) — on PR: lint, typecheck (`tsc`), unit tests (see `07_Testing_QA_Plan.md`), build. On merge to `main`: deploy to staging automatically; deploy to prod on manual approval/tag.
- **Infra as code:** Terraform or AWS CDK for all AWS resources (ECS/Fargate services, RDS if used, IAM roles, Secrets Manager entries) — no manual console changes to prod infra once past initial setup.
- **Deploy unit:** Backend and Worker are separate deployable services (separate ECS task definitions or Lambda functions) even though they may share the same codebase/repo — this lets a Worker deploy (e.g. a new automation) roll out without touching the Backend's uptime, and vice versa.
- **Database migrations:** run as a separate pipeline step before the new Backend/Worker version goes live, using a migration tool (e.g. `node-pg-migrate`, Prisma Migrate) — never hand-run SQL against prod.

## 3. Deployment Strategy

- **Backend:** rolling/blue-green deploy behind an ALB — zero-downtime, since the cockpit app should never see a failed request during a deploy.
- **Worker:** can tolerate brief downtime during deploy (jobs queue in Redis and get picked up once the new version is healthy) — simpler rolling deploy is fine here.
- **Rollback:** keep the previous ECS task definition revision one click away; rollback trigger is any Prometheus alert firing within 15 minutes of a deploy (see Section 5).

## 4. Backups & Recovery

- **Database:** automated daily backups + point-in-time recovery (native to both RDS and Neon.tech — enable and verify, don't assume it's on by default).
- **Redis:** treat as ephemeral — queue jobs are re-derivable from `actions` table state (a `pending` action with no queued job can be re-enqueued by a reconciliation sweep), so Redis Cloud's own persistence is a nice-to-have, not the backup strategy.
- **Recovery drill:** before going live with a real store, actually restore a backup into a scratch environment once and confirm the app boots against it — don't find out backups are broken during a real incident.

## 5. Monitoring & Alerting (Prometheus)

This is the safety net referenced throughout the other docs — an automation system that fails silently is worse than no automation at all, because the owner stops checking manually once they trust it.

**Metrics to track:**
| Metric | Why |
|---|---|
| Job queue depth (Redis) | backlog building up = Worker is falling behind or down |
| Job success/failure rate, per automation type | a spike in `reorder` failures might mean the WhatsApp API integration broke |
| Job execution latency, per automation type | slow executes eventually become failures |
| Draft-cycle heartbeat (last successful scheduled trigger-check run) | silence here means the whole automation engine stopped, not just one job |
| Approval Queue size (pending actions) | a growing queue with no owner activity might mean notifications aren't reaching them |
| API error rates from Backend (4xx/5xx) | standard service health |

**Alert thresholds (starting points, tune after real usage data):**
- Job failure rate > 10% over 15 min → page
- No successful draft-cycle heartbeat in 30 min → page (the engine may be fully down)
- Queue depth > 100 and rising for 10 min → page
- Any `day_close` job failure → page immediately (financial reconciliation, high owner-trust impact)

**On a failed execute job:**
1. Retry with exponential backoff, 3 attempts (per `02_MCP_Server_Spec.md`'s note on execute tools).
2. If still failing, mark the action `failed` with a `failure_reason`, and re-surface the card to the owner in a visibly different (error) state rather than silently dropping it — per the Approval Card rules in the Project Instructions doc, a card never disappears silently.
3. On-call investigates the underlying integration failure (e.g. WhatsApp API outage) separately from the individual failed action — the owner-facing fix (re-approve) and the engineering fix (repair the integration) are different tracks.

## 6. Secrets & Credential Rotation

- Rotate DB credentials and the WhatsApp Business API token quarterly (see `05_Security_and_Compliance.md` Section 5) — schedule this as a recurring calendar task, not something that happens "eventually."

## 7. Scaling Notes (for when it's needed, not v1 day one)

- Backend: stateless, scales horizontally behind the ALB trivially.
- Worker: scale consumer count with queue depth — most job queue libraries (BullMQ) support this natively via concurrency settings.
- Database: Neon.tech's serverless autoscaling is attractive here for a single/few-store early product with spiky, low-average load; move to RDS with provisioned capacity once usage is steady and predictable enough to right-size.