import type { IntegrationProvider, PrismaClient } from "../generated/prisma/client";
import {
  finishIntegrationDataOperation,
  startIntegrationDataOperation,
  type DataOperationActor,
} from "./integration-data-operations";
import {
  countIntegrationData,
  integrationDataWhere,
  totalIntegrationDataRecords,
  type IntegrationDataCounts,
} from "./integration-data-scope";

/**
 * The summary behind the PDF report of one integration's stored data: counts,
 * the span the data covers, the SLA state of its commitments, its most recent
 * cases and its recent backup/cleanup activity. Aggregate queries only (counts,
 * min/max, group-by) plus a bounded list of recent cases — never the full data;
 * that is what the backup formats are for. Read-only, and recorded as a
 * `backup` operation with `format: "pdf"` like any other download, so it needs
 * no schema of its own.
 */

const RECENT_CASES = 25;
const RECENT_OPERATIONS = 10;

export interface IntegrationReportData {
  generatedAt: Date;
  generatedBy: string;
  organizationName: string;
  provider: IntegrationProvider;
  integrationId: string;
  status: "connected" | "disconnected" | "reauth_required" | "permission_denied";
  connectedAt: Date;
  disconnectedAt: Date | null;
  lastSyncAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastSyncError: string | null;
  counts: IntegrationDataCounts;
  total: number;
  span: {
    firstRawEventAt: Date | null;
    lastRawEventAt: Date | null;
    firstCaseOpenedAt: Date | null;
    lastCaseOpenedAt: Date | null;
  };
  cases: { total: number; open: number; closed: number; deleted: number };
  commitmentsByStatus: Record<string, number>;
  recentCases: {
    externalId: string;
    openedAt: Date;
    closedAt: Date | null;
    deleted: boolean;
    priority: string | null;
  }[];
  /** Earlier backups, reports and cleanups of this integration, newest first. */
  recentOperations: {
    kind: string;
    status: string;
    actorEmail: string;
    startedAt: Date;
    format: string | null;
  }[];
}

export type StartReportResult =
  | { status: "not_found" }
  | {
      status: "ready";
      data: IntegrationReportData;
      /** Call once the report has been built and sent. */
      complete(): Promise<void>;
      /** Call if building it failed. */
      fail(error: unknown): Promise<void>;
    };

export async function startIntegrationReport(
  prisma: PrismaClient,
  organizationId: string,
  provider: IntegrationProvider,
  actor: DataOperationActor,
): Promise<StartReportResult> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
    select: {
      id: true,
      provider: true,
      status: true,
      connectedAt: true,
      disconnectedAt: true,
      lastSyncAt: true,
      lastSuccessfulSyncAt: true,
      lastSyncError: true,
      organization: { select: { name: true } },
    },
  });
  if (!integration) return { status: "not_found" };

  const where = integrationDataWhere(organizationId, integration);
  const [counts, rawSpan, caseSpan, open, closed, deleted, byStatus, recentCases, operations] = await Promise.all([
    countIntegrationData(prisma, organizationId, integration),
    prisma.rawEvent.aggregate({ where: where.rawEvents, _min: { fetchedAt: true }, _max: { fetchedAt: true } }),
    prisma.case.aggregate({ where: where.ownedCases, _min: { openedAt: true }, _max: { openedAt: true } }),
    prisma.case.count({ where: { AND: [where.ownedCases, { closedAt: null, deletedAt: null }] } }),
    prisma.case.count({ where: { AND: [where.ownedCases, { closedAt: { not: null }, deletedAt: null }] } }),
    prisma.case.count({ where: { AND: [where.ownedCases, { deletedAt: { not: null } }] } }),
    prisma.commitment.groupBy({ by: ["status"], where: where.commitments, _count: { _all: true } }),
    prisma.case.findMany({
      where: where.ownedCases,
      orderBy: { openedAt: "desc" },
      take: RECENT_CASES,
      select: { externalId: true, openedAt: true, closedAt: true, deletedAt: true, priority: true },
    }),
    prisma.integrationDataOperation.findMany({
      where: { organizationId, integrationId: integration.id },
      orderBy: { startedAt: "desc" },
      take: RECENT_OPERATIONS,
      select: { kind: true, status: true, actorEmail: true, startedAt: true, details: true },
    }),
  ]);

  const operationId = await startIntegrationDataOperation(prisma, {
    organizationId,
    integrationId: integration.id,
    provider,
    kind: "backup",
    actor,
    details: { format: "pdf", scope: counts },
  });

  const data: IntegrationReportData = {
    generatedAt: new Date(),
    generatedBy: actor.email,
    organizationName: integration.organization.name,
    provider,
    integrationId: integration.id,
    status: integration.status,
    connectedAt: integration.connectedAt,
    disconnectedAt: integration.disconnectedAt,
    lastSyncAt: integration.lastSyncAt,
    lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt,
    lastSyncError: integration.lastSyncError,
    counts,
    total: totalIntegrationDataRecords(counts),
    span: {
      firstRawEventAt: rawSpan._min.fetchedAt,
      lastRawEventAt: rawSpan._max.fetchedAt,
      firstCaseOpenedAt: caseSpan._min.openedAt,
      lastCaseOpenedAt: caseSpan._max.openedAt,
    },
    cases: { total: open + closed + deleted, open, closed, deleted },
    commitmentsByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    recentCases: recentCases.map((row) => ({
      externalId: row.externalId,
      openedAt: row.openedAt,
      closedAt: row.closedAt,
      deleted: row.deletedAt !== null,
      priority: row.priority,
    })),
    recentOperations: operations.map((operation) => ({
      kind: operation.kind,
      status: operation.status,
      actorEmail: operation.actorEmail,
      startedAt: operation.startedAt,
      format: (operation.details as { format?: string } | null)?.format ?? null,
    })),
  };

  const details = { format: "pdf", scope: counts };
  return {
    status: "ready",
    data,
    complete: () => finishIntegrationDataOperation(prisma, operationId, { status: "completed", details }),
    fail: (error) =>
      finishIntegrationDataOperation(prisma, operationId, {
        status: "failed",
        error: error instanceof Error ? error.name : "Error",
        details,
      }),
  };
}
