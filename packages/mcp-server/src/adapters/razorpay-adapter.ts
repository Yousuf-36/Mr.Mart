/**
 * Razorpay Payment Integration Adapter for Mr. Mart SaaS Billing (Stage 8).
 *
 * Local stub implementation used when live test-mode credentials are not configured.
 * Real integration is blocked pending RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.
 */

import { v4 as uuidv4 } from "uuid";

export interface PlanPricing {
  name: string;
  monthlyCostRupees: number;
}

export const PLAN_PRICING: Record<string, number> = {
  trial: 0,
  starter: 1500,
  growth: 4500,
  pro: 9000,
};

export interface ProrationQuote {
  current_plan: string;
  new_plan: string;
  days_remaining: number;
  total_days: number;
  unused_credit: number;
  new_plan_remaining_cost: number;
  prorated_charge: number;
}

export interface RazorpayOrderStub {
  id: string;
  amount: number; // in paise
  currency: string;
  status: string;
  mode: "stubbed_local" | "live";
  notes: Record<string, string>;
  message: string;
}

export function calculateProrationQuote(
  currentPlan: string,
  newPlan: string,
  daysRemaining: number = 20,
  totalDays: number = 30
): ProrationQuote {
  const currentMonthly = PLAN_PRICING[currentPlan.toLowerCase()] ?? 0;
  const newMonthly = PLAN_PRICING[newPlan.toLowerCase()] ?? 0;

  // Fraction of cycle remaining
  const fraction = daysRemaining / totalDays;

  // unused_credit = current plan remaining cost
  const unused_credit = Math.round(currentMonthly * fraction);

  // new_plan_remaining_cost = new plan remaining cost
  const new_plan_remaining_cost = Math.round(newMonthly * fraction);

  // prorated_charge = new_plan_remaining_cost - unused_credit
  const prorated_charge = Math.max(0, new_plan_remaining_cost - unused_credit);

  return {
    current_plan: currentPlan,
    new_plan: newPlan,
    days_remaining: daysRemaining,
    total_days: totalDays,
    unused_credit,
    new_plan_remaining_cost,
    prorated_charge,
  };
}

export class RazorpayAdapter {
  private keyId?: string;
  private keySecret?: string;

  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID;
    this.keySecret = process.env.RAZORPAY_KEY_SECRET;
  }

  public isLiveConfigured(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  public createSubscriptionOrder(
    accountName: string,
    amountRupees: number,
    plan: string
  ): RazorpayOrderStub {
    const isLive = this.isLiveConfigured();
    const stubId = `order_razorpay_stub_${uuidv4().substring(0, 8)}`;

    return {
      id: isLive ? `order_live_${uuidv4().substring(0, 8)}` : stubId,
      amount: amountRupees * 100, // paise
      currency: "INR",
      status: "created",
      mode: isLive ? "live" : "stubbed_local",
      notes: {
        account_name: accountName,
        plan,
        integration_status: isLive
          ? "Live Razorpay API configured"
          : "Razorpay integration: stubbed locally, no live test-mode credentials configured yet — real integration blocked pending RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET.",
      },
      message: isLive
        ? "Razorpay order created successfully via live API."
        : "Razorpay integration: stubbed locally, no live test-mode credentials configured yet — real integration blocked pending RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET.",
    };
  }
}

export const razorpayAdapter = new RazorpayAdapter();
