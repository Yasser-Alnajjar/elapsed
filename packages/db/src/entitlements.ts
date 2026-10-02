import type { IntegrationProvider, PlanStatus, PrismaClient } from "../generated/prisma/client";
import { isPlanId, PLANS, type LimitedResource } from "./plans";
import { getOrganizationUsage, type OrganizationUsage, type ProviderRoleOf } from "./usage";

/**
 * Entitlement decisions (N6.3, N6.4). These answer one question, "may this
 * organization create one more of X?", and only at the three creation points:
 * invite a member, connect an integration, create a native policy.
 *
 * Nothing here is ever consulted by ingestion, evaluation, notifications or
 * sync, and nothing deletes or disables existing data. A tenant over every
 * limit, or with a lapsed trial, is still polled, evaluated and alerted.
 *
 * - Reaching or going over a plan limit: **warn**. The creation goes ahead and the event is
 *   recorded for the platform admin. D14 does not require a hard block.
 * - Trial lapsed (D27): **blocked**, for new configuration only.
 * - `WorkerSettings.entitlementsEnforced` off (the default), no plan recorded,
 *   a trial still running, or `internal`: **allow**.
 */

export interface PlanSubject {
  plan: string | null;
  planStatus: PlanStatus;
  trialEndsAt: Date | null;
}

export type EntitlementDecision =
  | { outcome: "allow" }
  /** `used` is the count after this creation: `used === limit` means the plan limit is now reached, `used > limit` exceeded. */
  | { outcome: "warn"; resource: LimitedResource; used: number; limit: number }
  | { outcome: "blocked"; reason: "trial_expired"; trialEndedAt: Date };

/** A trial is lapsed once `trialEndsAt` has passed. A trial with no end date never lapses. */
export function isTrialExpired(subject: PlanSubject, now: Date): boolean {
  return subject.planStatus === "trial" && subject.trialEndsAt !== null && subject.trialEndsAt.getTime() <= now.getTime();
}

/** Pure decision for creating one more of `resource`, given current usage. */
export function evaluateCreation(
  subject: PlanSubject,
  usage: OrganizationUsage,
  resource: LimitedResource,
  now: Date,
): EntitlementDecision {
  if (subject.planStatus === "internal") return { outcome: "allow" };
  if (isTrialExpired(subject, now)) return { outcome: "blocked", reason: "trial_expired", trialEndedAt: subject.trialEndsAt! };
  // A running trial has full access, as the pricing page says.
  if (subject.planStatus === "trial") return { outcome: "allow" };
  if (!isPlanId(subject.plan)) return { outcome: "allow" };

  const limit = PLANS[subject.plan].limits[resource];
  if (limit === null) return { outcome: "allow" };
  // Warn when this creation reaches the limit or goes past it; never block on it.
  const usedAfter = usage[resource] + 1;
  return usedAfter >= limit ? { outcome: "warn", resource, used: usedAfter, limit } : { outcome: "allow" };
}

/** Which limited resource connecting `provider` would consume. */
export function integrationResource(provider: IntegrationProvider, roleOf: ProviderRoleOf): LimitedResource {
  return roleOf(provider) === "ticket_source" ? "ticketSourceIntegrations" : "engineeringIntegrations";
}

export const ENTITLEMENT_EVENT_KINDS = ["limit_warned", "creation_blocked", "trial_expired"] as const;
export type EntitlementEventKind = (typeof ENTITLEMENT_EVENT_KINDS)[number];

const isUniqueConstraintError = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

const dayKey = (now: Date) => now.toISOString().slice(0, 10);

/** Inserts one event; a repeat with the same key is a silent no-op. Returns whether this call wrote the row. */
async function recordEvent(
  prisma: PrismaClient,
  data: { organizationId: string; kind: EntitlementEventKind; resource: LimitedResource | null; dedupeKey: string; used?: number; limit?: number },
): Promise<boolean> {
  try {
    await prisma.entitlementEvent.create({ data });
    return true;
  } catch (error) {
    if (isUniqueConstraintError(error)) return false;
    throw error;
  }
}

/**
 * The operator switch. Any failure to read it (a database or client that has
 * not been migrated to this release yet, a transient error) means "off": plan
 * state must never break a page or a creation point.
 */
async function readEnforced(prisma: PrismaClient): Promise<boolean> {
  try {
    const settings = await prisma.workerSettings.findUnique({ where: { id: "singleton" }, select: { entitlementsEnforced: true } });
    return settings?.entitlementsEnforced === true;
  } catch {
    return false;
  }
}

export interface CheckEntitlementOptions {
  roleOf: ProviderRoleOf;
  now?: Date;
}

/**
 * Evaluates, and records, one creation. Returns `allow` straight away, with a
 * single settings read and no other query, while enforcement is off.
 *
 * Recording is best-effort: a failure to write the event is swallowed so the
 * creation point is never broken by bookkeeping. One row per organization,
 * kind, resource and day.
 */
export async function checkEntitlement(
  prisma: PrismaClient,
  organizationId: string,
  resource: LimitedResource,
  options: CheckEntitlementOptions,
): Promise<EntitlementDecision> {
  const now = options.now ?? new Date();

  if (!(await readEnforced(prisma))) return { outcome: "allow" };

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, planStatus: true, trialEndsAt: true },
  });
  if (!organization) return { outcome: "allow" };

  // Usage is only needed when a limit could apply.
  const needsUsage = organization.planStatus !== "internal" && !isTrialExpired(organization, now);
  const usage = needsUsage
    ? await getOrganizationUsage(prisma, organizationId, options.roleOf, now)
    : { seats: 0, ticketSourceIntegrations: 0, engineeringIntegrations: 0, nativePolicies: 0 };

  const decision = evaluateCreation(organization, usage, resource, now);
  if (decision.outcome === "allow") return decision;

  try {
    if (decision.outcome === "warn") {
      await recordEvent(prisma, {
        organizationId,
        kind: "limit_warned",
        resource,
        dedupeKey: `${resource}:${dayKey(now)}`,
        used: decision.used,
        limit: decision.limit,
      });
    } else {
      await recordEvent(prisma, { organizationId, kind: "creation_blocked", resource, dedupeKey: `${resource}:${dayKey(now)}` });
    }
  } catch {
    // Bookkeeping must not break the creation point.
  }
  return decision;
}

export interface TrialStatusNotice {
  state: "trial_expired";
  trialEndedAt: Date;
  /** Whether new configuration is actually blocked, i.e. `entitlementsEnforced` is on. Off: the notice is informational only. */
  restricted: boolean;
}

/**
 * The notice a signed-in member sees. An ended trial is reported from the
 * organization's own plan state whether or not enforcement is on, because it
 * is information, not a restriction (`restricted` says which). Over-limit
 * resources are only reported while enforcement is on. Two reads at most:
 * the settings row and the organization, plus usage when a limit can apply.
 */
export async function getEntitlementNotice(
  prisma: PrismaClient,
  organizationId: string,
  options: CheckEntitlementOptions,
): Promise<{ trialExpired: TrialStatusNotice | null; overLimit: { resource: LimitedResource; used: number; limit: number }[] }> {
  const none = { trialExpired: null, overLimit: [] };
  const now = options.now ?? new Date();

  const enforced = await readEnforced(prisma);

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, planStatus: true, trialEndsAt: true },
  });
  if (!organization || organization.planStatus === "internal") return none;

  if (isTrialExpired(organization, now)) {
    return { trialExpired: { state: "trial_expired", trialEndedAt: organization.trialEndsAt!, restricted: enforced }, overLimit: [] };
  }
  if (!enforced) return none;
  if (organization.planStatus === "trial" || !isPlanId(organization.plan)) return none;

  const usage = await getOrganizationUsage(prisma, organizationId, options.roleOf, now);
  const limits = PLANS[organization.plan].limits;
  const overLimit = (Object.keys(limits) as LimitedResource[]).flatMap((resource) => {
    const limit = limits[resource];
    return limit !== null && usage[resource] > limit ? [{ resource, used: usage[resource], limit }] : [];
  });
  return { trialExpired: null, overLimit };
}

export interface TrialExpiryResult {
  /** `expired` and this call was the first to see it; `already_handled` it was recorded earlier; `not_expired` nothing to do. */
  outcome: "not_expired" | "already_handled" | "marked";
  /** The owner addresses to email; present only when `marked`. */
  ownerEmails: string[];
  trialEndedAt: Date | null;
}

/**
 * The daily trial check, run from the worker's reconciliation tick (N6.4).
 * Idempotent per organization and trial end date: the first call after the
 * trial lapses claims the `trial_expired` event and returns the owners to
 * email; every later call returns `already_handled`. Never changes what the
 * worker does for the organization.
 */
export async function markTrialExpiry(prisma: PrismaClient, organizationId: string, now: Date = new Date()): Promise<TrialExpiryResult> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, planStatus: true, trialEndsAt: true },
  });
  if (!organization || !isTrialExpired(organization, now)) return { outcome: "not_expired", ownerEmails: [], trialEndedAt: null };

  const trialEndedAt = organization.trialEndsAt!;
  const claimed = await recordEvent(prisma, {
    organizationId,
    kind: "trial_expired",
    resource: null,
    dedupeKey: trialEndedAt.toISOString().slice(0, 10),
  });
  if (!claimed) return { outcome: "already_handled", ownerEmails: [], trialEndedAt };

  const owners = await prisma.user.findMany({ where: { organizationId, role: "owner" }, select: { email: true } });
  return { outcome: "marked", ownerEmails: owners.map((owner) => owner.email), trialEndedAt };
}

/** Records that the owner email went out. A failed send releases the claim so the next tick retries. */
export async function settleTrialExpiryNotice(
  prisma: PrismaClient,
  organizationId: string,
  trialEndedAt: Date,
  outcome: "sent" | "failed",
  now: Date = new Date(),
): Promise<void> {
  const key = { organizationId_kind_dedupeKey: { organizationId, kind: "trial_expired", dedupeKey: trialEndedAt.toISOString().slice(0, 10) } };
  if (outcome === "sent") await prisma.entitlementEvent.update({ where: key, data: { notifiedAt: now } });
  else await prisma.entitlementEvent.delete({ where: key });
}
