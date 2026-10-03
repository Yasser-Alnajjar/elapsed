import type { PlanId } from "@sla/db/plans";
import type { SubscriptionActionInput } from "@/lib/billing-validation";
import type { BillingTone } from "@/lib/types/billing";

/**
 * The Review & Subscribe screen's view model: everything the page shows about
 * one plan change, resolved on the server from the billing read model so the
 * client only renders it and sends `action`.
 */

/** What confirming does. `none` when nothing can be confirmed (see `block`). */
export type SubscribeChange =
  /** First subscription during a running trial: billing starts when it ends. */
  | "start_trial"
  /** First subscription (or a restart): the first period and invoice start now. */
  | "start_now"
  /** A plan change during a subscription's trial: applies now, nothing prorated. */
  | "change_trial"
  | "upgrade"
  /** Scheduled for the end of the period. */
  | "downgrade"
  /** Withdraws a scheduled downgrade. */
  | "keep"
  /** Withdraws a scheduled cancellation. */
  | "resume"
  | "none";

export type SubscribeBlockReason = "read_only" | "internal" | "seats" | "contact" | "current" | "scheduled";

/** Why the change cannot be confirmed here. */
export interface SubscribeBlock {
  reason: SubscribeBlockReason;
  title: string;
  body: string;
}

export interface SubscribeAlert {
  tone: "info" | "warning" | "danger";
  title: string;
  body: string;
  link?: { label: string; href: string };
}

/** One row of "What changes for you": current usage against the target plan's ceiling. */
export interface SubscribeLimitRow {
  id: string;
  label: string;
  used: number;
  /** Null is unlimited. */
  limit: number | null;
  /** Whole percent of the limit; 0 when unlimited. */
  percent: number;
  tone: BillingTone;
  note: string;
}

export interface SubscribeInvoiceLine {
  label: string;
  detail: string;
  /** Null renders as "Included". */
  amountCents: number | null;
}

export interface SubscribeInvoice {
  lines: SubscribeInvoiceLine[];
  /** Null for a contract-priced plan. */
  totalCents: number | null;
  /** True when the total is the pro rata difference at the time of viewing. */
  estimated: boolean;
  currency: string;
  /** When the invoice falls due; null when nothing is due on confirming. */
  dueAt: string | null;
  /** "14 days after trial", "at period renewal". */
  dueNote: string;
  /** What follows the first charge, e.g. the recurring price from the renewal date. */
  followUp: string | null;
}

export interface SubscribeReview {
  planId: PlanId;
  planName: string;
  planDescription: string;
  /** Monthly price in cents; null is custom. */
  priceCents: number | null;
  change: SubscribeChange;
  block: SubscribeBlock | null;
  heading: string;
  subheading: string;
  statusPill: { label: string; tone: BillingTone };
  alert: SubscribeAlert | null;
  transition: { from: string; to: string };
  /** "20 licensed seats (7 in use) · adjustable later in Billing". */
  seatsLine: string;
  limits: SubscribeLimitRow[];
  effect: { headline: string; detail: string };
  invoice: SubscribeInvoice | null;
  settlement: { label: string; billingEmail: string | null };
  cta: { label: string; disabled: boolean };
  /** The one subscription operation confirming sends; null when none applies. */
  action: SubscriptionActionInput | null;
  success: { title: string; message: string; effectiveLabel: string; effectiveValue: string };
}
