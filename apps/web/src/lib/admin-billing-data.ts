import { GRACE_EXTENSION_DAYS, reconcileSubscription, type PlanStatus, type PrismaClient } from "@sla/db";
import { isPlanId, PLANS } from "@sla/db/plans";
import { SUBSCRIPTION_STATUS_FROM_PLAN_STATUS } from "@/lib/billing-data";
import { daysBetween, formatBillingDate, formatMoney } from "@/lib/billing-format";
import {
  BILLING_PLAN_TIER_LABELS,
  type AdminBillingOverviewData,
  type AdminBillingTenantRow,
  type AdminTenantBillingDetail,
  type BillingHealth,
  type BillingPlanTier,
  type LifecycleEvent,
} from "@/lib/types/admin-billing";
import type { BillingInvoice, InvoiceStatus } from "@/lib/types/billing";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";

/**
 * The platform-admin billing console's read models (`/admin/billing`), from
 * the internal billing domain: every organization's plan, subscription state,
 * seats, open balance and ingest volume, and one organization's full billing
 * lifecycle. Subscriptions whose period or trial has elapsed, or that have an
 * overdue invoice, are reconciled first so the directory is never stale.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENCY = "USD";

interface SubscriptionFields {
  plan: string;
  status: PlanStatus;
  seatQuantity: number;
  unitPriceCents: number | null;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  endedAt: Date | null;
  pendingPlan: string | null;
}

export interface BillingRowInput {
  organization: { id: string; name: string; plan: string | null; planStatus: PlanStatus; trialEndsAt: Date | null; createdAt: Date };
  subscription: SubscriptionFields | null;
  ownerEmail: string | null;
  seatsUsed: number;
  openCents: number;
  oldestDueAt: Date | null;
  ingress24h: number;
}

/** Subscriptions that a read would show stale: an elapsed period or trial, or an open invoice now overdue. */
async function reconcileDue(prisma: PrismaClient, now: Date): Promise<void> {
  const [elapsed, overdue] = await Promise.all([
    prisma.billingSubscription.findMany({
      where: { status: { not: "cancelled" }, OR: [{ currentPeriodEnd: { lte: now } }, { trialEndsAt: { lte: now }, status: "trial" }] },
      select: { organizationId: true },
    }),
    prisma.billingInvoice.findMany({ where: { status: "open", dueAt: { lt: now } }, select: { organizationId: true }, distinct: ["organizationId"] }),
  ]);
  const ids = new Set([...elapsed, ...overdue].map((row) => row.organizationId));
  for (const organizationId of ids) await reconcileSubscription(prisma, organizationId, now);
}

/** One directory row from an organization, its subscription and its aggregates. Pure. */
export function toBillingRow(input: BillingRowInput, now: Date): AdminBillingTenantRow {
  const { organization, subscription } = input;
  const status = SUBSCRIPTION_STATUS_FROM_PLAN_STATUS[subscription?.status ?? organization.planStatus];
  const planId = subscription?.plan ?? organization.plan;
  const tier: BillingPlanTier = isPlanId(planId) ? planId : "none";
  const trialEnd = subscription?.trialEndsAt ?? organization.trialEndsAt;
  const trialDaysLeft = status === "trialing" && trialEnd ? Math.max(0, daysBetween(now, trialEnd)) : null;
  const overdueDays = input.oldestDueAt && input.oldestDueAt.getTime() < now.getTime() ? Math.max(1, daysBetween(input.oldestDueAt, now)) : null;
  const cancelAtPeriodEnd = subscription?.cancelAtPeriodEnd ?? false;
  const health: BillingHealth = overdueDays !== null ? "overdue" : cancelAtPeriodEnd || (trialDaysLeft !== null && trialDaysLeft <= 3) ? "expiring" : "healthy";
  const rateCents = subscription?.unitPriceCents ?? null;
  const billable = status === "active" || status === "past_due";

  const tag: AdminBillingTenantRow["tag"] =
    status === "internal"
      ? { label: "Internal", tone: "neutral" }
      : status === "past_due"
        ? { label: "Dunning", tone: "danger" }
        : cancelAtPeriodEnd
          ? { label: "Ending", tone: "warning" }
          : status === "trialing"
            ? { label: "Trial", tone: "warning" }
            : null;

  const pending = subscription?.pendingPlan && isPlanId(subscription.pendingPlan) ? PLANS[subscription.pendingPlan].name : null;
  const rateNote: AdminBillingTenantRow["rateNote"] = !subscription
    ? { text: status === "internal" ? "Not billed" : "Not subscribed", tone: "neutral" }
    : status === "trialing"
      ? { text: "Billing starts at trial end", tone: "primary" }
      : input.openCents > 0
        ? { text: `${formatMoney(input.openCents)} open`, tone: status === "past_due" ? "danger" : "neutral" }
        : pending
          ? { text: `→ ${pending} at renewal`, tone: "warning" }
          : rateCents === null
            ? { text: "Contract", tone: "neutral" }
            : { text: "Direct invoice", tone: "neutral" };

  const renews = subscription !== null && status !== "cancelled" && !cancelAtPeriodEnd;
  const nextBillingAt = renews ? ((status === "trialing" ? trialEnd : subscription.currentPeriodEnd)?.toISOString() ?? null) : null;
  const nextBillingNote: AdminBillingTenantRow["nextBillingNote"] = !subscription
    ? { text: trialEnd ? `Trial ends ${formatBillingDate(trialEnd.toISOString())}` : "No subscription", tone: "neutral" }
    : status === "cancelled"
      ? { text: `Ended ${formatBillingDate((subscription.endedAt ?? subscription.currentPeriodEnd).toISOString())}`, tone: "neutral" }
      : cancelAtPeriodEnd
        ? { text: `Ends ${formatBillingDate(subscription.currentPeriodEnd.toISOString())}`, tone: "warning" }
        : status === "trialing"
          ? { text: "Conversion window", tone: "warning" }
          : { text: `in ${Math.max(0, daysBetween(now, subscription.currentPeriodEnd))} days`, tone: "neutral" };

  return {
    id: organization.id,
    name: organization.name,
    ownerEmail: input.ownerEmail,
    tag,
    tier,
    planLabel: `${BILLING_PLAN_TIER_LABELS[tier]}${status === "trialing" && tier !== "none" ? " trial" : ""}`,
    status,
    hasSubscription: subscription !== null,
    cancelAtPeriodEnd,
    overdueDays,
    trialDaysLeft,
    health,
    seats: {
      used: input.seatsUsed,
      licensed: subscription && status !== "cancelled" ? subscription.seatQuantity : null,
      planLimit: tier === "none" ? null : PLANS[tier].limits.seats,
    },
    rateCents,
    mrrCents: billable ? (rateCents ?? 0) : 0,
    rateNote,
    nextBillingAt,
    nextBillingNote,
    openCents: input.openCents,
    ingress24h: input.ingress24h,
    createdAt: organization.createdAt.toISOString(),
  };
}

const SUBSCRIPTION_SELECT = {
  plan: true,
  status: true,
  seatQuantity: true,
  unitPriceCents: true,
  currentPeriodEnd: true,
  trialEndsAt: true,
  cancelAtPeriodEnd: true,
  endedAt: true,
  pendingPlan: true,
} as const;

async function ingressByOrganization(prisma: PrismaClient, since: Date, organizationId?: string): Promise<Map<string, number>> {
  const rows = organizationId
    ? await prisma.$queryRaw<{ organizationId: string; events: bigint }[]>`
        SELECT i."organizationId", count(*) AS "events" FROM "raw_events" r JOIN "integrations" i ON i."id" = r."integrationId"
        WHERE r."fetchedAt" >= ${since} AND i."organizationId" = ${organizationId} GROUP BY 1`
    : await prisma.$queryRaw<{ organizationId: string; events: bigint }[]>`
        SELECT i."organizationId", count(*) AS "events" FROM "raw_events" r JOIN "integrations" i ON i."id" = r."integrationId"
        WHERE r."fetchedAt" >= ${since} GROUP BY 1`;
  return new Map(rows.map((row) => [row.organizationId, Number(row.events)]));
}

async function seatCounts(prisma: PrismaClient, now: Date): Promise<Map<string, number>> {
  const [members, invitations] = await Promise.all([
    prisma.user.groupBy({ by: ["organizationId"], _count: { _all: true } }),
    prisma.organizationInvitation.groupBy({ by: ["organizationId"], where: { status: "pending", expiresAt: { gt: now } }, _count: { _all: true } }),
  ]);
  const counts = new Map<string, number>();
  for (const row of [...members, ...invitations]) counts.set(row.organizationId, (counts.get(row.organizationId) ?? 0) + row._count._all);
  return counts;
}

async function openBalances(prisma: PrismaClient): Promise<Map<string, { openCents: number; oldestDueAt: Date | null }>> {
  const rows = await prisma.billingInvoice.groupBy({
    by: ["organizationId"],
    where: { status: "open" },
    _sum: { totalCents: true },
    _min: { dueAt: true },
  });
  return new Map(rows.map((row) => [row.organizationId, { openCents: row._sum.totalCents ?? 0, oldestDueAt: row._min.dueAt }]));
}

export async function getAdminBillingOverviewData(
  prisma: PrismaClient,
  { providerAvailable }: { providerAvailable: boolean },
  now: Date = new Date(),
): Promise<AdminBillingOverviewData> {
  await reconcileDue(prisma, now);
  const since90 = new Date(now.getTime() - 90 * DAY_MS);

  const [organizations, seats, balances, ingress, issued, paid] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        plan: true,
        planStatus: true,
        trialEndsAt: true,
        createdAt: true,
        billingSubscription: { select: SUBSCRIPTION_SELECT },
        users: { where: { role: "owner" }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } },
      },
    }),
    seatCounts(prisma, now),
    openBalances(prisma),
    ingressByOrganization(prisma, new Date(now.getTime() - DAY_MS)),
    prisma.billingInvoice.count({ where: { issuedAt: { gte: since90 }, status: { not: "void" } } }),
    prisma.billingInvoice.count({ where: { issuedAt: { gte: since90 }, status: "paid" } }),
  ]);

  const tenants = organizations.map((organization) =>
    toBillingRow(
      {
        organization,
        subscription: organization.billingSubscription,
        ownerEmail: organization.users[0]?.email ?? null,
        seatsUsed: seats.get(organization.id) ?? 0,
        openCents: balances.get(organization.id)?.openCents ?? 0,
        oldestDueAt: balances.get(organization.id)?.oldestDueAt ?? null,
        ingress24h: ingress.get(organization.id) ?? 0,
      },
      now,
    ),
  );

  return {
    asOf: now.toISOString(),
    currency: CURRENCY,
    providerAvailable,
    tenants,
    totals: {
      events24h: [...ingress.values()].reduce((sum, value) => sum + value, 0),
      invoicesIssued90d: issued,
      invoicesPaid90d: paid,
      openCents: tenants.reduce((sum, tenant) => sum + tenant.openCents, 0),
    },
  };
}

// ---- One tenant ----------------------------------------------------------------

type EventData = Record<string, unknown> | null;
const str = (data: EventData, key: string) => (data && typeof data[key] === "string" ? (data[key] as string) : "");
const num = (data: EventData, key: string) => (data && typeof data[key] === "number" ? (data[key] as number) : 0);
const planName = (id: string) => (isPlanId(id) ? PLANS[id].name : id || "—");
const date = (iso: string) => (iso ? formatBillingDate(iso) : "—");

/** One billing event as the lifecycle stream shows it. */
export function describeBillingEvent(type: string, data: EventData): Pick<LifecycleEvent, "group" | "tone" | "title" | "body"> {
  switch (type) {
    case "subscription_started":
      return {
        group: "plan",
        tone: "success",
        title: data?.restarted ? "Subscription restarted" : "Subscription started",
        body: `${planName(str(data, "plan"))} plan with ${num(data, "seatQuantity")} licensed seats${str(data, "trialEndsAt") ? `; billing starts when the trial ends on ${date(str(data, "trialEndsAt"))}` : ""}.`,
      };
    case "trial_converted":
      return { group: "plan", tone: "primary", title: "Trial converted", body: `Now billed on ${planName(str(data, "plan"))}, period to ${date(str(data, "periodEnd"))}.` };
    case "subscription_renewed":
      return { group: "plan", tone: "primary", title: "Subscription renewed", body: `${planName(str(data, "plan"))}, period to ${date(str(data, "periodEnd"))}.` };
    case "plan_changed":
      return {
        group: "plan",
        tone: "primary",
        title: `Tier change: ${planName(str(data, "from"))} → ${planName(str(data, "to"))}`,
        body: data?.scheduled ? "The scheduled change applied at renewal." : "Applied immediately.",
      };
    case "plan_change_scheduled":
      return { group: "plan", tone: "warning", title: `Downgrade scheduled to ${planName(str(data, "to"))}`, body: `Takes effect on ${date(str(data, "effectiveAt"))}.` };
    case "plan_change_cancelled":
      return { group: "plan", tone: "neutral", title: "Scheduled change withdrawn", body: `Stays on ${planName(str(data, "kept"))} instead of ${planName(str(data, "dropped"))}.` };
    case "plan_change_skipped":
      return {
        group: "plan",
        tone: "danger",
        title: `Downgrade to ${planName(str(data, "to"))} skipped`,
        body: `${num(data, "seatsInUse")} seats were in use; the plan allows ${num(data, "seatLimit")}.`,
      };
    case "seats_changed":
      return { group: "seats", tone: "primary", title: "Licensed seats changed", body: `${num(data, "from")} → ${num(data, "to")} seats (${num(data, "seatsInUse")} in use).` };
    case "cancellation_scheduled":
      return { group: "plan", tone: "warning", title: "Cancellation scheduled", body: `The subscription ends on ${date(str(data, "effectiveAt"))} unless resumed.` };
    case "subscription_resumed":
      return { group: "plan", tone: "success", title: "Subscription resumed", body: "The scheduled cancellation was withdrawn." };
    case "subscription_cancelled":
      return { group: "plan", tone: "danger", title: "Subscription ended", body: `Ended on ${date(str(data, "endedAt"))}. Monitoring continues.` };
    case "invoice_issued":
      return { group: "payments", tone: "neutral", title: `Invoice ${str(data, "number")} issued`, body: `${formatMoney(num(data, "totalCents"))}, ${str(data, "reason").replace(/_/g, " ")}.` };
    case "invoice_paid":
      return { group: "payments", tone: "success", title: `Invoice ${str(data, "number")} paid`, body: `${formatMoney(num(data, "totalCents"))} recorded as received.` };
    case "invoice_voided":
      return { group: "payments", tone: "neutral", title: `Invoice ${str(data, "number")} ${data?.comped ? "comped" : "voided"}`, body: `${formatMoney(num(data, "totalCents"))} written off.` };
    case "payment_overdue":
      return { group: "payments", tone: "danger", title: "Payment overdue", body: `${num(data, "overdueInvoices")} invoice(s) past due; the subscription is past due.` };
    case "payment_recovered":
      return { group: "payments", tone: "success", title: "Payment recovered", body: "Nothing is overdue any more; the subscription is active." };
    case "grace_extended":
      return { group: "notes", tone: "warning", title: `Grace extended ${num(data, "days")} days`, body: "Open invoice due dates (and a running trial) were pushed out." };
    case "account_updated":
      return { group: "notes", tone: "neutral", title: "Billing details updated", body: `Changed: ${Array.isArray(data?.fields) ? (data.fields as string[]).join(", ") : "profile"}.` };
    case "operator_note":
      return { group: "notes", tone: "neutral", title: "Operator note", body: str(data, "note") };
    default:
      return { group: "notes", tone: "neutral", title: type, body: "" };
  }
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
  return {
    id: row.id,
    number: row.number,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    description: `${planName(row.plan)} plan`,
    detail: row.reason === "subscription_update" ? "Prorated upgrade" : row.reason === "subscription_create" ? "Initial subscription" : "Monthly renewal",
    detailHighlighted: row.reason === "subscription_update",
    amountCents: row.totalCents,
    currency: row.currency,
    status: row.status as InvoiceStatus,
    paymentMethodLabel: row.status === "paid" ? "Recorded payment" : row.status === "void" ? "Written off" : "Direct invoice",
    issuedAt: row.issuedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    reference: row.id,
  };
}

export async function getAdminTenantBillingDetail(
  prisma: PrismaClient,
  organizationId: string,
  { providerAvailable }: { providerAvailable: boolean },
  now: Date = new Date(),
): Promise<AdminTenantBillingDetail | null> {
  const exists = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!exists) return null;
  await reconcileSubscription(prisma, organizationId, now);

  const [organization, account, subscription, invoiceRows, eventRows, owner, memberCount, pendingInvitations, integrations, ingress] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true, plan: true, planStatus: true, trialEndsAt: true, createdAt: true },
    }),
    prisma.billingAccount.findUnique({ where: { organizationId } }),
    prisma.billingSubscription.findUnique({ where: { organizationId } }),
    prisma.billingInvoice.findMany({ where: { organizationId }, orderBy: [{ issuedAt: "desc" }, { number: "desc" }] }),
    prisma.billingEvent.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.user.findFirst({ where: { organizationId, role: "owner" }, orderBy: { createdAt: "asc" }, select: { name: true, email: true } }),
    prisma.user.count({ where: { organizationId } }),
    prisma.organizationInvitation.count({ where: { organizationId, status: "pending", expiresAt: { gt: now } } }),
    prisma.integration.findMany({ where: { organizationId }, orderBy: { provider: "asc" }, select: { provider: true, status: true } }),
    ingressByOrganization(prisma, new Date(now.getTime() - DAY_MS), organizationId),
  ]);

  const open = invoiceRows.filter((invoice) => invoice.status === "open").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const oldest = open[0];
  const tenant = toBillingRow(
    {
      organization,
      subscription,
      ownerEmail: owner?.email ?? null,
      seatsUsed: memberCount + pendingInvitations,
      openCents: open.reduce((sum, invoice) => sum + invoice.totalCents, 0),
      oldestDueAt: oldest?.dueAt ?? null,
      ingress24h: ingress.get(organizationId) ?? 0,
    },
    now,
  );

  const timeline: LifecycleEvent[] = eventRows.map((event) => ({
    id: event.id,
    kind: event.type,
    at: event.createdAt.toISOString(),
    actor: event.actorEmail ?? event.actorType,
    ...describeBillingEvent(event.type, (event.data as EventData) ?? null),
  }));

  return {
    asOf: now.toISOString(),
    providerAvailable,
    tenant,
    accountId: account?.id ?? null,
    profile: {
      billingEmail: account?.billingEmail ?? null,
      legalName: account?.legalName ?? null,
      addressLines: account?.addressLines ?? [],
      country: account?.country ?? null,
      taxId: account?.taxId ?? null,
      ccEmails: account?.ccEmails ?? [],
    },
    subscription:
      subscription && isPlanId(subscription.plan)
        ? {
            plan: subscription.plan,
            planName: PLANS[subscription.plan].name,
            status: SUBSCRIPTION_STATUS_FROM_PLAN_STATUS[subscription.status],
            seatQuantity: subscription.seatQuantity,
            unitPriceCents: subscription.unitPriceCents,
            currentPeriodStart: subscription.currentPeriodStart.toISOString(),
            currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
            trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            pendingPlan: subscription.pendingPlan,
            createdAt: subscription.createdAt.toISOString(),
            version: subscription.version,
          }
        : null,
    overdue:
      oldest && oldest.dueAt.getTime() < now.getTime()
        ? {
            invoiceId: oldest.id,
            invoiceNumber: oldest.number,
            amountCents: oldest.totalCents,
            dueAt: oldest.dueAt.toISOString(),
            graceEndsAt: new Date(oldest.dueAt.getTime() + GRACE_EXTENSION_DAYS * DAY_MS).toISOString(),
            openInvoices: open.length,
          }
        : null,
    owner: { name: owner?.name ?? null, email: owner?.email ?? null },
    memberCount,
    pendingInvitations,
    connectors: integrations.map((integration) => ({
      name: INTEGRATION_PROVIDER_LABELS[integration.provider],
      healthy: integration.status === "connected",
      status: integration.status.replace(/_/g, " "),
    })),
    timeline,
    invoices: invoiceRows.map(toInvoice),
    notes: timeline.filter((event) => event.kind === "operator_note").map((event) => ({ text: event.body, author: event.actor, at: event.at })),
  };
}
