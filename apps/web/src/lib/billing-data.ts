import {
  effectiveLimit,
  getOrganizationUsage,
  isUpgrade,
  MAX_SEAT_QUANTITY,
  previewNextInvoice,
  reconcileSubscription,
  seatBounds,
  type OrganizationUsage,
  type PlanStatus,
  type PrismaClient,
} from "@sla/db";
import { formatPlanPrice, isPlanId, PLAN_LIST, PLANS, type PlanDefinition, type PlanId } from "@sla/db/plans";
import { providerRole } from "@/lib/providers";
import type {
  BillingInvoice,
  BillingOverviewData,
  InvoiceLineItem,
  InvoiceStatus,
  PlanEntitlement,
  PlanOption,
  SubscriptionStatus,
  SubscriptionSummary,
  TierRecommendation,
  UsageDay,
} from "@/lib/types/billing";

/**
 * The tenant billing page's read model (`/billing`), from the internal
 * billing domain (`@sla/db` `billing.ts`): the subscription, its invoices and
 * the billing profile, plus usage against the plan the entitlement checks
 * use. The subscription is reconciled first, so an elapsed period or trial
 * shows as renewed rather than stale.
 *
 * Payment methods belong to a payment provider; none is connected yet, so
 * `paymentMethod` is null and the provider-only actions are disabled.
 */

const BACKFILL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const SUBSCRIPTION_STATUS_FROM_PLAN_STATUS: Record<PlanStatus, SubscriptionStatus> = {
  trial: "trialing",
  active: "active",
  past_due: "past_due",
  cancelled: "cancelled",
  internal: "internal",
};

const INVOICE_REASON_DETAIL: Record<string, string> = {
  subscription_create: "Initial subscription",
  subscription_cycle: "Recurring contract · Monthly",
  subscription_update: "Prorated upgrade",
};

const INVOICE_SETTLEMENT: Record<string, string> = {
  open: "Direct invoice",
  paid: "Recorded payment",
  void: "Written off",
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Events ingested from the organization's integrations per UTC day in `[start, end)`. */
export async function dailyIngestedEvents(prisma: PrismaClient, organizationId: string, start: Date, end: Date): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ day: Date; events: bigint }[]>`
    SELECT date_trunc('day', r."fetchedAt") AS "day", count(*) AS "events"
    FROM "raw_events" r
    JOIN "integrations" i ON i."id" = r."integrationId"
    WHERE i."organizationId" = ${organizationId} AND r."fetchedAt" >= ${start} AND r."fetchedAt" < ${end}
    GROUP BY 1`;
  return new Map(rows.map((row) => [startOfUtcDay(new Date(row.day)).toISOString(), Number(row.events)]));
}

function buildUsage(counts: Map<string, number>, start: Date, end: Date, now: Date): { days: UsageDay[]; used: number; dailyAverage: number } {
  const today = startOfUtcDay(now).getTime();
  const observed: UsageDay[] = [];
  const future: Date[] = [];
  for (let day = startOfUtcDay(start); day.getTime() < end.getTime(); day = new Date(day.getTime() + DAY_MS)) {
    if (day.getTime() <= today) observed.push({ date: day.toISOString(), events: counts.get(day.toISOString()) ?? 0, projected: false });
    else future.push(day);
  }
  const used = observed.reduce((sum, day) => sum + day.events, 0);
  const dailyAverage = Math.round(used / Math.max(1, observed.length));
  return { days: [...observed, ...future.map((day) => ({ date: day.toISOString(), events: dailyAverage, projected: true }))], used, dailyAverage };
}

function entitlementsOf(plan: PlanId | null, seatQuantity: number | null, usage: OrganizationUsage): PlanEntitlement[] {
  const subject = { plan, seatQuantity };
  const quota = (resource: keyof OrganizationUsage, unit: string) => ({
    kind: "quota" as const,
    used: usage[resource],
    limit: effectiveLimit(subject, resource),
    unit,
  });
  return [
    { id: "seats", label: "Seats", description: "Members plus pending invitations", included: true, value: quota("seats", "seats") },
    {
      id: "support-integrations",
      label: "Support integrations",
      description: "Zendesk & Intercom ticket sources",
      included: true,
      value: quota("ticketSourceIntegrations", "connected"),
    },
    {
      id: "engineering-integrations",
      label: "Engineering integrations",
      description: "Jira, Linear & GitHub work trackers",
      included: true,
      value: quota("engineeringIntegrations", "connected"),
    },
    {
      id: "sla-policies",
      label: "SLA policies",
      description: "Native policies; imported policies never count",
      included: true,
      value: quota("nativePolicies", "policies"),
    },
    {
      id: "escalation-channels",
      label: "SLA escalation channels",
      description: "Breach notifications before the deadline",
      included: true,
      value: { kind: "tags", values: plan === "starter" ? ["Email"] : ["Slack", "Email"] },
    },
    {
      id: "history",
      label: "Historical backfill",
      description: "Ticket history imported when a source connects",
      included: true,
      value: { kind: "text", value: `${BACKFILL_DAYS} days` },
    },
  ];
}

function recommendationFor(plan: PlanId | null): TierRecommendation | null {
  if (plan === "enterprise") return null;
  const target: PlanDefinition = plan === "team" ? PLANS.enterprise : PLANS.team;
  const { price, cadence } = formatPlanPrice(target);
  const selfServe = target.monthlyPriceUsd !== null;
  return {
    planId: target.id,
    planName: target.name,
    pitch: target.description,
    features: [target.limits.seats === null ? "Unlimited seats" : `${target.limits.seats} seats`, target.integrationsLine, ...target.extraFeatures],
    ctaLabel: selfServe ? `Upgrade tier (${price}${cadence === "/month" ? "/mo" : ""})` : `Talk to us about ${target.name}`,
    selfServe,
  };
}

function planOptionsFor(subscription: SubscriptionSummary | null, seatsInUse: number): PlanOption[] {
  const live = subscription && subscription.status !== "cancelled" ? subscription : null;
  return PLAN_LIST.map((plan) => {
    const limit = plan.limits.seats;
    const current = live?.planId === plan.id;
    const unavailableReason =
      limit !== null && seatsInUse > limit ? `${seatsInUse} seats are in use; ${plan.name} allows ${limit}.` : null;
    const effect: PlanOption["effect"] = current
      ? null
      : !live || live.status === "trialing" || isUpgrade(live.planId, plan.id)
        ? "now"
        : "period_end";
    return {
      id: plan.id,
      name: plan.name,
      priceLabel: formatPlanPrice(plan).price,
      summary: [
        limit === null ? "Unlimited seats" : `${limit} seats`,
        plan.limits.nativePolicies === null ? "Unlimited SLA policies" : `${plan.limits.nativePolicies} SLA policies`,
        plan.limits.ticketSourceIntegrations === null ? "Unlimited integrations" : `${plan.limits.ticketSourceIntegrations} + ${plan.limits.engineeringIntegrations} integrations`,
      ].join(" · "),
      current,
      pending: live?.pendingPlan?.id === plan.id,
      selfServe: plan.monthlyPriceUsd !== null,
      unavailableReason,
      effect,
    };
  });
}

function toInvoice(row: {
  id: string;
  number: string;
  status: string;
  reason: string;
  plan: string;
  seatQuantity: number;
  periodStart: Date;
  periodEnd: Date;
  totalCents: number;
  currency: string;
  issuedAt: Date;
  dueAt: Date;
  paidAt: Date | null;
}): BillingInvoice {
  const planName = isPlanId(row.plan) ? PLANS[row.plan].name : row.plan;
  return {
    id: row.id,
    number: row.number,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    description: `${planName} Plan · ${row.seatQuantity} Seats`,
    detail: INVOICE_REASON_DETAIL[row.reason] ?? row.reason,
    detailHighlighted: row.reason === "subscription_update",
    amountCents: row.totalCents,
    currency: row.currency,
    status: row.status as InvoiceStatus,
    paymentMethodLabel: INVOICE_SETTLEMENT[row.status] ?? "—",
    issuedAt: row.issuedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    reference: row.id,
  };
}

export async function getBillingOverview(
  prisma: PrismaClient,
  { organizationId, canManage, providerAvailable }: { organizationId: string; canManage: boolean; providerAvailable: boolean },
  now: Date = new Date(),
): Promise<BillingOverviewData | null> {
  await reconcileSubscription(prisma, organizationId, now);

  const [organization, account, subscriptionRow, invoiceRows, usage] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, plan: true, planStatus: true, trialEndsAt: true, createdAt: true },
    }),
    prisma.billingAccount.findUnique({ where: { organizationId } }),
    prisma.billingSubscription.findUnique({ where: { organizationId } }),
    prisma.billingInvoice.findMany({ where: { organizationId }, orderBy: [{ issuedAt: "desc" }, { number: "desc" }] }),
    getOrganizationUsage(prisma, organizationId, providerRole, now),
  ]);
  if (!organization) return null;

  const subscription: SubscriptionSummary | null =
    subscriptionRow && isPlanId(subscriptionRow.plan)
      ? {
          planId: subscriptionRow.plan,
          planName: PLANS[subscriptionRow.plan].name,
          status: SUBSCRIPTION_STATUS_FROM_PLAN_STATUS[subscriptionRow.status],
          interval: "month",
          amountCents: subscriptionRow.unitPriceCents,
          currency: subscriptionRow.currency,
          currentPeriodStart: subscriptionRow.currentPeriodStart.toISOString(),
          currentPeriodEnd: subscriptionRow.currentPeriodEnd.toISOString(),
          renewsAt:
            subscriptionRow.status === "cancelled" || subscriptionRow.cancelAtPeriodEnd
              ? null
              : (subscriptionRow.status === "trial" ? subscriptionRow.trialEndsAt ?? subscriptionRow.currentPeriodEnd : subscriptionRow.currentPeriodEnd).toISOString(),
          trialEndsAt: subscriptionRow.trialEndsAt?.toISOString() ?? null,
          subscribedSince: subscriptionRow.createdAt.toISOString(),
          cancelAtPeriodEnd: subscriptionRow.cancelAtPeriodEnd,
          endedAt: subscriptionRow.endedAt?.toISOString() ?? null,
          pendingPlan: subscriptionRow.pendingPlan && isPlanId(subscriptionRow.pendingPlan) ? { id: subscriptionRow.pendingPlan, name: PLANS[subscriptionRow.pendingPlan].name } : null,
          seatQuantity: subscriptionRow.seatQuantity,
          version: subscriptionRow.version,
        }
      : null;

  const live = subscription && subscription.status !== "cancelled" ? subscription : null;
  const effectivePlanId: PlanId | null = live?.planId ?? (isPlanId(organization.plan) ? organization.plan : null);
  const trial =
    !subscription && organization.planStatus === "trial"
      ? { endsAt: organization.trialEndsAt?.toISOString() ?? null, expired: organization.trialEndsAt !== null && organization.trialEndsAt.getTime() <= now.getTime() }
      : null;

  // The chart covers the billing period, or the trial, or the last 30 days.
  const windowStart = live ? new Date(live.currentPeriodStart) : trial?.endsAt ? organization.createdAt : new Date(now.getTime() - 29 * DAY_MS);
  const windowEnd = live ? new Date(live.currentPeriodEnd) : trial?.endsAt && !trial.expired ? new Date(trial.endsAt) : new Date(now.getTime() + DAY_MS);
  const counts = await dailyIngestedEvents(prisma, organizationId, startOfUtcDay(windowStart), windowEnd);
  const throughput = buildUsage(counts, windowStart, windowEnd, now);

  const bounds = effectivePlanId ? seatBounds(effectivePlanId, usage.seats) : { min: Math.max(1, usage.seats), max: MAX_SEAT_QUANTITY };
  const next = subscriptionRow ? previewNextInvoice(subscriptionRow) : null;
  const lineItems: InvoiceLineItem[] = next?.lines ?? [];

  return {
    organizationName: organization.name,
    canManage,
    providerAvailable,
    internal: organization.planStatus === "internal",
    asOf: now.toISOString(),
    subscription,
    trial,
    effectivePlan: effectivePlanId ? { id: effectivePlanId, name: PLANS[effectivePlanId].name } : null,
    seats: {
      used: usage.seats,
      licensed: live?.seatQuantity ?? null,
      planLimit: effectivePlanId ? PLANS[effectivePlanId].limits.seats : null,
      min: bounds.min,
      max: bounds.max,
    },
    events: { used: throughput.used, dailyAverage: throughput.dailyAverage },
    paymentMethod: null,
    entitlements: entitlementsOf(effectivePlanId, live?.seatQuantity ?? null, usage),
    upcomingInvoice: next
      ? { planName: PLANS[next.plan].name, amountCents: next.amountCents, currency: subscriptionRow!.currency, nextAttemptAt: next.chargeAt.toISOString(), lineItems }
      : null,
    usage: throughput.days,
    recommendation: recommendationFor(effectivePlanId),
    planOptions: planOptionsFor(subscription, usage.seats),
    invoices: invoiceRows.map(toInvoice),
    profile: {
      billingEmail: account?.billingEmail ?? null,
      legalName: account?.legalName ?? null,
      addressLines: account?.addressLines ?? [],
      country: account?.country ?? null,
      taxId: account?.taxId ?? null,
      ccEmails: account?.ccEmails ?? [],
    },
  };
}
