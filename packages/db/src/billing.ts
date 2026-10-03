import type { BillingInvoice, BillingSubscription, PlanStatus, Prisma, PrismaClient } from "../generated/prisma/client";
import type { BillingProvider, SubscriptionSnapshot } from "./billing-provider";
import { isPlanId, PLAN_IDS, PLANS, type PlanId } from "./plans";
import { countSeatsInUse } from "./usage";

/**
 * The internal billing domain (N6.5): an organization's billing account,
 * its subscription lifecycle, invoices and billing history.
 *
 * Lifecycle:
 *
 *   no subscription ──start──▶ trial ──trial ends──▶ active ⇄ past_due
 *                                 │                     │
 *                                 └──cancel (at period end) ⇄ resume
 *                                                       ▼
 *                                                   cancelled ──start──▶ …
 *
 * - Prices and seat limits come from `PLANS` only (`./plans.ts`), the same
 *   constant the pricing page and the entitlement checks read. A price is
 *   snapshotted onto the subscription and each invoice so history never
 *   changes when the price list does.
 * - Every transition runs in one transaction that locks the organization row,
 *   re-validates against current state, bumps `version`, writes a
 *   `BillingEvent`, and mirrors plan and status onto `Organization.plan` /
 *   `planStatus` / `trialEndsAt`, which is what `./entitlements.ts` reads. So a
 *   plan change changes entitlements in the same commit, and billing never
 *   keeps its own copy of the limits.
 * - Callers pass the `version` they last saw; a stale one is a `conflict`, so
 *   a double-submitted or racing request cannot apply twice.
 * - No payment provider is required (`provider: null`). Invoices are then
 *   issued `open` on net terms and settled by an operator (direct invoice);
 *   an invoice unpaid past its due date makes the subscription `past_due`.
 *   Nothing here ever pauses monitoring. Operations that genuinely need a
 *   provider (collecting a payment) fail with `provider_unavailable`.
 * - Periods only advance when someone reads or changes billing
 *   (`reconcileSubscription`); every advance is idempotent per period.
 */

// ---- Constants -----------------------------------------------------------------

/** Days an internally issued invoice is due after it is issued. */
export const INVOICE_NET_TERMS_DAYS = 14;
/** Days an operator's "grant grace" adds. */
export const GRACE_EXTENSION_DAYS = 7;
/** Upper bound on licensed seats for a plan with unlimited seats. */
export const MAX_SEAT_QUANTITY = 10_000;
/** Safety bound on periods advanced in one reconcile (a subscription untouched for three years). */
const MAX_PERIOD_ADVANCES = 36;
const CURRENCY = "USD";
const DAY_MS = 24 * 60 * 60 * 1000;

export const BILLING_EVENT_TYPES = [
  "subscription_started",
  "trial_converted",
  "subscription_renewed",
  "plan_changed",
  "plan_change_scheduled",
  "plan_change_cancelled",
  "plan_change_skipped",
  "seats_changed",
  "cancellation_scheduled",
  "subscription_resumed",
  "subscription_cancelled",
  "invoice_issued",
  "invoice_paid",
  "invoice_voided",
  "payment_overdue",
  "payment_recovered",
  "grace_extended",
  "account_updated",
  "operator_note",
] as const;
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

// ---- Errors and inputs ---------------------------------------------------------

export type BillingErrorCode =
  | "not_found"
  | "invalid_input"
  | "invalid_plan"
  | "invalid_seats"
  | "contact_sales"
  | "invalid_transition"
  | "conflict"
  | "provider_unavailable";

/** A refused billing operation. `message` is fit to show the customer. */
export class BillingError extends Error {
  constructor(
    readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export interface BillingActor {
  type: "user" | "operator" | "system";
  email: string | null;
}

const SYSTEM: BillingActor = { type: "system", email: null };

export interface InvoiceLine {
  label: string;
  detail: string;
  /** Null renders as "Included". */
  amountCents: number | null;
}

interface MutationBase {
  organizationId: string;
  actor: BillingActor;
  provider: BillingProvider | null;
  now?: Date;
}

/** For changes to an existing subscription: the `version` the caller last saw. */
interface VersionedMutation extends MutationBase {
  expectedVersion: number;
}

type Tx = Prisma.TransactionClient;

/**
 * Runs inside the transaction of an operator override, after the change: the
 * admin area writes its audit row here, so the change and its audit row
 * commit together or not at all.
 */
export type BillingAuditHook = (tx: Prisma.TransactionClient) => Promise<void>;
type Subscription = BillingSubscription;

// ---- Pure helpers (also used by the read models) -------------------------------

/** The plan's monthly list price in cents, or null when it is custom. */
export function planPriceCents(plan: PlanId): number | null {
  const price = PLANS[plan].monthlyPriceUsd;
  return price === null ? null : price * 100;
}

const PLAN_RANK: Record<PlanId, number> = Object.fromEntries(PLAN_IDS.map((id, index) => [id, index])) as Record<PlanId, number>;

export function isUpgrade(from: PlanId, to: PlanId): boolean {
  return PLAN_RANK[to] > PLAN_RANK[from];
}

/** Customers choose these themselves; Enterprise is priced by contract and set by an operator. */
export function isSelfServePlan(plan: PlanId): boolean {
  return planPriceCents(plan) !== null;
}

/** The licensed-seat range a plan allows, given the seats in use. */
export function seatBounds(plan: PlanId, seatsInUse: number): { min: number; max: number } {
  const limit = PLANS[plan].limits.seats;
  return { min: Math.max(1, seatsInUse), max: limit ?? MAX_SEAT_QUANTITY };
}

/** Seats licensed by default: the plan's seat limit, or the seats in use for an unlimited plan. */
export function defaultSeatQuantity(plan: PlanId, seatsInUse: number): number {
  return PLANS[plan].limits.seats ?? Math.max(1, seatsInUse);
}

/** Same day of month, `months` later (clamped to the month's last day), same UTC time. */
export function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()),
  );
}

export function toSnapshot(subscription: Subscription): SubscriptionSnapshot {
  return {
    organizationId: subscription.organizationId,
    plan: subscription.plan,
    status: subscription.status as SubscriptionSnapshot["status"],
    seatQuantity: subscription.seatQuantity,
    unitPriceCents: subscription.unitPriceCents,
    currency: subscription.currency,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    trialEndsAt: subscription.trialEndsAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    pendingPlan: subscription.pendingPlan,
  };
}

/**
 * What the next renewal will charge: the plan the subscription renews onto
 * (a scheduled downgrade if there is one), or null when nothing renews.
 */
export function previewNextInvoice(subscription: Pick<Subscription, "status" | "plan" | "pendingPlan" | "seatQuantity" | "cancelAtPeriodEnd" | "currentPeriodEnd" | "trialEndsAt">): {
  plan: PlanId;
  amountCents: number | null;
  chargeAt: Date;
  lines: InvoiceLine[];
} | null {
  if (subscription.status === "cancelled" || subscription.cancelAtPeriodEnd) return null;
  const plan = (subscription.pendingPlan ?? subscription.plan) as PlanId;
  if (!isPlanId(plan)) return null;
  const amountCents = planPriceCents(plan);
  const chargeAt = subscription.status === "trial" && subscription.trialEndsAt ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  return { plan, amountCents, chargeAt, lines: cycleLines(plan, subscription.seatQuantity) };
}

function cycleLines(plan: PlanId, seatQuantity: number): InvoiceLine[] {
  const definition = PLANS[plan];
  return [
    { label: `${definition.name} plan`, detail: "Monthly recurring fee", amountCents: planPriceCents(plan) },
    {
      label: `Licensed seats (${seatQuantity})`,
      detail: definition.limits.seats === null ? "Unlimited seats on this plan" : `Up to ${definition.limits.seats} on this plan`,
      amountCents: 0,
    },
  ];
}

// ---- Transaction plumbing ------------------------------------------------------

/**
 * Serializes billing writes per organization: every mutation takes this row
 * lock first, so two requests never interleave their read-validate-write.
 */
async function lockOrganization(tx: Tx, organizationId: string): Promise<{ planStatus: PlanStatus; trialEndsAt: Date | null }> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "organizations" WHERE "id" = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) throw new BillingError("not_found", "Organization not found");
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { planStatus: true, trialEndsAt: true } });
  return organization;
}

async function recordEvent(tx: Tx, organizationId: string, type: BillingEventType, actor: BillingActor, data?: Record<string, unknown>): Promise<void> {
  await tx.billingEvent.create({
    data: { organizationId, type, actorType: actor.type, actorEmail: actor.email, data: (data ?? undefined) as Prisma.InputJsonValue | undefined },
  });
}

/** Writes `data` only if the row is still at `current.version`, and bumps it. */
async function writeSubscription(tx: Tx, current: Subscription, data: Prisma.BillingSubscriptionUpdateManyMutationInput): Promise<Subscription> {
  const { count } = await tx.billingSubscription.updateMany({
    where: { id: current.id, version: current.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (count === 0) throw new BillingError("conflict", "Billing changed while this request was in flight. Refresh and try again.");
  return tx.billingSubscription.findUniqueOrThrow({ where: { id: current.id } });
}

/** Mirrors the subscription onto the organization columns the entitlement checks read. */
async function syncOrganization(tx: Tx, subscription: Subscription): Promise<void> {
  await tx.organization.update({
    where: { id: subscription.organizationId },
    data: {
      plan: subscription.plan,
      planStatus: subscription.status,
      ...(subscription.trialEndsAt ? { trialEndsAt: subscription.trialEndsAt } : {}),
    },
  });
}

/** Issues one invoice; a repeat with the same idempotency key returns the existing one. */
async function issueInvoice(
  tx: Tx,
  subscription: Subscription,
  input: { reason: "subscription_create" | "subscription_cycle" | "subscription_update"; key: string; periodStart: Date; periodEnd: Date; lines: InvoiceLine[]; now: Date },
): Promise<BillingInvoice | null> {
  const existing = await tx.billingInvoice.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: subscription.organizationId, idempotencyKey: input.key } },
  });
  if (existing) return existing;

  const totalCents = input.lines.reduce((sum, line) => sum + (line.amountCents ?? 0), 0);
  // Custom-priced (Enterprise) contracts are invoiced directly, outside this ledger.
  if (subscription.unitPriceCents === null && input.reason !== "subscription_update") return null;
  if (totalCents <= 0) return null;

  const year = input.now.getUTCFullYear();
  const sequence = (await tx.billingInvoice.count({ where: { organizationId: subscription.organizationId } })) + 1;
  const invoice = await tx.billingInvoice.create({
    data: {
      organizationId: subscription.organizationId,
      subscriptionId: subscription.id,
      number: `INV-${year}-${String(sequence).padStart(3, "0")}`,
      reason: input.reason,
      plan: subscription.plan,
      seatQuantity: subscription.seatQuantity,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      lines: input.lines as unknown as Prisma.InputJsonValue,
      totalCents,
      currency: subscription.currency,
      idempotencyKey: input.key,
      issuedAt: input.now,
      dueAt: new Date(input.now.getTime() + INVOICE_NET_TERMS_DAYS * DAY_MS),
    },
  });
  await recordEvent(tx, subscription.organizationId, "invoice_issued", SYSTEM, { number: invoice.number, totalCents, reason: input.reason });
  return invoice;
}

/**
 * Brings a subscription up to `now`: ends a trial, renews elapsed periods
 * (applying a scheduled downgrade or cancellation at each boundary), and
 * derives `past_due` from overdue invoices. Idempotent.
 */
async function advance(tx: Tx, start: Subscription, now: Date): Promise<Subscription> {
  let subscription = start;

  for (let step = 0; step < MAX_PERIOD_ADVANCES; step += 1) {
    const boundary = subscription.status === "trial" ? subscription.trialEndsAt ?? subscription.currentPeriodEnd : subscription.currentPeriodEnd;
    if (subscription.status === "cancelled" || boundary.getTime() > now.getTime()) break;

    if (subscription.cancelAtPeriodEnd) {
      subscription = await writeSubscription(tx, subscription, { status: "cancelled", endedAt: boundary, cancelAtPeriodEnd: false, pendingPlan: null });
      await recordEvent(tx, subscription.organizationId, "subscription_cancelled", SYSTEM, { endedAt: boundary.toISOString() });
      break;
    }

    let plan = subscription.plan as PlanId;
    let seatQuantity = subscription.seatQuantity;
    if (subscription.pendingPlan && isPlanId(subscription.pendingPlan)) {
      const target = subscription.pendingPlan;
      const seatsInUse = await countSeatsInUse(tx, subscription.organizationId, now);
      const { max } = seatBounds(target, seatsInUse);
      if (seatsInUse <= max) {
        await recordEvent(tx, subscription.organizationId, "plan_changed", SYSTEM, { from: plan, to: target, scheduled: true });
        plan = target;
        seatQuantity = Math.min(Math.max(seatQuantity, seatsInUse), max);
      } else {
        await recordEvent(tx, subscription.organizationId, "plan_change_skipped", SYSTEM, { from: plan, to: target, seatsInUse, seatLimit: max });
      }
    }

    const periodStart = boundary;
    const periodEnd = addMonthsUtc(periodStart, 1);
    const wasTrial = subscription.status === "trial";
    subscription = await writeSubscription(tx, subscription, {
      plan,
      seatQuantity,
      unitPriceCents: planPriceCents(plan),
      status: subscription.status === "past_due" ? "past_due" : "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      pendingPlan: null,
    });
    await recordEvent(tx, subscription.organizationId, wasTrial ? "trial_converted" : "subscription_renewed", SYSTEM, {
      plan,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });
    await issueInvoice(tx, subscription, {
      reason: "subscription_cycle",
      key: `cycle:${periodStart.toISOString()}`,
      periodStart,
      periodEnd,
      lines: cycleLines(plan, seatQuantity),
      now: periodStart.getTime() > now.getTime() ? now : periodStart,
    });
  }

  if (subscription.status === "active" || subscription.status === "past_due") {
    const overdue = await tx.billingInvoice.count({ where: { organizationId: subscription.organizationId, status: "open", dueAt: { lt: now } } });
    if (overdue > 0 && subscription.status === "active") {
      subscription = await writeSubscription(tx, subscription, { status: "past_due" });
      await recordEvent(tx, subscription.organizationId, "payment_overdue", SYSTEM, { overdueInvoices: overdue });
    } else if (overdue === 0 && subscription.status === "past_due") {
      subscription = await writeSubscription(tx, subscription, { status: "active" });
      await recordEvent(tx, subscription.organizationId, "payment_recovered", SYSTEM);
    }
  }

  if (subscription.version !== start.version) await syncOrganization(tx, subscription);
  return subscription;
}

/** Locks, loads and advances the subscription; refuses a stale `expectedVersion`. */
async function loadCurrent(tx: Tx, organizationId: string, now: Date, expectedVersion?: number): Promise<Subscription> {
  await lockOrganization(tx, organizationId);
  const subscription = await tx.billingSubscription.findUnique({ where: { organizationId } });
  if (!subscription) throw new BillingError("not_found", "This organization has no subscription yet.");
  if (expectedVersion !== undefined && subscription.version !== expectedVersion) {
    throw new BillingError("conflict", "Billing changed since this page loaded. Refresh and try again.");
  }
  return advance(tx, subscription, now);
}

async function finish(tx: Tx, subscription: Subscription, provider: BillingProvider | null): Promise<SubscriptionSnapshot> {
  await syncOrganization(tx, subscription);
  const snapshot = toSnapshot(subscription);
  // Inside the transaction: a provider failure rolls the internal change back.
  if (provider) await provider.syncSubscription(snapshot);
  return snapshot;
}

function parsePlan(plan: unknown): PlanId {
  if (!isPlanId(plan)) throw new BillingError("invalid_plan", `Unknown plan. Choose one of: ${PLAN_IDS.join(", ")}.`);
  return plan;
}

function requireSelfServe(plan: PlanId, actor: BillingActor): void {
  if (actor.type !== "operator" && !isSelfServePlan(plan)) {
    throw new BillingError("contact_sales", `${PLANS[plan].name} is priced by contract. Talk to us to move to it.`);
  }
}

function validateSeats(plan: PlanId, seatQuantity: number, seatsInUse: number): void {
  if (!Number.isInteger(seatQuantity)) throw new BillingError("invalid_seats", "Seats must be a whole number.");
  const { min, max } = seatBounds(plan, seatsInUse);
  if (seatQuantity < min) {
    throw new BillingError(
      "invalid_seats",
      seatsInUse > 0 ? `${seatsInUse} seats are in use, so at least ${min} must stay licensed.` : "At least one seat must be licensed.",
    );
  }
  if (seatQuantity > max) throw new BillingError("invalid_seats", `The ${PLANS[plan].name} plan allows at most ${max} seats.`);
}

const isUniqueConstraintError = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

// ---- Reads that write ----------------------------------------------------------

/** Brings the organization's subscription up to date. A no-op without one. Safe to call on every read. */
export async function reconcileSubscription(prisma: PrismaClient, organizationId: string, now: Date = new Date()): Promise<void> {
  const exists = await prisma.billingSubscription.findUnique({ where: { organizationId }, select: { id: true } });
  if (!exists) return;
  await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const subscription = await tx.billingSubscription.findUniqueOrThrow({ where: { organizationId } });
    await advance(tx, subscription, now);
  });
}

// ---- Customer transitions ------------------------------------------------------

/**
 * Subscribes to a plan, or restarts a cancelled subscription. During a running
 * trial the plan is chosen now and billing starts when the trial ends;
 * otherwise the first period starts now and its invoice is issued.
 */
export async function startSubscription(
  prisma: PrismaClient,
  params: MutationBase & { plan: unknown; seatQuantity?: number },
): Promise<SubscriptionSnapshot> {
  const now = params.now ?? new Date();
  const plan = parsePlan(params.plan);
  requireSelfServe(plan, params.actor);

  try {
    return await prisma.$transaction(async (tx) => {
      const organization = await lockOrganization(tx, params.organizationId);
      if (organization.planStatus === "internal") throw new BillingError("invalid_transition", "Internal organizations are not billed.");

      const existing = await tx.billingSubscription.findUnique({ where: { organizationId: params.organizationId } });
      if (existing && existing.status !== "cancelled") {
        throw new BillingError("invalid_transition", "This organization already has a subscription. Change its plan instead.");
      }

      const seatsInUse = await countSeatsInUse(tx, params.organizationId, now);
      const seatQuantity = params.seatQuantity ?? defaultSeatQuantity(plan, seatsInUse);
      validateSeats(plan, seatQuantity, seatsInUse);

      const trialEndsAt =
        !existing && organization.planStatus === "trial" && organization.trialEndsAt && organization.trialEndsAt.getTime() > now.getTime()
          ? organization.trialEndsAt
          : null;
      const values = {
        plan,
        status: (trialEndsAt ? "trial" : "active") as PlanStatus,
        seatQuantity,
        unitPriceCents: planPriceCents(plan),
        currency: CURRENCY,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt ?? addMonthsUtc(now, 1),
        trialEndsAt,
        cancelAtPeriodEnd: false,
        cancelRequestedAt: null,
        endedAt: null,
        pendingPlan: null,
      };

      const account = await tx.billingAccount.upsert({
        where: { organizationId: params.organizationId },
        create: { organizationId: params.organizationId, billingEmail: params.actor.type === "user" ? params.actor.email : null },
        update: {},
      });
      const subscription = existing
        ? await writeSubscription(tx, existing, values)
        : await tx.billingSubscription.create({ data: { ...values, organizationId: params.organizationId, billingAccountId: account.id } });

      await recordEvent(tx, params.organizationId, "subscription_started", params.actor, {
        plan,
        seatQuantity,
        trialEndsAt: trialEndsAt?.toISOString() ?? null,
        restarted: Boolean(existing),
      });
      if (!trialEndsAt) {
        await issueInvoice(tx, subscription, {
          reason: "subscription_create",
          key: `create:${subscription.version}:${now.toISOString()}`,
          periodStart: subscription.currentPeriodStart,
          periodEnd: subscription.currentPeriodEnd,
          lines: cycleLines(plan, seatQuantity),
          now,
        });
      }
      return finish(tx, subscription, params.provider);
    });
  } catch (error) {
    // Two first subscriptions racing for the same organization: the loser hits the unique key.
    if (isUniqueConstraintError(error)) throw new BillingError("conflict", "A subscription was just created for this organization. Refresh and try again.");
    throw error;
  }
}

/**
 * Moves to another plan. Upgrades apply now, with a prorated invoice for the
 * rest of the period; downgrades are scheduled for the end of the period
 * (picking the current plan again cancels a scheduled downgrade). During a
 * trial, and for an operator, every change applies now and nothing is
 * prorated. The seats in use must fit the target plan.
 */
export async function changeSubscriptionPlan(
  prisma: PrismaClient,
  params: VersionedMutation & { plan: unknown; audit?: BillingAuditHook },
): Promise<SubscriptionSnapshot> {
  const now = params.now ?? new Date();
  const target = parsePlan(params.plan);
  requireSelfServe(target, params.actor);

  return prisma.$transaction(async (tx) => {
    let subscription = await loadCurrent(tx, params.organizationId, now, params.expectedVersion);
    if (subscription.status === "cancelled") throw new BillingError("invalid_transition", "This subscription has ended. Start a new one instead.");
    const current = subscription.plan as PlanId;

    if (target === current) {
      const dropped = subscription.pendingPlan;
      if (!dropped) throw new BillingError("invalid_transition", `Already on the ${PLANS[current].name} plan.`);
      subscription = await writeSubscription(tx, subscription, { pendingPlan: null });
      await recordEvent(tx, params.organizationId, "plan_change_cancelled", params.actor, { kept: current, dropped });
      return finish(tx, subscription, params.provider);
    }

    const seatsInUse = await countSeatsInUse(tx, params.organizationId, now);
    const { max } = seatBounds(target, seatsInUse);
    if (seatsInUse > max) {
      throw new BillingError("invalid_seats", `${seatsInUse} seats are in use, but the ${PLANS[target].name} plan allows ${max}. Remove members or invitations first.`);
    }
    const seatQuantity = Math.min(Math.max(subscription.seatQuantity, seatsInUse), max);
    const immediate = subscription.status === "trial" || params.actor.type === "operator" || isUpgrade(current, target);

    if (!immediate) {
      subscription = await writeSubscription(tx, subscription, { pendingPlan: target });
      await recordEvent(tx, params.organizationId, "plan_change_scheduled", params.actor, {
        from: current,
        to: target,
        effectiveAt: subscription.currentPeriodEnd.toISOString(),
      });
      return finish(tx, subscription, params.provider);
    }

    const before = subscription;
    subscription = await writeSubscription(tx, subscription, { plan: target, seatQuantity, unitPriceCents: planPriceCents(target), pendingPlan: null });
    await recordEvent(tx, params.organizationId, "plan_changed", params.actor, { from: current, to: target, seatQuantity });

    // Prorate an upgrade for the rest of the current paid period.
    const oldPrice = before.unitPriceCents;
    const newPrice = subscription.unitPriceCents;
    if (subscription.status !== "trial" && oldPrice !== null && newPrice !== null && newPrice > oldPrice) {
      const periodMs = subscription.currentPeriodEnd.getTime() - subscription.currentPeriodStart.getTime();
      const remainingMs = Math.max(0, subscription.currentPeriodEnd.getTime() - now.getTime());
      const amountCents = Math.round(((newPrice - oldPrice) * remainingMs) / periodMs);
      if (amountCents > 0) {
        await issueInvoice(tx, subscription, {
          reason: "subscription_update",
          key: `update:${subscription.version}`,
          periodStart: now,
          periodEnd: subscription.currentPeriodEnd,
          lines: [{ label: `Upgrade to ${PLANS[target].name}`, detail: `Prorated from ${PLANS[current].name} for the rest of the period`, amountCents }],
          now,
        });
      }
    }
    await params.audit?.(tx);
    return finish(tx, subscription, params.provider);
  });
}

/** Changes the licensed seat count within the plan's range. Plans are flat-priced, so the price does not change. */
export async function changeSeatQuantity(prisma: PrismaClient, params: VersionedMutation & { seatQuantity: number }): Promise<SubscriptionSnapshot> {
  const now = params.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    let subscription = await loadCurrent(tx, params.organizationId, now, params.expectedVersion);
    if (subscription.status === "cancelled") throw new BillingError("invalid_transition", "This subscription has ended.");
    const seatsInUse = await countSeatsInUse(tx, params.organizationId, now);
    validateSeats(subscription.plan as PlanId, params.seatQuantity, seatsInUse);
    if (params.seatQuantity === subscription.seatQuantity) throw new BillingError("invalid_transition", `${params.seatQuantity} seats are already licensed.`);

    const from = subscription.seatQuantity;
    subscription = await writeSubscription(tx, subscription, { seatQuantity: params.seatQuantity });
    await recordEvent(tx, params.organizationId, "seats_changed", params.actor, { from, to: params.seatQuantity, seatsInUse });
    return finish(tx, subscription, params.provider);
  });
}

/** Schedules cancellation at the end of the current period (or trial). Resumable until then. */
export async function cancelSubscription(prisma: PrismaClient, params: VersionedMutation): Promise<SubscriptionSnapshot> {
  const now = params.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    let subscription = await loadCurrent(tx, params.organizationId, now, params.expectedVersion);
    if (subscription.status === "cancelled") throw new BillingError("invalid_transition", "This subscription has already ended.");
    if (subscription.cancelAtPeriodEnd) throw new BillingError("invalid_transition", "Cancellation is already scheduled.");

    subscription = await writeSubscription(tx, subscription, { cancelAtPeriodEnd: true, cancelRequestedAt: now });
    const effectiveAt = subscription.status === "trial" ? subscription.trialEndsAt ?? subscription.currentPeriodEnd : subscription.currentPeriodEnd;
    await recordEvent(tx, params.organizationId, "cancellation_scheduled", params.actor, { effectiveAt: effectiveAt.toISOString() });
    return finish(tx, subscription, params.provider);
  });
}

/** Withdraws a scheduled cancellation. A subscription that has already ended is restarted with `startSubscription`. */
export async function resumeSubscription(prisma: PrismaClient, params: VersionedMutation): Promise<SubscriptionSnapshot> {
  const now = params.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    let subscription = await loadCurrent(tx, params.organizationId, now, params.expectedVersion);
    if (subscription.status === "cancelled") throw new BillingError("invalid_transition", "This subscription has ended. Choose a plan to start a new one.");
    if (!subscription.cancelAtPeriodEnd) throw new BillingError("invalid_transition", "No cancellation is scheduled.");

    subscription = await writeSubscription(tx, subscription, { cancelAtPeriodEnd: false, cancelRequestedAt: null });
    await recordEvent(tx, params.organizationId, "subscription_resumed", params.actor);
    return finish(tx, subscription, params.provider);
  });
}

export interface BillingAccountInput {
  billingEmail: string | null;
  legalName: string | null;
  addressLines: string[];
  country: string | null;
  taxId: string | null;
  ccEmails: string[];
}

/** Replaces the billing profile invoices are addressed to. Input must already be validated by the caller. */
export async function updateBillingAccount(prisma: PrismaClient, params: { organizationId: string; actor: BillingActor; input: BillingAccountInput }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, params.organizationId);
    const before = await tx.billingAccount.findUnique({ where: { organizationId: params.organizationId } });
    const account = await tx.billingAccount.upsert({
      where: { organizationId: params.organizationId },
      create: { organizationId: params.organizationId, ...params.input },
      update: params.input,
    });
    const changed = (Object.keys(params.input) as (keyof BillingAccountInput)[]).filter(
      (key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(account[key] ?? null),
    );
    if (changed.length > 0) await recordEvent(tx, params.organizationId, "account_updated", params.actor, { fields: changed });
  });
}

// ---- Operator overrides ----------------------------------------------------------

async function loadInvoice(tx: Tx, organizationId: string, invoiceId: string): Promise<BillingInvoice> {
  const invoice = await tx.billingInvoice.findFirst({ where: { id: invoiceId, organizationId } });
  if (!invoice) throw new BillingError("not_found", "Invoice not found");
  return invoice;
}

/** Records payment received outside a provider (bank transfer, direct invoice). Clears `past_due` once nothing is overdue. */
export async function markInvoicePaid(
  prisma: PrismaClient,
  params: { organizationId: string; invoiceId: string; actor: BillingActor; now?: Date; audit?: BillingAuditHook },
): Promise<void> {
  const now = params.now ?? new Date();
  await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, params.organizationId);
    const invoice = await loadInvoice(tx, params.organizationId, params.invoiceId);
    if (invoice.status !== "open") throw new BillingError("invalid_transition", `Invoice ${invoice.number} is ${invoice.status}, not open.`);
    await tx.billingInvoice.update({ where: { id: invoice.id }, data: { status: "paid", paidAt: now } });
    await recordEvent(tx, params.organizationId, "invoice_paid", params.actor, { number: invoice.number, totalCents: invoice.totalCents });
    await params.audit?.(tx);
    const subscription = await tx.billingSubscription.findUnique({ where: { organizationId: params.organizationId } });
    if (subscription) await advance(tx, subscription, now);
  });
}

/** Writes an open invoice off (comped). Clears `past_due` once nothing is overdue. */
export async function voidInvoice(
  prisma: PrismaClient,
  params: { organizationId: string; invoiceId: string; actor: BillingActor; now?: Date; audit?: BillingAuditHook },
): Promise<void> {
  const now = params.now ?? new Date();
  await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, params.organizationId);
    const invoice = await loadInvoice(tx, params.organizationId, params.invoiceId);
    if (invoice.status !== "open") throw new BillingError("invalid_transition", `Invoice ${invoice.number} is ${invoice.status}, not open.`);
    await tx.billingInvoice.update({ where: { id: invoice.id }, data: { status: "void", voidedAt: now } });
    await recordEvent(tx, params.organizationId, "invoice_voided", params.actor, { number: invoice.number, totalCents: invoice.totalCents });
    await params.audit?.(tx);
    const subscription = await tx.billingSubscription.findUnique({ where: { organizationId: params.organizationId } });
    if (subscription) await advance(tx, subscription, now);
  });
}

/**
 * Grants `GRACE_EXTENSION_DAYS` more: pushes every open invoice's due date
 * out (from today if already overdue) and, during a trial, the trial end.
 */
export async function extendGrace(prisma: PrismaClient, params: { organizationId: string; actor: BillingActor; now?: Date; audit?: BillingAuditHook }): Promise<void> {
  const now = params.now ?? new Date();
  const extension = GRACE_EXTENSION_DAYS * DAY_MS;
  await prisma.$transaction(async (tx) => {
    let subscription = await loadCurrent(tx, params.organizationId, now);
    const open = await tx.billingInvoice.findMany({ where: { organizationId: params.organizationId, status: "open" } });
    if (open.length === 0 && subscription.status !== "trial") throw new BillingError("invalid_transition", "Nothing is due and no trial is running.");

    for (const invoice of open) {
      await tx.billingInvoice.update({ where: { id: invoice.id }, data: { dueAt: new Date(Math.max(invoice.dueAt.getTime(), now.getTime()) + extension) } });
    }
    if (subscription.status === "trial" && subscription.trialEndsAt) {
      const trialEndsAt = new Date(subscription.trialEndsAt.getTime() + extension);
      subscription = await writeSubscription(tx, subscription, { trialEndsAt, currentPeriodEnd: trialEndsAt });
    }
    await recordEvent(tx, params.organizationId, "grace_extended", params.actor, { days: GRACE_EXTENSION_DAYS, invoices: open.map((invoice) => invoice.number) });
    await params.audit?.(tx);
    await advance(tx, subscription, now);
    await syncOrganization(tx, await tx.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } }));
  });
}

export async function addBillingNote(prisma: PrismaClient, params: { organizationId: string; actor: BillingActor; note: string; audit?: BillingAuditHook }): Promise<void> {
  const note = params.note.trim();
  if (note.length === 0) throw new BillingError("invalid_input", "A note cannot be empty.");
  await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, params.organizationId);
    await recordEvent(tx, params.organizationId, "operator_note", params.actor, { note });
    await params.audit?.(tx);
  });
}

/** Writes off every open invoice at once (comped), then re-derives the status. */
export async function voidOpenInvoices(
  prisma: PrismaClient,
  params: { organizationId: string; actor: BillingActor; now?: Date; audit?: BillingAuditHook },
): Promise<{ voided: number }> {
  const now = params.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockOrganization(tx, params.organizationId);
    const open = await tx.billingInvoice.findMany({ where: { organizationId: params.organizationId, status: "open" } });
    if (open.length === 0) throw new BillingError("invalid_transition", "There are no open invoices to comp.");
    await tx.billingInvoice.updateMany({ where: { id: { in: open.map((invoice) => invoice.id) } }, data: { status: "void", voidedAt: now } });
    for (const invoice of open) {
      await recordEvent(tx, params.organizationId, "invoice_voided", params.actor, { number: invoice.number, totalCents: invoice.totalCents, comped: true });
    }
    await params.audit?.(tx);
    const subscription = await tx.billingSubscription.findUnique({ where: { organizationId: params.organizationId } });
    if (subscription) await advance(tx, subscription, now);
    return { voided: open.length };
  });
}

/** Tries to collect an open invoice through the provider. Needs one. */
export async function collectInvoice(
  prisma: PrismaClient,
  params: { organizationId: string; invoiceId: string; actor: BillingActor; provider: BillingProvider | null; now?: Date },
): Promise<{ paid: boolean }> {
  if (!params.provider) throw new BillingError("provider_unavailable", "Collecting a payment needs a payment provider, and none is connected.");
  const invoice = await prisma.billingInvoice.findFirst({ where: { id: params.invoiceId, organizationId: params.organizationId } });
  if (!invoice) throw new BillingError("not_found", "Invoice not found");
  if (invoice.status !== "open") throw new BillingError("invalid_transition", `Invoice ${invoice.number} is ${invoice.status}, not open.`);
  const result = await params.provider.collectInvoice({
    organizationId: params.organizationId,
    invoiceNumber: invoice.number,
    amountCents: invoice.totalCents,
    currency: invoice.currency,
  });
  if (result.paid) await markInvoicePaid(prisma, { organizationId: params.organizationId, invoiceId: invoice.id, actor: params.actor, now: params.now });
  return { paid: result.paid };
}
