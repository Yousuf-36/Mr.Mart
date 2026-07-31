/**
 * SaaS Billing & Subscription Management Express Router (Stage 8).
 * Handles plan tier queries, proration math, degraded account state transitions,
 * and Razorpay payment order stubbing.
 */

import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  getAccountSubscriptionDetails,
  setAccountStatusDb,
  updateAccountPlanDb,
} from "@mrmart/mcp-server/store/pg-store.js";
import {
  calculateProrationQuote,
  razorpayAdapter,
} from "@mrmart/mcp-server/adapters/razorpay-adapter.js";

const billingRouter = Router();

// GET /api/billing/subscription — Fetch current account plan & subscription status
billingRouter.get("/subscription", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.user!.store_id;
    const details = await getAccountSubscriptionDetails(storeId);
    if (!details) {
      res.status(404).json({ error: "Subscription details not found for store" });
      return;
    }

    res.json({
      success: true,
      subscription: {
        account_id: details.account_id,
        account_name: details.account_name,
        plan: details.plan,
        status: details.account_status,
        trial_ends_at: details.trial_ends_at,
        billing_provider: details.billing_provider ?? "razorpay",
        razorpay_stub: {
          is_live: razorpayAdapter.isLiveConfigured(),
          note: "Razorpay integration: stubbed locally, no live test-mode credentials configured yet — real integration blocked pending RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET.",
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/billing/upgrade — Proration quote & Razorpay order generation
billingRouter.post("/upgrade", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.user!.store_id;
    const { new_plan, days_remaining, total_days } = req.body;

    if (!new_plan || !["starter", "growth", "pro"].includes(new_plan)) {
      res.status(400).json({ error: "Invalid target plan. Must be 'starter', 'growth', or 'pro'" });
      return;
    }

    const details = await getAccountSubscriptionDetails(storeId);
    if (!details) {
      res.status(404).json({ error: "Subscription details not found" });
      return;
    }

    const daysRem = days_remaining !== undefined ? parseInt(days_remaining, 10) : 20;
    const daysTot = total_days !== undefined ? parseInt(total_days, 10) : 30;

    const proration = calculateProrationQuote(details.plan, new_plan, daysRem, daysTot);

    const razorpayOrder = razorpayAdapter.createSubscriptionOrder(
      details.account_name,
      proration.prorated_charge,
      new_plan
    );

    res.json({
      success: true,
      proration: {
        current_plan: proration.current_plan,
        new_plan: proration.new_plan,
        days_remaining: proration.days_remaining,
        total_days: proration.total_days,
        unused_credit: proration.unused_credit,
        new_plan_remaining_cost: proration.new_plan_remaining_cost,
        prorated_charge: proration.prorated_charge,
      },
      payment_order: razorpayOrder,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/billing/simulate-status — Simulate degraded / past_due state transition
billingRouter.post("/simulate-status", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.user!.store_id;
    const { status } = req.body;

    if (!status || !["active", "past_due", "degraded", "cancelled"].includes(status)) {
      res.status(400).json({ error: "Invalid status parameter" });
      return;
    }

    const details = await getAccountSubscriptionDetails(storeId);
    if (!details) {
      res.status(404).json({ error: "Account details not found" });
      return;
    }

    await setAccountStatusDb(details.account_id, status);

    res.json({
      success: true,
      account_id: details.account_id,
      status,
      message: `Account status updated to '${status}'.`,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/billing/reactivate — Upgrade / reactivate account from degraded state
billingRouter.post("/reactivate", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.user!.store_id;
    const { plan } = req.body;

    const targetPlan = plan || "growth";
    const details = await getAccountSubscriptionDetails(storeId);
    if (!details) {
      res.status(404).json({ error: "Account details not found" });
      return;
    }

    await updateAccountPlanDb(details.account_id, targetPlan);

    res.json({
      success: true,
      account_id: details.account_id,
      plan: targetPlan,
      status: "active",
      message: `Account successfully reactivated on ${targetPlan} plan.`,
    });
  } catch (err) {
    next(err);
  }
});

export default billingRouter;
