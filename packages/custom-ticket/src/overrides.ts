import type { Prisma, PrismaClient } from "@sla/db";
import { LIFECYCLE_GUARD } from "./normalize";
import { isRunSuperseded } from "./supersession";

/**
 * Override of the mass-lifecycle-change guard (plan 09, 6.11; Q15, R1, R2, U1,
 * U6). Only this guard can be overridden: never the failed-record ratio, the
 * ceiling, the budget, tenant isolation or security validation, and a mass
 * deletion is never forced. An override is a narrow, single-use, expiring
 * confirmation bound to the exact record set a preview showed (a hash). The
 * engine honors only a CONFIRMED row (`confirmedAt` set) that is unexpired and
 * unconsumed; a changed record set changes the hash and voids it.
 *
 * Authority is decided by the routes: the organization owner for the customer
 * path (U1), and a separate operator allowlist plus the owner's recorded
 * authorization for the support-assisted path (U6).
 */
export const OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000; // proposed in plan 09 (15.2), settled by the N9.11 review
export const MAX_REASON_LENGTH = 500;

export type OverrideErrorCode =
  | "no_aborted_pass"
  | "stale_preview"
  | "reason_required"
  | "not_found"
  | "not_authorized_by_owner"
  | "expired"
  | "already_used";

export class OverrideError extends Error {
  readonly code: OverrideErrorCode;
  constructor(code: OverrideErrorCode) {
    super(code);
    this.name = "OverrideError";
    this.code = code;
  }
}

export interface AbortedPassPreview {
  runId: string;
  startedAt: string;
  /** `R`, `L`, ratio, up to 20 record ids and the hash of the full record set. */
  counts: { R: number; L: number; ratio: number | null };
  recordIds: string[];
  previewHash: string;
}

/**
 * The latest run, when it is a lifecycle-guard abort. A later run of any stored
 * outcome means there is nothing to override, and so does a later clean check
 * that was not stored because it changed nothing (D32).
 */
export async function latestLifecycleAbort(prisma: PrismaClient, integrationId: string): Promise<AbortedPassPreview | null> {
  const [run, integration] = await Promise.all([
    prisma.integrationSyncRun.findFirst({
      where: { integrationId },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true, finishedAt: true, outcome: true, reasonCode: true, progress: true },
    }),
    prisma.integration.findUnique({ where: { id: integrationId }, select: { lastSuccessfulSyncAt: true } }),
  ]);
  if (!run || run.outcome !== "aborted" || run.reasonCode !== LIFECYCLE_GUARD) return null;
  if (isRunSuperseded(run, integration?.lastSuccessfulSyncAt)) return null;
  const progress = (run.progress ?? {}) as { R?: unknown; L?: unknown; ratio?: unknown; recordIds?: unknown; previewHash?: unknown };
  if (typeof progress.previewHash !== "string") return null;
  return {
    runId: run.id,
    startedAt: run.startedAt.toISOString(),
    counts: {
      R: typeof progress.R === "number" ? progress.R : 0,
      L: typeof progress.L === "number" ? progress.L : 0,
      ratio: typeof progress.ratio === "number" ? progress.ratio : null,
    },
    recordIds: Array.isArray(progress.recordIds) ? progress.recordIds.filter((id): id is string => typeof id === "string").slice(0, 20) : [],
    previewHash: progress.previewHash,
  };
}

async function createOverride(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    integrationId: string;
    userId: string;
    previewHash: string;
    reason: string;
    path: "customer" | "support_assisted";
    now: Date;
  },
): Promise<{ id: string; expiresAt: Date }> {
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) throw new OverrideError("reason_required");
  const aborted = await latestLifecycleAbort(prisma, input.integrationId);
  if (!aborted) throw new OverrideError("no_aborted_pass");
  if (aborted.previewHash !== input.previewHash) throw new OverrideError("stale_preview");
  const expiresAt = new Date(input.now.getTime() + OVERRIDE_TTL_MS);
  return prisma.$transaction(async (tx) => {
    // One live override per integration and guard: a new request voids any earlier unused one.
    await tx.guardOverride.updateMany({
      where: { integrationId: input.integrationId, guard: LIFECYCLE_GUARD, consumedAt: null },
      data: { consumedAt: input.now, outcome: "void" },
    });
    const row = await tx.guardOverride.create({
      data: {
        organizationId: input.organizationId,
        integrationId: input.integrationId,
        guard: LIFECYCLE_GUARD,
        previewHash: input.previewHash,
        counts: aborted.counts as unknown as Prisma.InputJsonValue,
        reason,
        path: input.path,
        requestedByUserId: input.userId,
        ...(input.path === "support_assisted" ? { authorizedByUserId: input.userId } : { confirmedAt: input.now }),
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });
    return row;
  });
}

/** Customer path: the owner confirms the exact previewed record set with a reason. Effective at once for the next pass. */
export function confirmCustomerOverride(
  prisma: PrismaClient,
  input: { organizationId: string; integrationId: string; userId: string; previewHash: string; reason: string; now?: Date },
) {
  return createOverride(prisma, { ...input, path: "customer", now: input.now ?? new Date() });
}

/**
 * Support-assisted path, step 1: the owner records an authorization bound to
 * the same preview hash (single use, expiring). Nothing is overridden yet; an
 * operator with the distinct permission must apply exactly this authorization.
 * The operator can neither create nor assert it.
 */
export function authorizeSupportOverride(
  prisma: PrismaClient,
  input: { organizationId: string; integrationId: string; userId: string; previewHash: string; reason: string; now?: Date },
) {
  return createOverride(prisma, { ...input, path: "support_assisted", now: input.now ?? new Date() });
}

/**
 * Support-assisted path, step 2, inside the caller's transaction (which also
 * writes the `AdminAuditLog` row): the operator applies the owner's recorded
 * authorization. Refused unless the owner authorized this exact override, it
 * is unexpired and it is still unused.
 */
export async function applySupportOverride(
  tx: Prisma.TransactionClient,
  input: { overrideId: string; operatorEmail: string; now?: Date },
): Promise<{ organizationId: string; integrationId: string; previewHash: string }> {
  const now = input.now ?? new Date();
  const row = await tx.guardOverride.findUnique({ where: { id: input.overrideId } });
  if (!row || row.path !== "support_assisted" || row.guard !== LIFECYCLE_GUARD) throw new OverrideError("not_found");
  if (!row.authorizedByUserId) throw new OverrideError("not_authorized_by_owner");
  if (row.consumedAt !== null || row.confirmedAt !== null) throw new OverrideError("already_used");
  if (row.expiresAt <= now) throw new OverrideError("expired");
  const updated = await tx.guardOverride.updateMany({
    where: { id: row.id, confirmedAt: null, consumedAt: null },
    data: { confirmedAt: now, operatorEmail: input.operatorEmail },
  });
  if (updated.count !== 1) throw new OverrideError("already_used");
  return { organizationId: row.organizationId, integrationId: row.integrationId, previewHash: row.previewHash };
}
