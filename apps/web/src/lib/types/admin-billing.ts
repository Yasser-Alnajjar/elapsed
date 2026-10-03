import type { PlanId } from "@sla/db/plans";
import type { BillingInvoice, BillingProfile, BillingTone, SubscriptionStatus } from "./billing";

/**
 * Platform-admin billing console types: the tenant billing directory
 * (`/admin/billing`) and one tenant's billing lifecycle
 * (`/admin/billing/[organizationId]`), read from the internal billing domain.
 * Operator-facing only.
 */

/** The plan filter: the plans Elapsed sells, plus organizations with none recorded. */
export const BILLING_PLAN_TIERS = ["enterprise", "team", "starter", "none"] as const;
export type BillingPlanTier = (typeof BILLING_PLAN_TIERS)[number];

export const BILLING_PLAN_TIER_LABELS: Record<BillingPlanTier, string> = {
  enterprise: "Enterprise",
  team: "Team",
  starter: "Starter",
  none: "No plan",
};

/** Payment health: an overdue open invoice, something ending soon (trial, scheduled cancellation), or fine. */
export const BILLING_HEALTHS = ["healthy", "expiring", "overdue"] as const;
export type BillingHealth = (typeof BILLING_HEALTHS)[number];

export const BILLING_HEALTH_LABELS: Record<BillingHealth, string> = {
  healthy: "Healthy",
  expiring: "Expiring",
  overdue: "Overdue invoice",
};

export const BILLING_SORTS = ["next_billing", "mrr_desc", "seats_desc", "delinquency", "created_desc"] as const;
export type BillingSort = (typeof BILLING_SORTS)[number];

export const BILLING_SORT_LABELS: Record<BillingSort, string> = {
  next_billing: "Next billing date (soonest)",
  mrr_desc: "MRR (high to low)",
  seats_desc: "Seats in use (desc)",
  delinquency: "Delinquency severity",
  created_desc: "Tenant creation date",
};

/** Optional table columns the operator can hide. Tenant and actions always show. */
export const BILLING_COLUMNS = ["plan", "state", "seats", "rate", "next_billing", "payment", "ingress"] as const;
export type BillingColumn = (typeof BILLING_COLUMNS)[number];

export const BILLING_COLUMN_LABELS: Record<BillingColumn, string> = {
  plan: "Plan tier",
  state: "Subscription state",
  seats: "Seats (used/licensed)",
  rate: "Billing cycle & rate",
  next_billing: "Next billing date",
  payment: "Settlement",
  ingress: "24h ingress",
};

export interface BillingNote {
  text: string;
  tone: BillingTone;
}

export interface AdminBillingTenantRow {
  /** The organization id. */
  id: string;
  name: string;
  ownerEmail: string | null;
  /** Small tag after the name: TRIAL, DUNNING, ENDING, INTERNAL. */
  tag: { label: string; tone: BillingTone } | null;
  tier: BillingPlanTier;
  planLabel: string;
  status: SubscriptionStatus;
  hasSubscription: boolean;
  cancelAtPeriodEnd: boolean;
  /** Days the oldest open invoice is past due. */
  overdueDays: number | null;
  trialDaysLeft: number | null;
  health: BillingHealth;
  seats: { used: number; licensed: number | null; planLimit: number | null };
  /** Price per month; null when custom or not subscribed. */
  rateCents: number | null;
  /** Monthly recurring revenue: the rate of an active or past-due subscription, else 0. */
  mrrCents: number;
  rateNote: BillingNote;
  nextBillingAt: string | null;
  nextBillingNote: BillingNote;
  /** Open (unpaid) invoice total. */
  openCents: number;
  /** Events ingested in the last 24 hours. */
  ingress24h: number;
  createdAt: string;
}

export interface DunningQueueItem {
  tenantId: string;
  tenantName: string;
  amountCents: number;
  overdueDays: number;
}

export interface AdminBillingOverviewData {
  asOf: string;
  currency: string;
  providerAvailable: boolean;
  tenants: AdminBillingTenantRow[];
  totals: {
    events24h: number;
    /** Invoices issued and paid in the last 90 days. */
    invoicesIssued90d: number;
    invoicesPaid90d: number;
    openCents: number;
  };
}

export interface LifecycleEvent {
  id: string;
  /** A `BillingEventType`. */
  kind: string;
  /** Which filter group it belongs to. */
  group: "payments" | "plan" | "seats" | "notes";
  tone: BillingTone;
  title: string;
  at: string;
  body: string;
  /** Who made it: an email, or "system". */
  actor: string;
}

/** The oldest overdue invoice, for the delinquency banner and the runway. */
export interface OverdueState {
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  dueAt: string;
  /** Informational: when the grace window an operator can extend closes. Nothing is locked. */
  graceEndsAt: string;
  openInvoices: number;
}

export interface TenantConnector {
  name: string;
  healthy: boolean;
  status: string;
}

export interface OperatorNote {
  text: string;
  author: string;
  at: string;
}

export interface AdminTenantSubscription {
  plan: PlanId;
  planName: string;
  status: SubscriptionStatus;
  seatQuantity: number;
  unitPriceCents: number | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: string | null;
  createdAt: string;
  version: number;
}

export interface AdminTenantBillingDetail {
  asOf: string;
  providerAvailable: boolean;
  tenant: AdminBillingTenantRow;
  accountId: string | null;
  profile: BillingProfile;
  subscription: AdminTenantSubscription | null;
  overdue: OverdueState | null;
  owner: { name: string | null; email: string | null };
  memberCount: number;
  pendingInvitations: number;
  connectors: TenantConnector[];
  timeline: LifecycleEvent[];
  invoices: BillingInvoice[];
  notes: OperatorNote[];
}

/** Operator overrides on one tenant's billing; mirrors `adminBillingActionSchema`. */
export type OperatorOverrideAction = "change_plan" | "grant_grace" | "mark_paid" | "void_invoice" | "comp_open_invoices" | "add_note";
