# Mr. Mart — SaaS Business Model & Admin Console

Mr. Mart is licensed to independent mart owners as a subscription product. This doc defines the plan structure, billing mechanics, and the superadmin console needed to run it as a business — separate from the store-facing product covered in the other docs.

---

## 1. Plan Structure (starting point — tune after pilot pricing feedback)

| Plan | Who it's for | What's included | Suggested price point |
|---|---|---|---|
| **Trial** | Every new signup | Full feature access, 14 days, one store | Free |
| **Starter** | Single-store owner | Core 7 automations, 1 store, WhatsApp notifications | Lowest paid tier |
| **Growth** | Growing single store or small chain | Everything in Starter + Shelf Restock (camera/CV) + up to 3 stores | Mid tier |
| **Pro** | Small chains | Everything in Growth + unlimited stores, priority WhatsApp API throughput, priority support | Highest tier |

Keep the plan **gate at the account/store-count and feature level, not at automation quality** — never give a paying customer a deliberately worse markdown formula than a free trial. Trust in the drafts is the entire product; don't undermine it to upsell.

## 2. Billing Mechanics

- **Provider:** Stripe or Razorpay (Razorpay if the primary market is India — better local payment method support: UPI, netbanking).
- **Billing cycle:** monthly, auto-renew, card/UPI-mandate on file.
- **Trial → paid conversion:** on `trial_ends_at`, if no payment method on file, downgrade access gracefully (read-only cockpit, automations paused) rather than a hard cutoff — a store owner losing all data access instantly creates support fires and bad word-of-mouth in a market that runs on trust and referrals.
- **Failed payment (`past_due`):** grace period (e.g. 5 days) with in-app + WhatsApp reminders before downgrading — same graceful-degradation principle as trial expiry.
- **Proration:** mid-cycle plan upgrades (e.g. Starter → Growth to add a second store) prorate the difference; downgrades take effect at the next billing cycle, not immediately (avoids mid-cycle feature loss disputes).

See `04_Database_Schema.md` for the `accounts`/`subscriptions` tables this maps to, and `05_Security_and_Compliance.md` Section 10 for why tenant isolation is the single most important thing to get right once this is a paid multi-tenant product.

## 3. Superadmin Console (Mr. Mart's own internal tool, not store-facing)

A separate, internal-only application (or a role-gated section of the same Backend) for the team running Mr. Mart as a business:

| Screen | What it does |
|---|---|
| **Accounts list** | Every paying account — plan, billing status, store count, signup date |
| **Account detail** | Drill into one account's stores, usage, and support history |
| **Billing health** | Trials expiring soon, past-due accounts, churned accounts this month |
| **Automation health (cross-tenant)** | Aggregated from the Prometheus metrics in `06_DevOps_Deployment_Runbook.md` — e.g. reject rates per automation type across all tenants, which is the strongest signal for whether the drafting logic (per `03_Automation_Rules_and_Business_Logic.md`) needs global tuning vs. one store's edge case |
| **Support tools** | Impersonate-a-store-owner view (heavily audited, per Security doc Section 10) for troubleshooting a specific owner's issue |

**Do not build this before the store-facing product works.** The superadmin console matters once there are enough paying accounts that manual database queries stop being a reasonable way to answer "who's about to churn" — not on day one with a handful of pilot stores.

## 4. Onboarding Changes for Self-Serve SaaS

`08_Onboarding_Setup_Guide.md` describes the store setup flow assuming an account already exists. For self-serve SaaS, prepend:

1. **Signup:** owner phone number + OTP creates the `account` row (not just a `store` row) with `plan = trial`, `trial_ends_at = now + 14 days`.
2. **First store setup:** proceeds exactly as `08_Onboarding_Setup_Guide.md` describes, now nested under that account.
3. **Trial-to-paid prompt:** surfaced as its own simple screen near the end of the trial — plan comparison, one tap to add a payment method — never buried inside the daily cockpit flow the owner actually uses for their job.

## 5. Metrics That Matter for the Business (beyond product Prometheus metrics)

- **Trial → paid conversion rate** — the core "is this worth paying for" signal.
- **Reject rate per automation, per account** (pulled from the same `actions` table) — both a product-quality signal (per `07_Testing_QA_Plan.md`) and an early churn-risk signal: an owner rejecting most drafts isn't getting value and is likely to churn.
- **Monthly churn rate, by plan** — standard SaaS health metric, but especially important here since word-of-mouth among mart owners in the same supplier network can cut both ways fast.

## 6. Open Items

- [ ] Confirm pricing per plan (region-specific — needs local market research, not guessed here)
- [ ] Confirm Stripe vs Razorpay based on target launch market
- [ ] Confirm whether multi-store accounts are a v1 SaaS feature or a Phase 2 upsell once single-store retention is proven
- [ ] Confirm support channel (WhatsApp, phone, in-app chat) for paying customers before launch