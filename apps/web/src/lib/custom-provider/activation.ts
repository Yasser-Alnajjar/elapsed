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
import { computeConfigDiff, type ConfigDiff } from "./config-diff";

export type ActivationResult =
  | { status: "activated"; version: number; integrationId: string; cancelled: number }
  | { status: "invalid"; issues: ConfigIssue[]; diagnostics: Diagnostic[] }
  | { status: "not_ready"; code: DraftNotReadyError["code"] | "credentials_unreadable"; missing: string[] }
  | { status: "listing_too_large"; measurement: FullPassMeasurement }
  | { status: "needs_confirmation"; impact: ActivationImpact }
  | { status: "needs_diff_review"; diff: ConfigDiff }
  | { status: "blocked"; reason: "next_reply_restore_blocked" | "auth_changed_reenter_credentials" | "version_not_found" | "not_connected" | "reconnect_first" }
  | { status: "conflict" };

const configHash = (config: unknown): string => createHash("sha256").update(JSON.stringify(config)).digest("hex");

class ActivationConflict extends Error {}

/**
 * Plan 09, 6.8: a version that would change stored cases or events is
 * activated only after the owner has seen that exact dry-run diff (its hash).
 * Null when activation may proceed: a first activation, nothing stored yet, or
 * a version that changes nothing.
 */
async function diffNeedingReview(prisma: PrismaClient, organizationId: string, proposed: CustomConfig, confirmDiffHash: string | undefined): Promise<ConfigDiff | null> {
  const diff = await computeConfigDiff(prisma, organizationId, proposed);
  return diff.hash !== null && diff.hash !== confirmDiffHash ? diff : null;
}

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
  input: { organizationId: string; userId: string; note?: string; confirmPreviewHash?: string; confirmDiffHash?: string; now?: Date },
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

  const diff = await diffNeedingReview(prisma, input.organizationId, draft.config, input.confirmDiffHash);
  if (diff) return { status: "needs_diff_review", diff };

  const existing = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId: input.organizationId, provider: "custom" } },
    select: { id: true, status: true, activeConfigVersion: true, slaSupport: true },
  });
  // A disconnected source with a kept configuration comes back through `reconnectCustom` on its last activated version: a draft never replaces it.
  if (existing?.status === "disconnected" && existing.activeConfigVersion !== null) return { status: "blocked", reason: "reconnect_first" };
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
  input: { organizationId: string; userId: string; toVersion: number; confirmPreviewHash?: string; confirmDiffHash?: string; now?: Date },
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

  const diff = await diffNeedingReview(prisma, input.organizationId, parsed.config, input.confirmDiffHash);
  if (diff) return { status: "needs_diff_review", diff };

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

export type ReconnectResult =
  | { status: "reconnected"; version: number; integrationId: string }
  | { status: "not_disconnected" }
  | { status: "no_active_configuration" }
  | { status: "invalid_secrets"; missing: string[] }
  | { status: "conflict" };

const MAX_SECRET_BYTES = 4096;

/**
 * Reconnects a disconnected source on the configuration version that was
 * active when it was disconnected (`activeConfigVersion`, which Disconnect
 * never touches). Only the credentials are new. No draft is read and no
 * version is created, so a saved draft or a newer-looking version can never
 * replace the last activated configuration, and the version history is
 * untouched. The stored cases, events, commitments and `slaSupport` are not
 * re-assessed: the version is the same one they were derived under. The status
 * flip is what brings the data back (`integration-visibility.ts`), and the
 * cursor is kept, so the worker resumes where it stopped. Compare-and-set on
 * the version read, so a concurrent change is a `conflict`, never a wrong
 * version.
 */
export async function reconnectCustom(
  prisma: PrismaClient,
  input: { organizationId: string; userId: string; secrets: Record<string, unknown> },
): Promise<ReconnectResult> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId: input.organizationId, provider: "custom" } },
    select: { id: true, status: true, activeConfigVersion: true },
  });
  if (!integration || integration.status !== "disconnected") return { status: "not_disconnected" };
  if (integration.activeConfigVersion === null) return { status: "no_active_configuration" };
  const row = await prisma.customProviderConfigVersion.findUnique({
    where: { integrationId_version: { integrationId: integration.id, version: integration.activeConfigVersion } },
    select: { config: true },
  });
  const parsed = row ? parseConfig(row.config) : null;
  if (!parsed || !parsed.ok) return { status: "no_active_configuration" };

  const fields = secretFieldNames(parsed.config.auth);
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const field of fields) {
    const value = input.secrets[field];
    if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) missing.push(field);
    else values[field] = value;
  }
  if (missing.length > 0 || Object.keys(input.secrets).some((field) => !fields.includes(field))) return { status: "invalid_secrets", missing };

  const version = integration.activeConfigVersion;
  try {
    return await prisma.$transaction(async (tx) => {
      const swapped = await tx.integration.updateMany({
        where: { id: integration.id, status: "disconnected", activeConfigVersion: version },
        data: {
          credentials: {
            secrets: encryptCustomSecrets(values, { organizationId: input.organizationId, integrationId: integration.id }),
            ticketUrlTemplate: parsed.config.ticketUrlTemplate ?? null,
            reauthRequired: false,
          } as unknown as Prisma.InputJsonValue,
          status: "connected",
          disconnectedAt: null,
          lastSyncError: null,
          consecutiveFailures: 0,
          failingSince: null,
        },
      });
      if (swapped.count !== 1) throw new ActivationConflict();
      await tx.customActivationAudit.create({
        data: {
          organizationId: input.organizationId,
          integrationId: integration.id,
          action: "reconnect",
          fromVersion: version,
          toVersion: version,
          userId: input.userId,
          details: {},
        },
      });
      return { status: "reconnected" as const, version, integrationId: integration.id };
    });
  } catch (error) {
    if (error instanceof ActivationConflict) return { status: "conflict" };
    throw error;
  }
}

/**
 * Deletes a disconnected source's configuration and nothing else: the draft,
 * every configuration version, the activation pointer and `slaSupport`. The
 * `Integration` row is kept (RawEvent cascades on delete, and cases are
 * detached, not removed), and so are its cases, events, raw events,
 * commitments, evaluations, sync history, sync cursor and audit rows. They stay
 * hidden while the source is disconnected (`integration-visibility.ts`) and are
 * not reachable by any other integration or organization. Setting the source
 * up again starts a new configuration at version 1 on the same row. Only a
 * disconnected source can be deleted; a connected one is disconnected first.
 * Deleting an organization is a separate lifecycle.
 */
export async function deleteCustomConfiguration(prisma: PrismaClient, organizationId: string): Promise<"deleted" | "not_found" | "connected"> {
  const integration = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider: "custom" } }, select: { id: true } });
  if (!integration) {
    await prisma.customProviderDraft.deleteMany({ where: { organizationId } });
    return "not_found";
  }
  try {
    await prisma.$transaction(async (tx) => {
      // Compare-and-set on the status: a source reconnected a moment ago is refused, never half-deleted.
      const cleared = await tx.integration.updateMany({
        where: { id: integration.id, status: "disconnected" },
        data: { activeConfigVersion: null, slaSupport: Prisma.DbNull, credentials: Prisma.JsonNull },
      });
      if (cleared.count !== 1) throw new ActivationConflict();
      await tx.customProviderDraft.deleteMany({ where: { organizationId } });
      await tx.customProviderConfigVersion.deleteMany({ where: { integrationId: integration.id } });
    });
  } catch (error) {
    if (error instanceof ActivationConflict) return "connected";
    throw error;
  }
  return "deleted";
}
