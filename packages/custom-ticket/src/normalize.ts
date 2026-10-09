import { createHash } from "node:crypto";
import type { PrismaClient } from "@sla/db";
import { NormalizationAbortedError, type CanonicalBatch, type NormalizeContext } from "@sla/ingestion";
import { privateHostsAllowed } from "@sla/safe-http";
import { CUSTOM_SOURCE_ROLE, deriveBatch, type RawRow } from "./derive";
import { firstFiringGuard, liveCaseCeiling, exceedsLifecycleChange, type GuardCounts } from "./guards";
import { CustomIngestError } from "./source-errors";
import { RAW_PREFIX } from "./shared";
import { parseConfig, type CustomConfig } from "./schema";
import { validateConfig } from "./validate";

export const LIFECYCLE_GUARD = "mass_lifecycle_change";
const MAX_REPORTED_IDS = 20;

/** The configuration version an integration currently runs, parsed and validated, or null when none is usable. */
export async function loadActiveConfig(prisma: PrismaClient, integrationId: string): Promise<{ version: number; config: CustomConfig } | null> {
  const row = await prisma.integration.findUnique({ where: { id: integrationId }, select: { activeConfigVersion: true } });
  if (!row || row.activeConfigVersion === null) return null;
  const version = await prisma.customProviderConfigVersion.findUnique({
    where: { integrationId_version: { integrationId, version: row.activeConfigVersion } },
    select: { config: true },
  });
  const parsed = version ? parseConfig(version.config) : null;
  if (!parsed || !parsed.ok) return null;
  if (!validateConfig(parsed.config, { allowPrivateHosts: privateHostsAllowed() }).ok) return null;
  return { version: row.activeConfigVersion, config: parsed.config };
}

/** What the lifecycle override is bound to: the guard and the exact set of flipping records. */
export function lifecyclePreviewHash(recordIds: readonly string[]): string {
  return createHash("sha256")
    .update([LIFECYCLE_GUARD, ...[...recordIds].sort()].join("\n"))
    .digest("hex");
}

export async function loadRawRows(prisma: PrismaClient, integrationId: string): Promise<RawRow[]> {
  return prisma.rawEvent.findMany({
    where: {
      integrationId,
      OR: [
        { providerEventId: { startsWith: RAW_PREFIX.ticket } },
        { providerEventId: { startsWith: RAW_PREFIX.comment } },
        { providerEventId: { startsWith: RAW_PREFIX.history } },
        { providerEventId: { startsWith: RAW_PREFIX.deleted } },
      ],
    },
    select: { id: true, providerEventId: true, payload: true, fetchedAt: true },
  });
}

/**
 * `normalize` for the `custom` provider (plan 09, 6.4). Derives the whole
 * stored set with the pure `deriveBatch`, then applies the abort guards
 * BEFORE returning a batch, so the projector never sees an aborted one and
 * nothing is partially applied: an abort throws `NormalizationAbortedError`
 * with counts and up to 20 record ids, and leaves cases, events and
 * evaluations as they were.
 *
 * V1 always processes the full stored set; the incremental design stays off
 * until the plan's benchmark evidence exists (6.9, 6.10).
 */
export async function normalizeCustom(ctx: NormalizeContext): Promise<CanonicalBatch> {
  const { prisma, integration } = ctx;
  const active = await loadActiveConfig(prisma, integration.id);
  if (!active) throw new CustomIngestError("config_invalid");

  const rows = await loadRawRows(prisma, integration.id);
  const derived = deriveBatch(active.config, rows);

  const live = await prisma.case.findMany({
    where: { organizationId: integration.organizationId, sourceIntegrationId: integration.id, deletedAt: null },
    select: { externalId: true, closedAt: true },
  });
  const liveById = new Map(live.map((c) => [c.externalId, c.closedAt !== null]));

  const attemptedIds = new Set<string>([...derived.caseExternalIds, ...derived.failures.map((f) => f.id), ...derived.deletedCaseExternalIds]);
  const newIds = [...attemptedIds].filter((id) => !liveById.has(id));
  const deletedLive = derived.deletedCaseExternalIds.filter((id) => liveById.has(id));
  const flips: string[] = [];
  for (const [id, closed] of derived.closedByExternalId) {
    const stored = liveById.get(id);
    if (stored !== undefined && stored !== closed) flips.push(id);
  }
  const counts: GuardCounts = {
    L: live.length,
    B: derived.attempted,
    F: derived.failures.length,
    D: deletedLive.length,
    R: flips.length,
    N: newIds.length,
    C: liveCaseCeiling(),
  };

  // An override honors only a confirmed, unexpired, unconsumed record bound to this exact record set.
  let override: { id: string } | null = null;
  if (exceedsLifecycleChange(counts)) {
    const hash = lifecyclePreviewHash(flips);
    const row = await prisma.guardOverride.findFirst({
      where: {
        integrationId: integration.id,
        guard: LIFECYCLE_GUARD,
        previewHash: hash,
        confirmedAt: { not: null },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    override = row;
  }

  const code = firstFiringGuard(counts, { lifecycleOverridden: override !== null });
  if (code) {
    const ids =
      code === "mass_deletion" ? deletedLive : code === "mass_record_failure" ? derived.failures.map((f) => f.id) : code === "live_case_ceiling" ? newIds : flips;
    throw new NormalizationAbortedError(code, {
      ...counts,
      ratio: code === "mass_lifecycle_change" ? counts.R / Math.max(1, counts.L) : code === "mass_record_failure" ? counts.F / Math.max(1, counts.B) : undefined,
      recordIds: [...ids].sort().slice(0, MAX_REPORTED_IDS),
      ...(code === "mass_lifecycle_change" ? { previewHash: lifecyclePreviewHash(flips) } : {}),
    });
  }

  return {
    customers: derived.customers,
    cases: derived.cases,
    eventGroups: derived.eventGroups,
    deletedCaseExternalIds: derived.deletedCaseExternalIds,
    failures: derived.failures.map((f) => ({ id: f.id, error: f.code, ...(f.details.length > 0 ? { details: f.details } : {}) })),
    ...(override
      ? {
          afterProject: async () => {
            await prisma.guardOverride.updateMany({
              where: { id: override.id, consumedAt: null },
              data: { consumedAt: new Date(), outcome: "applied" },
            });
          },
        }
      : {}),
  };
}

export { CUSTOM_SOURCE_ROLE };
