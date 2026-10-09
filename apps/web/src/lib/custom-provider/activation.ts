import { createHash } from "node:crypto";
import {
  StaleCancellationPreviewError,
  assessActivationImpact,
  cancelUnsupportedKindCommitments,
  type ActivationImpact,
} from "@sla/commitments";
import {
  DraftNotReadyError,
  loadReadyDraft,
  measureFullPass,
  parseConfig,
  secretFieldNames,
  storedSlaSupport,
  validateConfig,
  type ConfigIssue,
  type CustomConfig,
  type Diagnostic,
  type FullPassMeasurement,
} from "@sla/custom-ticket";
import { Prisma, decryptCustomSecrets, encryptCustomSecrets, isUniqueConstraintError, type PrismaClient } from "@sla/db";
import { privateHostsAllowed } from "@sla/safe-http";

export type ActivationResult =
  | { status: "activated"; version: number; integrationId: string; cancelled: number }
  | { status: "invalid"; issues: ConfigIssue[]; diagnostics: Diagnostic[] }
  | { status: "not_ready"; code: DraftNotReadyError["code"] | "credentials_unreadable"; missing: string[] }
  | { status: "listing_too_large"; measurement: FullPassMeasurement }
  | { status: "needs_confirmation"; impact: ActivationImpact }
  | { status: "blocked"; reason: "next_reply_restore_blocked" | "auth_changed_reenter_credentials" | "version_not_found" | "not_connected" }
  | { status: "conflict" };

const configHash = (config: unknown): string => createHash("sha256").update(JSON.stringify(config)).digest("hex");

class ActivationConflict extends Error {}

function impactNeedsConfirmation(impact: ActivationImpact): boolean {
  return impact.newlyUnsupportedKinds.length > 0 && (impact.cancellation?.total ?? 0) > 0;
}

/**
 * Activates the organization's draft as a new immutable configuration version
 * (plan 09, 6.8). Validates the schema and the semantic rules, requires the
 * secrets, runs the R6 full-listing check for a source with no incremental
 * cursor, and assesses what the version does to existing commitments (5.5,
 * 5.6): activation never cancels anything until the owner has seen the
 * preview and confirmed it by its hash, and a version that would re-support
 * `next_reply` over cancelled commitments is refused. The write is one
 * transaction: version, activation pointer (compare-and-set), `slaSupport`,
 * credentials, the confirmed cancellations and the audit row commit together.
 */
export async function activateDraft(
  prisma: PrismaClient,
  input: { organizationId: string; userId: string; note?: string; confirmPreviewHash?: string; now?: Date },
): Promise<ActivationResult> {
  const now = input.now ?? new Date();
  let draft: { config: CustomConfig; secrets: Record<string, string> };
  try {
    draft = await loadReadyDraft(prisma, input.organizationId, now);
  } catch (error) {
    if (error instanceof DraftNotReadyError) {
      if (error.code === "config_invalid") {
        const row = await prisma.customProviderDraft.findUnique({ where: { organizationId: input.organizationId }, select: { config: true } });
        const parsed = parseConfig(row?.config);
        return { status: "invalid", issues: parsed.ok ? [] : parsed.issues, diagnostics: [] };
      }
      return { status: "not_ready", code: error.code, missing: error.missing };
    }
    throw error;
  }
  const report = validateConfig(draft.config, { allowPrivateHosts: privateHostsAllowed() });
  if (!report.ok) return { status: "invalid", issues: [], diagnostics: report.diagnostics };

  // R6: a source with no incremental cursor activates only if one full pass fits in one run.
  if (!draft.config.tickets.incremental) {
    const measurement = await measureFullPass(draft.config, draft.secrets);
    if (!measurement.completed) return { status: "listing_too_large", measurement };
  }

  const existing = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId: input.organizationId, provider: "custom" } },
    select: { id: true, activeConfigVersion: true, slaSupport: true },
  });
  const targetSupport = storedSlaSupport(report);
  const assess = (integrationId: string | null, current: unknown) =>
    assessActivationImpact(prisma, { organizationId: input.organizationId, integrationId, current, target: targetSupport });
  const impact = await assess(existing?.id ?? null, existing?.slaSupport ?? null);
  if (impact.blocked) return { status: "blocked", reason: impact.blocked };
  if (impactNeedsConfirmation(impact) && impact.cancellation?.previewHash !== input.confirmPreviewHash) {
    return { status: "needs_confirmation", impact };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const integration =
        existing ??
        (await tx.integration.create({
          data: { organizationId: input.organizationId, provider: "custom", status: "connected" },
          select: { id: true, activeConfigVersion: true, slaSupport: true },
        }));
      const latest = await tx.customProviderConfigVersion.findFirst({
        where: { integrationId: integration.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      await tx.customProviderConfigVersion.create({
        data: {
          organizationId: input.organizationId,
          integrationId: integration.id,
          version,
          schemaVersion: draft.config.schemaVersion,
          config: draft.config as unknown as Prisma.InputJsonValue,
          configHash: configHash(draft.config),
          createdByUserId: input.userId,
          validatedAt: now,
          note: input.note?.slice(0, 500) ?? null,
        },
      });

      let cancelled = 0;
      let cancelledByKind: Record<string, number> = {};
      if (impact.cancellation && impactNeedsConfirmation(impact)) {
        const result = await cancelUnsupportedKindCommitments(tx, {
          organizationId: input.organizationId,
          integrationId: integration.id,
          kinds: impact.newlyUnsupportedKinds,
          expectedHash: input.confirmPreviewHash!,
          now,
        });
        cancelled = result.cancelled;
        cancelledByKind = result.byKind;
      }

      // Compare-and-set on the version this activation started from.
      const swapped = await tx.integration.updateMany({
        where: { id: integration.id, activeConfigVersion: integration.activeConfigVersion ?? null },
        data: {
          activeConfigVersion: version,
          slaSupport: targetSupport ? (targetSupport as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          credentials: {
            secrets: encryptCustomSecrets(draft.secrets, { organizationId: input.organizationId, integrationId: integration.id }),
            ticketUrlTemplate: draft.config.ticketUrlTemplate ?? null,
            reauthRequired: false,
          } as unknown as Prisma.InputJsonValue,
          status: "connected",
          disconnectedAt: null,
          lastSyncError: null,
        },
      });
      if (swapped.count !== 1) throw new ActivationConflict();

      await tx.customActivationAudit.create({
        data: {
          organizationId: input.organizationId,
          integrationId: integration.id,
          action: "activate",
          fromVersion: integration.activeConfigVersion ?? null,
          toVersion: version,
          userId: input.userId,
          details: {
            cancelledByKind,
            keptFinalized: impact.cancellation?.keptFinalized ?? 0,
            remainsCancelled: impact.remainsCancelled,
            previewHash: impact.cancellation?.previewHash ?? null,
          },
        },
      });
      await tx.customProviderDraft.deleteMany({ where: { organizationId: input.organizationId } });
      return { status: "activated" as const, version, integrationId: integration.id, cancelled };
    });
  } catch (error) {
    if (error instanceof ActivationConflict || isUniqueConstraintError(error)) return { status: "conflict" };
    if (error instanceof StaleCancellationPreviewError) return { status: "needs_confirmation", impact: await assess(existing?.id ?? null, existing?.slaSupport ?? null) };
    throw error;
  }
}

/**
 * Re-activates an earlier immutable version (plan 09, 6.8). Mapping and
 * `slaSupport` return to that version for FUTURE processing only: commitments a
 * later version cancelled are never reactivated (5.6), the preview says how
 * many stay cancelled, and re-supporting `next_reply` over cancelled
 * commitments is refused. The credentials are kept, so the version must use
 * the same authentication fields.
 */
export async function rollbackToVersion(
  prisma: PrismaClient,
  input: { organizationId: string; userId: string; toVersion: number; confirmPreviewHash?: string; now?: Date },
): Promise<ActivationResult> {
  const now = input.now ?? new Date();
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId: input.organizationId, provider: "custom" } },
    select: { id: true, activeConfigVersion: true, slaSupport: true, status: true, credentials: true },
  });
  if (!integration || integration.status === "disconnected") return { status: "blocked", reason: "not_connected" };
  const row = await prisma.customProviderConfigVersion.findUnique({
    where: { integrationId_version: { integrationId: integration.id, version: input.toVersion } },
    select: { config: true },
  });
  if (!row) return { status: "blocked", reason: "version_not_found" };
  const parsed = parseConfig(row.config);
  if (!parsed.ok) return { status: "invalid", issues: parsed.issues, diagnostics: [] };
  const report = validateConfig(parsed.config, { allowPrivateHosts: privateHostsAllowed() });
  if (!report.ok) return { status: "invalid", issues: [], diagnostics: report.diagnostics };

  const secrets = (integration.credentials as { secrets?: Record<string, unknown> } | null)?.secrets;
  const storedFields = Object.keys(secrets ?? {}).sort();
  if (JSON.stringify(storedFields) !== JSON.stringify([...secretFieldNames(parsed.config.auth)].sort())) {
    return { status: "blocked", reason: "auth_changed_reenter_credentials" };
  }
  try {
    decryptCustomSecrets(secrets, { organizationId: input.organizationId, integrationId: integration.id }, storedFields);
  } catch {
    return { status: "not_ready", code: "credentials_unreadable", missing: [] };
  }

  const targetSupport = storedSlaSupport(report);
  const assess = () =>
    assessActivationImpact(prisma, { organizationId: input.organizationId, integrationId: integration.id, current: integration.slaSupport, target: targetSupport });
  const impact = await assess();
  if (impact.blocked) return { status: "blocked", reason: impact.blocked };
  if (impactNeedsConfirmation(impact) && impact.cancellation?.previewHash !== input.confirmPreviewHash) return { status: "needs_confirmation", impact };

  try {
    return await prisma.$transaction(async (tx) => {
      let cancelled = 0;
      let cancelledByKind: Record<string, number> = {};
      if (impact.cancellation && impactNeedsConfirmation(impact)) {
        const result = await cancelUnsupportedKindCommitments(tx, {
          organizationId: input.organizationId,
          integrationId: integration.id,
          kinds: impact.newlyUnsupportedKinds,
          expectedHash: input.confirmPreviewHash!,
          now,
        });
        cancelled = result.cancelled;
        cancelledByKind = result.byKind;
      }
      const swapped = await tx.integration.updateMany({
        where: { id: integration.id, activeConfigVersion: integration.activeConfigVersion ?? null },
        data: { activeConfigVersion: input.toVersion, slaSupport: targetSupport ? (targetSupport as unknown as Prisma.InputJsonValue) : Prisma.DbNull, lastSyncError: null },
      });
      if (swapped.count !== 1) throw new ActivationConflict();
      await tx.customActivationAudit.create({
        data: {
          organizationId: input.organizationId,
          integrationId: integration.id,
          action: "rollback",
          fromVersion: integration.activeConfigVersion ?? null,
          toVersion: input.toVersion,
          userId: input.userId,
          details: {
            cancelledByKind,
            keptFinalized: impact.cancellation?.keptFinalized ?? 0,
            remainsCancelled: impact.remainsCancelled,
            previewHash: impact.cancellation?.previewHash ?? null,
          },
        },
      });
      return { status: "activated" as const, version: input.toVersion, integrationId: integration.id, cancelled };
    });
  } catch (error) {
    if (error instanceof ActivationConflict) return { status: "conflict" };
    if (error instanceof StaleCancellationPreviewError) return { status: "needs_confirmation", impact: await assess() };
    throw error;
  }
}

/**
 * Soft disconnect, like every provider's: credentials cleared, status
 * `disconnected`, rows and versions kept (RawEvent cascades on delete, so the
 * row is never removed). The worker excludes disconnected integrations.
 */
export async function disconnectCustom(prisma: PrismaClient, organizationId: string): Promise<boolean> {
  const integration = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider: "custom" } }, select: { id: true } });
  if (!integration) return false;
  await prisma.integration.update({
    where: { id: integration.id },
    data: { credentials: Prisma.JsonNull, status: "disconnected", disconnectedAt: new Date(), lastSyncError: null },
  });
  return true;
}
