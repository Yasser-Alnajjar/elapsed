import type { PlanId } from "@sla/db/plans";

/**
 * Billing types shared by the tenant `/billing` page and the platform-admin
 * billing console. Provider-agnostic on purpose: nothing here names a payment
 * provider, so a real billing integration can fill the same shapes later.
 * Amounts are integer minor units (cents); dates are ISO strings.
 */

export type BillingTone = "neutral" | "primary" | "success" | "warning" | "danger";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "internal";

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  cancelled: "Cancelled",
  internal: "Internal",
};

export const SUBSCRIPTION_STATUS_TONES: Record<SubscriptionStatus, BillingTone> = {
  trialing: "warning",
  active: "success",
  past_due: "danger",
  cancelled: "neutral",
  internal: "neutral",
};

export type BillingInterval = "month" | "year";

export type InvoiceStatus = "paid" | "open" | "failed" | "refunded" | "void";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  paid: "Paid",
  open: "Open",
  failed: "Failed",
  refunded: "Refunded",
  void: "Void",
};

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, BillingTone> = {
  paid: "success",
  open: "primary",
  failed: "danger",
  refunded: "neutral",
  void: "neutral",
};

export type PaymentMethodKind = "card" | "bank_account";
export type PaymentMethodState = "valid" | "expiring" | "declined";

export interface PaymentMethod {
  kind: PaymentMethodKind;
  /** "Visa", "Mastercard", "ACH". */
  brand: string;
  last4: string;
  /** Null for a bank account. */
  expMonth: number | null;
  expYear: number | null;
  state: PaymentMethodState;
  holderName: string | null;
}

export interface SubscriptionSummary {
  planId: PlanId;
  planName: string;
  status: SubscriptionStatus;
  interval: BillingInterval;
  /** Recurring price per interval; null for a custom-priced plan. */
  amountCents: number | null;
  currency: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** When the next period starts and is charged; null once cancellation is scheduled or the subscription has ended. */
  renewsAt: string | null;
  trialEndsAt: string | null;
  subscribedSince: string;
  cancelAtPeriodEnd: boolean;
  /** When the subscription ended (cancelled). */
  endedAt: string | null;
  /** A downgrade that applies at the end of the current period. */
  pendingPlan: { id: PlanId; name: string } | null;
  seatQuantity: number;
  /** Optimistic-concurrency token: every change sends back the version the page saw. */
  version: number;
}

/** The organization's trial, when it has no subscription yet. */
export interface TrialState {
  endsAt: string | null;
  expired: boolean;
}

/** Seats in use against the licensed count and the plan's ceiling. */
export interface SeatUsage {
  used: number;
  /** Seats licensed on the subscription; null without one. */
  licensed: number | null;
  /** The plan's seat limit; null is unlimited or no plan. */
  planLimit: number | null;
  /** Bounds a seat change must stay within. */
  min: number;
  max: number;
}

/** Events ingested from connected sources this period. Plans do not meter events, so there is no limit. */
export interface EventThroughput {
  used: number;
  dailyAverage: number;
}

export type EntitlementValue =
  | { kind: "quota"; used: number; limit: number | null; unit: string }
  | { kind: "tags"; values: string[] }
  | { kind: "text"; value: string; secondary?: string };

export interface PlanEntitlement {
  id: string;
  label: string;
  description: string;
  included: boolean;
  value: EntitlementValue;
}

export interface InvoiceLineItem {
  label: string;
  detail: string;
  /** Null renders as "Included". */
  amountCents: number | null;
}

export interface UpcomingInvoice {
  planName: string;
  amountCents: number | null;
  currency: string;
  nextAttemptAt: string;
  lineItems: InvoiceLineItem[];
}

export interface UsageDay {
  date: string;
  events: number;
  projected: boolean;
}

export interface BillingInvoice {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  description: string;
  detail: string;
  /** A noteworthy detail (proration) is highlighted. */
  detailHighlighted: boolean;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  /** How it was or will be settled: "Direct invoice", "Recorded payment". */
  paymentMethodLabel: string;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  /** Shown on hover; never a secret. */
  reference: string;
}

export interface BillingProfile {
  billingEmail: string | null;
  legalName: string | null;
  addressLines: string[];
  /** ISO country or subdivision code, e.g. `US-CA`. */
  country: string | null;
  taxId: string | null;
  ccEmails: string[];
}

export interface PlanOption {
  id: PlanId;
  name: string;
  /** "$149" or "Custom". */
  priceLabel: string;
  summary: string;
  current: boolean;
  /** Scheduled to take over at the end of the period. */
  pending: boolean;
  /** Customers can switch to it themselves; Enterprise is by contract. */
  selfServe: boolean;
  /** Why it cannot be chosen now (seats in use exceed its limit), or null. */
  unavailableReason: string | null;
  /** How the change would apply: now (upgrade, trial) or at period end (downgrade). */
  effect: "now" | "period_end" | null;
}

export interface TierRecommendation {
  planId: PlanId;
  planName: string;
  pitch: string;
  features: string[];
  ctaLabel: string;
  selfServe: boolean;
}

export interface BillingOverviewData {
  organizationName: string;
  /** Owners manage billing; members see it read-only. */
  canManage: boolean;
  /** Whether a payment provider is connected (portal, payment methods, invoice PDFs). */
  providerAvailable: boolean;
  /** An internal organization is never billed, so it has no plan to choose. */
  internal: boolean;
  asOf: string;
  /** Null until a plan is chosen. */
  subscription: SubscriptionSummary | null;
  trial: TrialState | null;
  /** The plan entitlements are read from: the subscription's, else the recorded plan, else null. */
  effectivePlan: { id: PlanId; name: string } | null;
  seats: SeatUsage;
  events: EventThroughput;
  /** Payment methods live with the provider; null without one. */
  paymentMethod: PaymentMethod | null;
  entitlements: PlanEntitlement[];
  upcomingInvoice: UpcomingInvoice | null;
  usage: UsageDay[];
  recommendation: TierRecommendation | null;
  planOptions: PlanOption[];
  invoices: BillingInvoice[];
  profile: BillingProfile;
}

export const BILLING_TABS = ["overview", "invoices", "payment"] as const;
export type BillingTab = (typeof BILLING_TABS)[number];

export const BILLING_TAB_LABELS: Record<BillingTab, string> = {
  overview: "Overview & Entitlements",
  invoices: "Invoices & History",
  payment: "Payment Details & Tax ID",
};

export function isBillingTab(value: unknown): value is BillingTab {
  return typeof value === "string" && (BILLING_TABS as readonly string[]).includes(value);
}
