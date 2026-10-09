import type { SourceRole } from "@sla/core";
import {
  getOrganizationUsage,
  getWorkerSettingsForRead,
  catalogEntry,
  isPlanId,
  isTrialExpired,
  listIntegrationAvailabilityPolicies,
  PLANS,
  policyUsesAllowlist,
  Prisma,
  type PrismaClient,
} from "@sla/db";
import { staleFields } from "./freshness-data";
import { getLinkCoverage, NO_LINK_COVERAGE } from "./link-coverage-data";
import { providerRole } from "./providers";
import {
  PLAN_STATUSES,
  type AdminEntitlementEventRow,
  type AdminIntegrationDetailRow,
  type AdminIntegrationStatus,
  type AdminProviderPairCount,
  type AdminTenantDetail,
  type AdminTenantIntegrationRow,
  type AdminTenantRow,
  type AdminTenantsData,
  type PlanStatus,
  type TenantHealth,
} from "./types/admin";
import { INTEGRATION_PROVIDER_LABELS, type IntegrationProvider } from "./types/integrations";

/**
 * Platform-admin read models for the tenants list and the tenant detail (N4.4).
 * Like `admin-monitoring-data.ts`, these read across every organization, so
 * callers must have confirmed `isPlatformOperator` first (`requirePlatformAdminPage`),
 * and nothing outside `app/(admin)` and `modules/admin` may import this file
 * (`admin-boundary.test.ts`).
 *
 * Every figure comes from a batched `groupBy` or one `GROUP BY` query that
 * covers all requested organizations at once, so the number of queries does
 * not grow with the number of tenants (asserted in `admin-tenants-data.test.ts`).
 * No query selects `Integration.credentials` or `IntegrationConfig`.
 */

const DAY_MS = 24 * 3_600_000;

/** Display order of a provider pair: the ticket source first, then the tracker, then the code host. */
const ROLE_ORDER: Record<SourceRole, number> = { ticket_source: 0, work_tracker: 1, code_host: 2 };

/** Integrations an operator needs to act on, as one tenant-level word. Pure; unit-tested. */
export function deriveTenantHealth(
  integrations: Pick<
    AdminTenantIntegrationRow,
    "status" | "failingSince" | "lastSyncError" | "pollingPausedAt" | "stale"
  >[],
  notificationsFailed24h: number,
): TenantHealth {
  const active = integrations.filter((integration) => integration.status !== "disconnected");
  if (active.length === 0) return "none";

  const unhealthy = active.some(
    (integration) =>
      integration.status === "reauth_required" ||
      integration.status === "permission_denied" ||
      integration.failingSince !== null ||
      // A paused integration is stale on purpose; that is "attention", not an outage.
      (integration.stale && integration.pollingPausedAt === null),
  );
  if (unhealthy) return "unhealthy";

  const attention = active.some((integration) => integration.pollingPausedAt !== null) || notificationsFailed24h > 0;
  return attention ? "attention" : "healthy";
}

/** "Zendesk + Jira": the connected providers of one tenant, ticket source first. */
export function providerPairLabel(integrations: Pick<AdminTenantIntegrationRow, "provider" | "role" | "status">[]): string {
  const providers = integrations
    .filter((integration) => integration.status !== "disconnected")
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.provider.localeCompare(b.provider))
    .map((integration) => INTEGRATION_PROVIDER_LABELS[integration.provider]);
  return providers.length > 0 ? providers.join(" + ") : "No integrations";
}

async function countByOrganization(prisma: PrismaClient, query: Prisma.Sql): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ organizationId: string; n: bigint }[]>(query);
  return new Map(rows.map((row) => [row.organizationId, Number(row.n)]));
}

type WorkerSettingsRead = Awaited<ReturnType<typeof getWorkerSettingsForRead>>;

/**
 * One row per organization (or per id in `organizationIds`), oldest first.
 * `workerSettings` is a promise so the caller can share one read with its own
 * queries; it is awaited alongside this function's.
 */
async function buildTenantRows(
  prisma: PrismaClient,
  now: Date,
  workerSettingsRead: Promise<WorkerSettingsRead>,
  organizationIds?: string[],
): Promise<AdminTenantRow[]> {
  const asOf = now.toISOString();
  const since24h = new Date(now.getTime() - DAY_MS);
  const organizationFilter = organizationIds ? { organizationId: { in: organizationIds } } : {};
  const sqlFilter = organizationIds ? Prisma.sql`AND c."organizationId" = ANY(${organizationIds})` : Prisma.empty;

  const [
    organizations,
    users,
    pendingInvitations,
    integrations,
    openCases,
    evaluations24h,
    notificationsSent24h,
    notificationsFailed24h,
    linkCoverage,
    workerSettings,
  ] = await Promise.all([
    prisma.organization.findMany({
      where: organizationIds ? { id: { in: organizationIds } } : {},
      select: {
        id: true,
        name: true,
        createdAt: true,
        plan: true,
        planStatus: true,
        trialEndsAt: true,
        billingReference: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: organizationFilter,
      select: { organizationId: true, email: true, role: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.organizationInvitation.groupBy({
      by: ["organizationId"],
      where: { ...organizationFilter, status: "pending", expiresAt: { gt: now } },
      _count: { _all: true },
    }),
    prisma.integration.findMany({
      where: organizationFilter,
      // Deliberately no `credentials`: platform admins never see them.
      select: {
        id: true,
        organizationId: true,
        provider: true,
        status: true,
        lastSuccessfulSyncAt: true,
        failingSince: true,
        lastSyncError: true,
        pollingPausedAt: true,
      },
      orderBy: { connectedAt: "asc" },
    }),
    prisma.case.groupBy({
      by: ["organizationId"],
      where: { ...organizationFilter, closedAt: null, deletedAt: null },
      _count: { _all: true },
    }),
    // Evaluation, Notification and NotificationFailure have no organization
    // column: they reach it through commitment and case, which a Prisma
    // `groupBy` cannot group by, so one SQL `GROUP BY` each.
    countByOrganization(
      prisma,
      Prisma.sql`SELECT c."organizationId" AS "organizationId", COUNT(*) AS n
        FROM evaluations e
        JOIN commitments m ON m.id = e."commitmentId"
        JOIN cases c ON c.id = m."caseId"
        WHERE e."createdAt" >= ${since24h} ${sqlFilter}
        GROUP BY c."organizationId"`,
    ),
    countByOrganization(
      prisma,
      Prisma.sql`SELECT c."organizationId" AS "organizationId", COUNT(*) AS n
        FROM notifications x
        JOIN commitments m ON m.id = x."commitmentId"
        JOIN cases c ON c.id = m."caseId"
        WHERE x."sentAt" >= ${since24h} ${sqlFilter}
        GROUP BY c."organizationId"`,
    ),
    // `NotificationFailure` rows are deleted when a channel finally succeeds, so
    // this counts alerts that failed in the last 24 h and are still failing.
    countByOrganization(
      prisma,
      Prisma.sql`SELECT c."organizationId" AS "organizationId", COUNT(*) AS n
        FROM notification_failures f
        JOIN commitments m ON m.id = f."commitmentId"
        JOIN cases c ON c.id = m."caseId"
        WHERE f."lastFailedAt" >= ${since24h} ${sqlFilter}
        GROUP BY c."organizationId"`,
    ),
    getLinkCoverage(prisma, { organizationIds, now }),
    workerSettingsRead,
  ]);

  const membersByOrganization = new Map<string, { count: number; ownerEmail: string | null }>();
  for (const user of users) {
    const entry = membersByOrganization.get(user.organizationId) ?? { count: 0, ownerEmail: null };
    entry.count += 1;
    if (user.role === "owner" && entry.ownerEmail === null) entry.ownerEmail = user.email;
    membersByOrganization.set(user.organizationId, entry);
  }
  const invitationCounts = new Map(pendingInvitations.map((row) => [row.organizationId, row._count._all]));
  const openCaseCounts = new Map(openCases.map((row) => [row.organizationId, row._count._all]));

  const integrationsByOrganization = new Map<string, AdminTenantIntegrationRow[]>();
  for (const integration of integrations) {
    const provider = integration.provider as IntegrationProvider;
    const row: AdminTenantIntegrationRow = {
      id: integration.id,
      provider,
      role: providerRole(provider),
      status: integration.status as AdminIntegrationStatus,
      lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt?.toISOString() ?? null,
      failingSince: integration.failingSince?.toISOString() ?? null,
      lastSyncError: integration.lastSyncError,
      pollingPausedAt: integration.pollingPausedAt?.toISOString() ?? null,
      ...staleFields(integration, asOf, workerSettings),
    };
    const list = integrationsByOrganization.get(integration.organizationId) ?? [];
    list.push(row);
    integrationsByOrganization.set(integration.organizationId, list);
  }

  return organizations.map((organization) => {
    const tenantIntegrations = integrationsByOrganization.get(organization.id) ?? [];
    const failed = notificationsFailed24h.get(organization.id) ?? 0;
    return {
      organizationId: organization.id,
      name: organization.name,
      createdAt: organization.createdAt.toISOString(),
      ownerEmail: membersByOrganization.get(organization.id)?.ownerEmail ?? null,
      memberCount: membersByOrganization.get(organization.id)?.count ?? 0,
      pendingInvitations: invitationCounts.get(organization.id) ?? 0,
      plan: organization.plan,
      planStatus: organization.planStatus as PlanStatus,
      trialEndsAt: organization.trialEndsAt?.toISOString() ?? null,
      billingReference: organization.billingReference,
      integrations: tenantIntegrations,
      openCases: openCaseCounts.get(organization.id) ?? 0,
      evaluations24h: evaluations24h.get(organization.id) ?? 0,
      notificationsSent24h: notificationsSent24h.get(organization.id) ?? 0,
      notificationsFailed24h: failed,
      linkCoverage: linkCoverage.get(organization.id) ?? NO_LINK_COVERAGE,
      health: deriveTenantHealth(tenantIntegrations, failed),
    };
  });
}

/** The tenants list: who the customers are, which plan, and whether each is healthy. */
export async function getAdminTenantsData(prisma: PrismaClient, now = new Date()): Promise<AdminTenantsData> {
  const tenants = await buildTenantRows(prisma, now, getWorkerSettingsForRead(prisma));

  const pairCounts = new Map<string, number>();
  for (const tenant of tenants) {
    const pair = providerPairLabel(tenant.integrations);
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  }
  const providerPairCounts: AdminProviderPairCount[] = [...pairCounts]
    .map(([pair, count]) => ({ pair, tenants: count }))
    .sort((a, b) => b.tenants - a.tenants || a.pair.localeCompare(b.pair));

  const planStatusCounts = Object.fromEntries(PLAN_STATUSES.map((status) => [status, 0])) as Record<PlanStatus, number>;
  for (const tenant of tenants) planStatusCounts[tenant.planStatus] += 1;

  return {
    asOf: now.toISOString(),
    tenants,
    providerPairCounts,
    planStatusCounts,
    planNotRecorded: tenants.filter((tenant) => tenant.plan === null).length,
  };
}

const RECENT_ALERT_FAILURES_LIMIT = 10;
const RECENT_ENTITLEMENT_EVENTS_LIMIT = 20;

/**
 * One tenant in depth, or null if there is no such organization. Reuses the
 * list's row builder for the summary so the two pages cannot disagree.
 */
export async function getAdminTenantDetail(
  prisma: PrismaClient,
  organizationId: string,
  now = new Date(),
): Promise<AdminTenantDetail | null> {
  const asOf = now.toISOString();
  const workerSettingsRead = getWorkerSettingsForRead(prisma);

  const failureScope = { commitment: { case: { organizationId } } };
  const [rows, workerSettings, integrations, failingAlertCount, failures, slaImport, casesWithNoMatchingPolicy, workState, usage, entitlementEvents] =
    await Promise.all([
      buildTenantRows(prisma, now, workerSettingsRead, [organizationId]),
      workerSettingsRead,
      prisma.integration.findMany({
        where: { organizationId },
        select: {
          id: true,
          provider: true,
          status: true,
          connectedAt: true,
          lastSyncAt: true,
          lastSyncError: true,
          lastSuccessfulSyncAt: true,
          consecutiveFailures: true,
          failingSince: true,
          lastSyncDurationMs: true,
          pollingPausedAt: true,
          renormalizeRequestedAt: true,
          // Read only for the backfill-completion timestamp; the JSON itself never leaves this function.
          cursor: true,
        },
        orderBy: { connectedAt: "asc" },
      }),
      prisma.notificationFailure.count({ where: failureScope }),
      prisma.notificationFailure.findMany({
        where: failureScope,
        select: {
          commitmentId: true,
          threshold: true,
          error: true,
          attempts: true,
          firstFailedAt: true,
          lastFailedAt: true,
          commitment: { select: { kind: true, case: { select: { externalId: true } } } },
        },
        orderBy: { lastFailedAt: "desc" },
        take: RECENT_ALERT_FAILURES_LIMIT,
      }),
      prisma.slaImportSummary.findUnique({ where: { organizationId } }),
      // The dashboard's blind-spot query (Phase 6.2): open, not deleted, no commitment.
      prisma.case.count({ where: { organizationId, deletedAt: null, closedAt: null, commitments: { none: {} } } }),
      prisma.organizationWorkState.findUnique({
        where: { organizationId },
        select: {
          lastStartedAt: true,
          lastFinishedAt: true,
          consecutiveFailures: true,
          lastError: true,
          activeNextDueAt: true,
        },
      }),
      getOrganizationUsage(prisma, organizationId, providerRole, now),
      prisma.entitlementEvent.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: RECENT_ENTITLEMENT_EVENTS_LIMIT,
      }),
    ]);
  const tenant = rows[0];
  if (!tenant) return null;
  const [policies, listedRows] = await Promise.all([
    listIntegrationAvailabilityPolicies(prisma),
    prisma.integrationBetaAllowlist.findMany({ where: { organizationId }, select: { provider: true } }),
  ]);
  const listed = new Set(listedRows.map((row) => row.provider));
  const betaAccess = policies
    .filter((policy) => policyUsesAllowlist(policy) || listed.has(policy.provider))
    .map((policy) => {
      const entry = catalogEntry(policy.provider);
      return {
        provider: policy.provider,
        name: entry.name,
        listed: listed.has(policy.provider),
        allowlistApplies: policyUsesAllowlist(policy),
        rolloutBlock: entry.rolloutBlock ? { ...entry.rolloutBlock } : null,
      };
    });

  const lastRunDurationMs =
    workState?.lastStartedAt && workState.lastFinishedAt && workState.lastFinishedAt >= workState.lastStartedAt
      ? workState.lastFinishedAt.getTime() - workState.lastStartedAt.getTime()
      : null;

  return {
    asOf,
    tenant,
    integrations: integrations.map((integration): AdminIntegrationDetailRow => {
      const provider = integration.provider as IntegrationProvider;
      const cursor = integration.cursor as { backfillCompletedAt?: string } | null;
      return {
        id: integration.id,
        provider,
        role: providerRole(provider),
        status: integration.status as AdminIntegrationStatus,
        connectedAt: integration.connectedAt.toISOString(),
        lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
        lastSyncError: integration.lastSyncError,
        lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt?.toISOString() ?? null,
        consecutiveFailures: integration.consecutiveFailures,
        failingSince: integration.failingSince?.toISOString() ?? null,
        lastSyncDurationMs: integration.lastSyncDurationMs,
        pollingPausedAt: integration.pollingPausedAt?.toISOString() ?? null,
        renormalizeRequestedAt: integration.renormalizeRequestedAt?.toISOString() ?? null,
        backfillCompletedAt: cursor?.backfillCompletedAt ?? null,
        ...staleFields(integration, asOf, workerSettings),
      };
    }),
    failingAlertCount,
    recentAlertFailures: failures.map((failure) => ({
      commitmentId: failure.commitmentId,
      externalId: failure.commitment.case.externalId,
      kind: failure.commitment.kind,
      threshold: failure.threshold,
      error: failure.error,
      attempts: failure.attempts,
      firstFailedAt: failure.firstFailedAt.toISOString(),
      lastFailedAt: failure.lastFailedAt.toISOString(),
    })),
    slaImport: slaImport
      ? {
          provider: slaImport.provider as IntegrationProvider | null,
          unsupportedConditions: slaImport.unsupportedConditions,
          unsupportedMetrics: slaImport.unsupportedMetrics,
          policiesWithNoUsableTargets: slaImport.policiesWithNoUsableTargets,
          policiesWithUnresolvedSchedule: slaImport.policiesWithUnresolvedSchedule,
          policiesArchived: slaImport.policiesArchived,
          casesWithNoMatchingPolicy: slaImport.casesWithNoMatchingPolicy,
          updatedAt: slaImport.updatedAt.toISOString(),
        }
      : null,
    casesWithNoMatchingPolicy,
    betaAccess,
    entitlements: {
      enforced: workerSettings.entitlementsEnforced,
      usage,
      limits: isPlanId(tenant.plan) ? { ...PLANS[tenant.plan].limits } : null,
      trialExpired: isTrialExpired(
        { plan: tenant.plan, planStatus: tenant.planStatus, trialEndsAt: tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : null },
        now,
      ),
      events: entitlementEvents.map(
        (event): AdminEntitlementEventRow => ({
          id: event.id,
          kind: event.kind as AdminEntitlementEventRow["kind"],
          resource: event.resource as AdminEntitlementEventRow["resource"],
          used: event.used,
          limit: event.limit,
          notifiedAt: event.notifiedAt?.toISOString() ?? null,
          createdAt: event.createdAt.toISOString(),
        }),
      ),
    },
    work: workState
      ? {
          lastStartedAt: workState.lastStartedAt?.toISOString() ?? null,
          lastFinishedAt: workState.lastFinishedAt?.toISOString() ?? null,
          lastRunDurationMs,
          consecutiveFailures: workState.consecutiveFailures,
          lastError: workState.lastError,
          activeNextDueAt: workState.activeNextDueAt.toISOString(),
        }
      : null,
  };
}
