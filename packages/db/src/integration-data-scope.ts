import type { IntegrationProvider, Prisma, PrismaClient } from "../generated/prisma/client";

/**
 * What one integration's stored data is — the single definition that the Data
 * page's counts, the backup export and the cleanup all use, so what a user is
 * shown, what a backup contains and what a cleanup deletes cannot drift apart.
 *
 * Owned by an integration (see `cleanupIntegrationData` for the full rationale):
 *  - its `RawEvent` rows;
 *  - the `NormalizedEvent` rows derived from them (`sourceRawEventId`), on any
 *    case, plus every event on a case it owns (a case is the ticket source's
 *    entity; the schema cascades its events, commitments, evaluations and so on);
 *  - the `Case` rows it created. `system` is the provider that created the case
 *    and an integration is unique per organization and provider, so it names the
 *    same owner as `sourceIntegrationId` — and also covers a pre-N1.15 row with no
 *    source. Deliberately no `sourceIntegrationId: null` filter: N2.10 makes that
 *    column NOT NULL, where Prisma rejects a null filter outright;
 *  - the `CaseLink` rows on those cases, and links *to* this provider on other
 *    integrations' cases (which may keep other producers' evidence);
 *  - its `CustomerIdentity` rows.
 */
export interface IntegrationRef {
  id: string;
  provider: IntegrationProvider;
}

export function integrationDataWhere(organizationId: string, integration: IntegrationRef) {
  const ownedCases: Prisma.CaseWhereInput = {
    organizationId,
    OR: [{ sourceIntegrationId: integration.id }, { system: integration.provider }],
  };
  return {
    ownedCases,
    rawEvents: { integrationId: integration.id } satisfies Prisma.RawEventWhereInput,
    normalizedEvents: {
      OR: [{ sourceRawEvent: { integrationId: integration.id } }, { case: ownedCases }],
    } satisfies Prisma.NormalizedEventWhereInput,
    commitments: { case: ownedCases } satisfies Prisma.CommitmentWhereInput,
    evaluations: { commitment: { case: ownedCases } } satisfies Prisma.EvaluationWhereInput,
    notifications: { commitment: { case: ownedCases } } satisfies Prisma.NotificationWhereInput,
    notificationFailures: { commitment: { case: ownedCases } } satisfies Prisma.NotificationFailureWhereInput,
    policyChanges: { commitment: { case: ownedCases } } satisfies Prisma.CommitmentPolicyChangeWhereInput,
    legSpans: { case: ownedCases } satisfies Prisma.LegSpanWhereInput,
    caseLinks: {
      OR: [{ case: ownedCases }, { system: integration.provider, case: { organizationId } }],
    } satisfies Prisma.CaseLinkWhereInput,
    customerIdentities: { organizationId, provider: integration.provider } satisfies Prisma.CustomerIdentityWhereInput,
    /** Customers those identities name — what a backup includes; a cleanup deletes only the ones nothing else needs. */
    customers: {
      organizationId,
      identities: { some: { provider: integration.provider } },
    } satisfies Prisma.CustomerWhereInput,
  };
}

/** Record counts per type of one integration's stored data. */
// A type alias, not an interface: it is stored as JSON (the operation record's `details`), and only aliases satisfy Prisma's JSON input type.
export type IntegrationDataCounts = {
  rawEvents: number;
  cases: number;
  normalizedEvents: number;
  commitments: number;
  evaluations: number;
  caseLinks: number;
  customerIdentities: number;
  /** Notifications, failed notifications, commitment policy changes and leg spans. */
  other: number;
};

export function totalIntegrationDataRecords(counts: IntegrationDataCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/**
 * Counts with aggregate `count` queries only — no rows are loaded. The
 * relation-filtered counts ride the existing indexes (`raw_events` by
 * integration, `normalized_events` by `sourceRawEventId`/`caseId`, cases by
 * organization and source).
 */
export async function countIntegrationData(
  prisma: PrismaClient,
  organizationId: string,
  integration: IntegrationRef,
): Promise<IntegrationDataCounts> {
  const where = integrationDataWhere(organizationId, integration);
  const [rawEvents, cases, normalizedEvents, commitments, evaluations, caseLinks, customerIdentities, notifications, failures, policyChanges, legSpans] =
    await Promise.all([
      prisma.rawEvent.count({ where: where.rawEvents }),
      prisma.case.count({ where: where.ownedCases }),
      prisma.normalizedEvent.count({ where: where.normalizedEvents }),
      prisma.commitment.count({ where: where.commitments }),
      prisma.evaluation.count({ where: where.evaluations }),
      prisma.caseLink.count({ where: where.caseLinks }),
      prisma.customerIdentity.count({ where: where.customerIdentities }),
      prisma.notification.count({ where: where.notifications }),
      prisma.notificationFailure.count({ where: where.notificationFailures }),
      prisma.commitmentPolicyChange.count({ where: where.policyChanges }),
      prisma.legSpan.count({ where: where.legSpans }),
    ]);
  return {
    rawEvents,
    cases,
    normalizedEvents,
    commitments,
    evaluations,
    caseLinks,
    customerIdentities,
    other: notifications + failures + policyChanges + legSpans,
  };
}

export interface IntegrationDataSummary {
  integrationId: string;
  provider: IntegrationProvider;
  status: "connected" | "disconnected" | "reauth_required" | "permission_denied";
  connectedAt: Date;
  disconnectedAt: Date | null;
  lastSyncAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastSyncError: string | null;
  counts: IntegrationDataCounts;
  total: number;
}

/**
 * One row per integration of the organization — connected or not, since
 * disconnect keeps the row and its data — with what it holds. Callers decide
 * whether to hide the empty ones.
 */
export async function listIntegrationDataSummaries(
  prisma: PrismaClient,
  organizationId: string,
): Promise<IntegrationDataSummary[]> {
  const integrations = await prisma.integration.findMany({
    where: { organizationId },
    orderBy: { provider: "asc" },
    select: {
      id: true,
      provider: true,
      status: true,
      connectedAt: true,
      disconnectedAt: true,
      lastSyncAt: true,
      lastSuccessfulSyncAt: true,
      lastSyncError: true,
    },
  });
  return Promise.all(
    integrations.map(async ({ id, provider, status, ...rest }) => {
      const counts = await countIntegrationData(prisma, organizationId, { id, provider });
      return { integrationId: id, provider, status, ...rest, counts, total: totalIntegrationDataRecords(counts) };
    }),
  );
}
