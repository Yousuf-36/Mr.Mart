# Mr. Mart — Onboarding & Setup Guide

How a store actually gets from "just installed the app" to "automations are running." This is what the first-run flow needs to accomplish — write the actual screens against this, keeping the same visual-first, minimal-typing principles as the rest of the product.

---

## 1. First-Run Flow (Owner)

1. **Phone number + OTP** — creates the store account (see `05_Security_and_Compliance.md` Section 1).
2. **Store basics** — name, language for the few text labels, timezone (for day-close scheduling). Minimal typing: name can be voice-entered or typed once, everything else is a tap-to-select list.
3. **Product catalog setup** — the highest-friction step, so give three options, not one:
   - **Photograph shelves** (Phase 1.5, CV-assisted): owner walks the aisles taking photos, system extracts candidate products for confirmation.
   - **Supplier catalog import** (v1): if a supplier can provide a product list/price sheet, import and match by name/barcode.
   - **Manual quick-add** (v1 fallback): photo + name + starting quantity, one product at a time, big "add another" button — accept that this is slow and let the owner do it in short bursts rather than one long session.
4. **Supplier setup** — name, WhatsApp number, and which products they supply (can be as coarse as "all Dairy" to start, refined later). This directly powers Auto-Reorder and Supplier Follow-up.
5. **Thresholds — smart defaults, not a form.** Do **not** show the owner the `settings` table from `04_Database_Schema.md` as a settings form on day one. Ship with the defaults from `03_Automation_Rules_and_Business_Logic.md` (safety factor 1.3, markdown curve, discrepancy threshold ₹200, etc.) silently applied. Surface an editable settings screen only in Phase 1.5+, once the owner has enough experience with the automations to know what to adjust — asking them to tune a `safety_factor` on day one violates the "no forms" design principle for no real benefit.
6. **Staff accounts (optional)** — add staff by phone number if the store has help; skippable, defaults to owner-only.
7. **Connect WhatsApp Business number** — for both owner notifications and (if the owner consents) automated supplier messaging. This is a real setup step with real friction (WhatsApp Business API onboarding) — budget for it explicitly, don't assume it's instant.
8. **First automation run** — after setup, don't make the owner wait for the nightly reorder-point calculation to see value. Run an immediate first pass so at least a few Approval Cards appear right away, even if provisional ("first estimate, will refine after a few days of real sales data").

## 2. What "Done" Looks Like

Onboarding is complete when:
- At least one product exists with enough data to compute a `reorder_point`.
- At least one supplier is linked to at least one product.
- The owner has seen and acted on at least one real Approval Card (ideally during a guided first session, not left to discover the Approval Queue on their own).

## 3. Data Quality Notes

- **Reorder points computed from `avg_daily_sales` need real sales history to mean anything.** For the first ~14 days of a new SKU, the formula in `03_Automation_Rules_and_Business_Logic.md` has thin data — flag these draft cards as "early estimate" (small visual marker, not a paragraph) so the owner calibrates trust appropriately rather than being surprised by an inaccurate early suggestion.
- **Barcode/photo matching won't be perfect on day one.** Build in an easy manual-correct path (tap a product photo → "not this item" → quick re-match) rather than assuming catalog import is one-shot-perfect.

## 4. Post-Onboarding: Ongoing Maintenance (Owner-Facing, Later Phases)

Not v1, but worth naming so it's not forgotten:
- Editing thresholds once the owner has opinions (Phase 1.5+ settings screen).
- Adding/retiring products as the store's range changes.
- Adding a second staff member or a second store (Phase 2, multi-store).

## 5. Internal Setup Checklist (Engineering/Ops side, per new store)

- [ ] Store row created, `settings` row seeded with defaults
- [ ] WhatsApp Business API number provisioned/verified for this store
- [ ] Supplier(s) contact info verified reachable (a quick test message) before Auto-Reorder is allowed to draft anything for that supplier
- [ ] Prometheus dashboard confirms the new store's scheduled trigger-checks are running (heartbeat visible) within 24h of go-live