import { applySupportOverride } from "@sla/custom-ticket";
import type { Prisma, PrismaClient } from "@sla/db";
import { recordAdminAudit } from "./admin-audit";
import {
  BILLING_REFERENCE_MAX_LENGTH,
  PLAN_IDS,
  PLAN_STATUSES,
  type IntegrationControl,
  type PlanId,
  type PlanRecord,
  type PlanStatus,
} from "./types/admin";

/**
 * The platform admin's writes (N4.3, N4.5). Each one is a single transaction
 * that makes the change and writes exactly one audit row, so there is no
 * un-audited change and no audit row for a change that did not happen. A
 * request that would change nothing writes neither.
 *
 * None of these edits tenant data. The plan record is informational and no
 * code reads it to decide monitoring behaviour; the two integration flags are
 * read only by the worker (`apps/worker/src/cycle.ts`).
 */

export class AdminValidationError extends Error {}
export class AdminNotFoundError extends Error {}
/** The request is well formed but the current state does not allow it. */
export class AdminConflictError extends Error {}

// ---- Plan record (N4.3) ------------------------------------------------------

/** Validates an untrusted request body into a `PlanRecord`; throws `AdminValidationError` with a message fit to show. */
export function parsePlanRecordInput(body: unknown): PlanRecord {
  if (typeof body !== "object" || body === null) throw new AdminValidationError("A plan record is required");
  const input = body as Record<string, unknown>;

  const plan = input.plan ?? null;
  if (plan !== null && !(typeof plan === "string" && (PLAN_IDS as readonly string[]).includes(plan))) {
    throw new AdminValidationError(`plan must be one of: ${PLAN_IDS.join(", ")}, or empty`);
  }

  if (typeof input.planStatus !== "string" || !(PLAN_STATUSES as readonly string[]).includes(input.planStatus)) {
    throw new AdminValidationError(`planStatus must be one of: ${PLAN_STATUSES.join(", ")}`);
  }

  let trialEndsAt: string | null = null;
  if (input.trialEndsAt !== undefined && input.trialEndsAt !== null && input.trialEndsAt !== "") {
    const parsed = typeof input.trialEndsAt === "string" ? new Date(input.trialEndsAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) throw new AdminValidationError("trialEndsAt must be a valid date");
    trialEndsAt = parsed.toISOString();
  }

  let billingReference: string | null = null;
  if (input.billingReference !== undefined && input.billingReference !== null) {
    if (typeof input.billingReference !== "string") throw new AdminValidationError("billingReference must be text");
    const trimmed = input.billingReference.trim();
    if (trimmed.length > BILLING_REFERENCE_MAX_LENGTH) {
      throw new AdminValidationError(`billingReference must be at most ${BILLING_REFERENCE_MAX_LENGTH} characters`);
    }
    billingReference = trimmed === "" ? null : trimmed;
  }

  return { plan: plan as PlanId | null, planStatus: input.planStatus as PlanStatus, trialEndsAt, billingReference };
}

function toRecord(row: {
  plan: string | null;
  planStatus: string;
  trialEndsAt: Date | null;
  billingReference: string | null;
}): PlanRecord {
  return {
    plan: row.plan,
    planStatus: row.planStatus as PlanStatus,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    billingReference: row.billingReference,
  };
}

export async function updatePlanRecord(
  prisma: PrismaClient,
  params: { actorEmail: string; organizationId: string; input: PlanRecord },
): Promise<{ changed: boolean; planRecord: PlanRecord }> {
  const { actorEmail, organizationId, input } = params;

  return prisma.$transaction(async (tx) => {
    const current = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, planStatus: true, trialEndsAt: true, billingReference: true },
    });
    if (!current) throw new AdminNotFoundError("Organization not found");

    const before = toRecord(current);
    if (JSON.stringify(before) === JSON.stringify(input)) return { changed: false, planRecord: before };

    await tx.organization.update({
      where: { id: organizationId },
      data: {
        plan: input.plan,
        planStatus: input.planStatus,
        trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
        billingReference: input.billingReference,
      },
    });
    await recordAdminAudit(tx, {
      actorEmail,
      action: "update_plan",
      organizationId,
      metadata: { before, after: input } as unknown as Prisma.InputJsonValue,
    });
    return { changed: true, planRecord: input };
  });
}

// ---- Integration controls (N4.5) ---------------------------------------------

/**
 * Pause or resume polling for one integration, or ask for one full
 * re-normalization on the worker's next run. Scoped to a single integration.
 * Throws `AdminNotFoundError` for an unknown integration and
 * `AdminConflictError` when the request is a no-op or the integration is
 * disconnected (it has nothing to poll or normalize).
 */
export async function controlIntegration(
  prisma: PrismaClient,
  params: { actorEmail: string; integrationId: string; action: IntegrationControl; now?: Date },
): Promise<void> {
  const { actorEmail, integrationId, action } = params;
  const now = params.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    const integration = await tx.integration.findUnique({
      where: { id: integrationId },
      select: { organizationId: true, provider: true, status: true, pollingPausedAt: true, renormalizeRequestedAt: true },
    });
    if (!integration) throw new AdminNotFoundError("Integration not found");
    if (integration.status === "disconnected") {
      throw new AdminConflictError("This integration is disconnected, so there is nothing to poll or re-normalize");
    }

    if (action === "pause_polling") {
      if (integration.pollingPausedAt) throw new AdminConflictError("Polling is already paused");
      await tx.integration.update({ where: { id: integrationId }, data: { pollingPausedAt: now } });
    } else if (action === "resume_polling") {
      if (!integration.pollingPausedAt) throw new AdminConflictError("Polling is not paused");
      await tx.integration.update({ where: { id: integrationId }, data: { pollingPausedAt: null } });
    } else {
      if (integration.renormalizeRequestedAt) {
        throw new AdminConflictError("A re-normalization is already requested and waiting for the worker");
      }
      await tx.integration.update({ where: { id: integrationId }, data: { renormalizeRequestedAt: now } });
    }

    await recordAdminAudit(tx, {
      actorEmail,
      action,
      organizationId: integration.organizationId,
      integrationId,
      metadata: { provider: integration.provider },
    });
  });
}

// ---- Custom REST Beta flag (N9, plan 09 8.7) -----------------------------------

/**
 * Turns the `custom` source's Beta flag on or off for one organization, audited.
 * Turning it OFF also pauses polling on the organization's custom integration
 * (the N4.5 pause the worker already honors, recorded as a pause and not as a
 * failed sync), so the disabled flag cannot start another sync even before the
 * adapter's own flag check runs. Turning it back ON does not resume a pause:
 * the operator resumes polling with the existing control. Data stays visible
 * and monitored either way. A request that changes nothing writes nothing.
 */
export async function setCustomProviderFlag(
  prisma: PrismaClient,
  params: { actorEmail: string; organizationId: string; enabled: boolean; now?: Date },
): Promise<{ changed: boolean; pausedPolling: boolean }> {
  const { actorEmail, organizationId, enabled } = params;
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { customProviderEnabled: true } });
    if (!organization) throw new AdminNotFoundError("Organization not found");
    if (organization.customProviderEnabled === enabled) return { changed: false, pausedPolling: false };

    await tx.organization.update({ where: { id: organizationId }, data: { customProviderEnabled: enabled } });
    let pausedPolling = false;
    if (!enabled) {
      const paused = await tx.integration.updateMany({
        where: { organizationId, provider: "custom", status: { not: "disconnected" }, pollingPausedAt: null },
        data: { pollingPausedAt: now },
      });
      pausedPolling = paused.count > 0;
    }
    await recordAdminAudit(tx, {
      actorEmail,
      action: enabled ? "enable_custom_provider" : "disable_custom_provider",
      organizationId,
      metadata: { pausedPolling },
    });
    return { changed: true, pausedPolling };
  });
}

// ---- Support-assisted guard override (N9, plan 09 6.11, U6) --------------------

/**
 * Applies the organization owner's recorded authorization for one guard
 * override. The operator can neither create nor assert that authorization:
 * this fails unless the owner recorded it for this exact override, it is
 * unexpired and unused. The durable `GuardOverride` row and the platform-side
 * `AdminAuditLog` entry commit together. The next sync pass then projects the
 * previewed record set once.
 */
export async function applyGuardOverride(
  prisma: PrismaClient,
  params: { actorEmail: string; overrideId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const applied = await applySupportOverride(tx, { overrideId: params.overrideId, operatorEmail: params.actorEmail });
    await recordAdminAudit(tx, {
      actorEmail: params.actorEmail,
      action: "apply_guard_override",
      organizationId: applied.organizationId,
      integrationId: applied.integrationId,
      metadata: { guard: "mass_lifecycle_change", previewHash: applied.previewHash, overrideId: params.overrideId },
    });
  });
}
