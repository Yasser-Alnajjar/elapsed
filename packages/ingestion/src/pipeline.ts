import type { Logger } from "@sla/logger";
import type { PrismaClient } from "@sla/db";
import type {
  CalendarImportResult,
  CaseRefResolver,
  CorrelateContext,
  ImportContext,
  IntegrationRef,
  NormalizeContext,
  PolicyImportResult,
  ProviderAdapter,
} from "./contract";
import { projectLinkFacts, projectLinkSweep, type LinkProjectionResult } from "./link-projector";
import { projectCanonicalBatch, type ProjectionResult } from "./projector";

/** A provider's ticket-URL recognizers keyed by provider, in the shape `buildCaseRefResolver` (`@sla/commitments`) takes. */
export function ticketUrlRecognizers(
  registry: Readonly<Record<string, ProviderAdapter>>,
): Record<string, (url: string, credentials: unknown) => string | null> {
  const recognizers: Record<string, (url: string, credentials: unknown) => string | null> = {};
  for (const adapter of Object.values(registry)) {
    const recognize = adapter.recognizeCaseUrl;
    if (recognize) recognizers[adapter.provider] = (url, credentials) => recognize(url, credentials);
  }
  return recognizers;
}

export interface CorrelationProjection extends LinkProjectionResult {
  /** Links marked unlinked by the adapter's sweeps. */
  unlinked: number;
  evaluated: number;
  unmatched: Record<string, number>;
}

/** Derives the integration's canonical batch and persists it, then lets the adapter finish (advance a watermark). */
export async function normalizeAndProject(adapter: ProviderAdapter, ctx: NormalizeContext): Promise<ProjectionResult> {
  const batch = await adapter.normalize(ctx);
  const result = await projectCanonicalBatch(ctx.prisma, ctx.integration, batch);
  await batch.afterProject?.();
  return result;
}

/** Derives the integration's links and persists them, then runs the unlink sweeps the adapter asked for. Null when the adapter has no `correlate`. */
export async function correlateAndProject(adapter: ProviderAdapter, ctx: CorrelateContext): Promise<CorrelationProjection | null> {
  if (!adapter.correlate) return null;
  const output = await adapter.correlate(ctx);
  const links = await projectLinkFacts(ctx.prisma, output.links);
  let unlinked = 0;
  for (const sweep of output.sweeps) {
    unlinked += (await projectLinkSweep(ctx.prisma, ctx.integration.organizationId, sweep)).unlinked;
  }
  return { ...links, unlinked, evaluated: output.evaluated, unmatched: output.unmatched };
}

export interface IntegrationSyncInput {
  prisma: PrismaClient;
  integration: IntegrationRef;
  /** Carries the run's context (organization, cycle). */
  logger?: Logger;
  /** `incremental` for the active-set poll, `full` for the reconciliation sweep and connect-time projection. */
  mode: NormalizeContext["mode"];
  resolveCaseRef: CaseRefResolver | null;
  /** Needed only by a provider that imports policies or calendars (see `ImportContext`). */
  ensureDefaultCalendarVersion?(organizationId: string): Promise<{ id: string }>;
  /** Narrows the run to these source records (a webhook delivery). Skips imports, which are not per-record. */
  externalIds?: string[];
}

export interface IntegrationSyncResult {
  normalization: ProjectionResult;
  correlation: CorrelationProjection | null;
  calendarImport: CalendarImportResult | null;
  policyImport: PolicyImportResult | null;
}

/**
 * The DB-only half of one integration's cycle, in the order its role needs: a
 * ticket source creates the cases, so it is normalized before anything links
 * onto them (and its own correlation, which looks cases up, runs after); a
 * tracker or code host correlates first, because its events are aimed at the
 * cases those links name. Calendar then policy import follow for providers that
 * have them: policies read the calendars. Runs inside the caller's
 * organization lock.
 */
export async function syncIntegration(adapter: ProviderAdapter, input: IntegrationSyncInput): Promise<IntegrationSyncResult> {
  const { prisma, integration, externalIds } = input;
  const { logger } = input;
  const normalizeCtx: NormalizeContext = { prisma, integration, logger, mode: input.mode, externalIds };
  const correlateCtx: CorrelateContext = { prisma, integration, logger, resolveCaseRef: input.resolveCaseRef, externalIds };
  const importCtx: ImportContext = {
    prisma,
    integration,
    logger,
    ensureDefaultCalendarVersion: (organizationId) => {
      if (!input.ensureDefaultCalendarVersion) throw new Error(`${integration.provider} imports need ensureDefaultCalendarVersion`);
      return input.ensureDefaultCalendarVersion(organizationId);
    },
  };

  let normalization: ProjectionResult;
  let correlation: CorrelationProjection | null;
  if (adapter.role === "ticket_source") {
    normalization = await normalizeAndProject(adapter, normalizeCtx);
    correlation = await correlateAndProject(adapter, correlateCtx);
  } else {
    correlation = await correlateAndProject(adapter, correlateCtx);
    normalization = await normalizeAndProject(adapter, normalizeCtx);
  }

  const imports = !externalIds;
  const calendarImport = imports && adapter.capabilities.calendarImport && adapter.importCalendars ? await adapter.importCalendars(importCtx) : null;
  const policyImport = imports && adapter.capabilities.policyImport && adapter.importPolicies ? await adapter.importPolicies(importCtx) : null;
  return { normalization, correlation, calendarImport, policyImport };
}
