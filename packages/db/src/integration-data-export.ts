import type { IntegrationProvider, PrismaClient } from "../generated/prisma/client";
import { finishIntegrationDataOperation, startIntegrationDataOperation, type DataOperationActor } from "./integration-data-operations";
import {
  countIntegrationData,
  integrationDataWhere,
  type IntegrationDataCounts,
} from "./integration-data-scope";

/**
 * Export of one integration's stored data as a neutral stream of records — the
 * single source every complete-data format (JSON Lines, JSON, CSV) serializes,
 * so no format has its own idea of what an integration's data is. It reads
 * exactly the records `integrationDataWhere` defines, the same set a cleanup
 * deletes, and modifies nothing. Never triggered by (nor does it trigger) a
 * cleanup.
 *
 * There was no existing mechanism to reuse: `scripts/backup.sh` is a host-level
 * `pg_dump` of the whole database run by an operator, and the Concierge export
 * pulls live from the provider with its credentials, so it neither reads stored
 * data nor works for a disconnected integration.
 *
 * Streamed in keyset pages (`id` order) rather than built in memory: raw event
 * payloads make this the largest data in the system (a 5,000-case perf seed
 * holds 210k of them). The export is a series of reads, not a point-in-time
 * snapshot, so a connected integration may change during it; the manifest
 * records when it started. Never included: `Integration.credentials` and
 * `webhookSecret`. Serializing to a file format is the caller's job; this
 * module only records the operation (`format` is audit text it does not interpret).
 */

export const EXPORT_FORMAT_VERSION = 1;

const PAGE_SIZE = 500;

/** In export order: the integration, then what it owns, then raw events last. */
export const EXPORT_RECORD_TYPES = [
  "integration",
  "customer",
  "customer_identity",
  "case",
  "case_link",
  "normalized_event",
  "commitment",
  "evaluation",
  "notification",
  "notification_failure",
  "commitment_policy_change",
  "leg_span",
  "raw_event",
] as const;

export type ExportRecordType = (typeof EXPORT_RECORD_TYPES)[number];

export type ExportWritten = Partial<Record<ExportRecordType, number>>;

export interface ExportRecord {
  type: ExportRecordType;
  data: Record<string, unknown>;
}

export interface ExportManifest {
  formatVersion: number;
  generatedAt: string;
  organizationId: string;
  provider: IntegrationProvider;
  integrationId: string;
  /** Record counts per type: the scope the user was shown. */
  scope: IntegrationDataCounts;
  consistency: string;
  excluded: string[];
}

export type StartExportResult =
  | { status: "not_found" }
  | {
      status: "ready";
      /** `YYYYMMDDTHHMMSSZ` of the start, for file names. */
      stamp: string;
      manifest: ExportManifest;
      /** The records, grouped by type in `EXPORT_RECORD_TYPES` order. Finishing, failing or abandoning the iteration finishes the audit record. */
      records: AsyncGenerator<ExportRecord, void, void>;
    };

const afterId = (after: string | null) => (after ? { id: { gt: after } } : {});

export async function startIntegrationExport(
  prisma: PrismaClient,
  organizationId: string,
  provider: IntegrationProvider,
  actor: DataOperationActor,
  format: string,
): Promise<StartExportResult> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: {
      id: true,
      provider: true,
      status: true,
      connectedAt: true,
      disconnectedAt: true,
      cursor: true,
      lastSyncAt: true,
      lastSuccessfulSyncAt: true,
      lastSyncError: true,
      normalizedThroughFetchedAt: true,
      normalizedThroughId: true,
    },
  });
  if (!integration) return { status: "not_found" };

  const startedAt = new Date();
  const counts = await countIntegrationData(prisma, organizationId, integration);
  const operationId = await startIntegrationDataOperation(prisma, {
    organizationId,
    integrationId: integration.id,
    provider,
    kind: "backup",
    actor,
    details: { format, scope: counts },
  });

  const where = integrationDataWhere(organizationId, integration);
  const PAGE = { orderBy: { id: "asc" as const }, take: PAGE_SIZE };

  /** Every table after the integration row, in export order, each as a keyset-paged reader. */
  const tables: { type: Exclude<ExportRecordType, "integration">; page: (after: string | null) => Promise<{ id: string }[]> }[] = [
    { type: "customer", page: (after) => prisma.customer.findMany({ where: { AND: [where.customers, afterId(after)] }, ...PAGE }) },
    { type: "customer_identity", page: (after) => prisma.customerIdentity.findMany({ where: { AND: [where.customerIdentities, afterId(after)] }, ...PAGE }) },
    { type: "case", page: (after) => prisma.case.findMany({ where: { AND: [where.ownedCases, afterId(after)] }, ...PAGE }) },
    { type: "case_link", page: (after) => prisma.caseLink.findMany({ where: { AND: [where.caseLinks, afterId(after)] }, ...PAGE }) },
    { type: "normalized_event", page: (after) => prisma.normalizedEvent.findMany({ where: { AND: [where.normalizedEvents, afterId(after)] }, ...PAGE }) },
    { type: "commitment", page: (after) => prisma.commitment.findMany({ where: { AND: [where.commitments, afterId(after)] }, ...PAGE }) },
    { type: "evaluation", page: (after) => prisma.evaluation.findMany({ where: { AND: [where.evaluations, afterId(after)] }, ...PAGE }) },
    { type: "notification", page: (after) => prisma.notification.findMany({ where: { AND: [where.notifications, afterId(after)] }, ...PAGE }) },
    { type: "notification_failure", page: (after) => prisma.notificationFailure.findMany({ where: { AND: [where.notificationFailures, afterId(after)] }, ...PAGE }) },
    { type: "commitment_policy_change", page: (after) => prisma.commitmentPolicyChange.findMany({ where: { AND: [where.policyChanges, afterId(after)] }, ...PAGE }) },
    { type: "leg_span", page: (after) => prisma.legSpan.findMany({ where: { AND: [where.legSpans, afterId(after)] }, ...PAGE }) },
    { type: "raw_event", page: (after) => prisma.rawEvent.findMany({ where: { AND: [where.rawEvents, afterId(after)] }, ...PAGE }) },
  ];

  async function* records(): AsyncGenerator<ExportRecord, void, void> {
    const written: ExportWritten = {};
    let completed = false;
    let failure: string | null = null;
    try {
      const { id, ...integrationFields } = integration!;
      yield { type: "integration", data: { id, ...integrationFields } };
      written.integration = 1;

      for (const table of tables) {
        let after: string | null = null;
        for (;;) {
          const rows = await table.page(after);
          for (const row of rows) {
            yield { type: table.type, data: row };
            written[table.type] = (written[table.type] ?? 0) + 1;
          }
          if (rows.length < PAGE_SIZE) break;
          after = rows[rows.length - 1]!.id;
        }
      }
      completed = true;
    } catch (error) {
      failure = error instanceof Error ? error.name : "Error";
      throw error;
    } finally {
      // Neither completed nor failed: the consumer stopped reading (a cancelled download).
      const details = { format, scope: counts, written };
      await finishIntegrationDataOperation(
        prisma,
        operationId,
        completed
          ? { status: "completed", details }
          : { status: "failed", error: failure ?? "Download interrupted", details },
      );
    }
  }

  const manifest: ExportManifest = {
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: startedAt.toISOString(),
    organizationId,
    provider,
    integrationId: integration.id,
    scope: counts,
    consistency: "Read in pages, not a point-in-time snapshot; records may change while an integration is connected.",
    excluded: ["Integration.credentials", "Integration.webhookSecret"],
  };
  const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return {
    status: "ready",
    stamp,
    manifest,
    records: closeFinishesAudit(records(), () =>
      finishIntegrationDataOperation(prisma, operationId, {
        status: "failed",
        error: "Download interrupted",
        details: { format, scope: counts, written: {} },
      }),
    ),
  };
}

/**
 * Closing an async generator that was never started skips its `finally`, so a
 * download cancelled before the first record (a CSV archive writes its manifest
 * and README first) would leave the operation `started` for ever. This wrapper
 * finishes it on `return()` when the generator never ran; once it has run, its
 * own `finally` records the outcome. `finishIntegrationDataOperation` finishes a
 * row only once, so doing both is harmless.
 */
function closeFinishesAudit(
  inner: AsyncGenerator<ExportRecord, void, void>,
  onUnstartedClose: () => Promise<void>,
): AsyncGenerator<ExportRecord, void, void> {
  let started = false;
  return {
    next: (...args) => {
      started = true;
      return inner.next(...args);
    },
    return: async (value) => {
      if (!started) await onUnstartedClose();
      return inner.return(value);
    },
    throw: (error) => inner.throw(error),
    [Symbol.asyncIterator]() {
      return this;
    },
    [Symbol.asyncDispose]: () => inner[Symbol.asyncDispose](),
  };
}

/** The JSON Lines serialization: a `manifest` line, then one `{ type, data }` line per record. Each line ends in `\n`. */
export async function* ndjsonLines(exported: {
  manifest: ExportManifest;
  records: AsyncIterable<ExportRecord>;
}): AsyncGenerator<string, void, void> {
  yield `${JSON.stringify({ type: "manifest", data: exported.manifest })}\n`;
  for await (const record of exported.records) yield `${JSON.stringify(record)}\n`;
}
