import { perfCount, type PrismaClient } from "@sla/db";
import {
  deriveLegSpans,
  evaluateCommitment,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type NormalizedEvent,
  type NormalizedState,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import { toCommitmentDomain, toNormalizedEventDomain } from "@sla/commitments";
import type { FindingsAccountRow, FindingsData } from "./types/findings";
import { ISSUE_LINK_PROVIDERS } from "./providers";

// Matches the historical backfill window (Phase 10/11) — the findings
// screen only ever talks about "the last 90 days" because that's exactly
// what got imported.
const FINDINGS_PERIOD_DAYS = 90;
const TOP_ACCOUNTS_LIMIT = 5;

/**
 * Computes the zero-input findings screen (roadmap step 11 / Phase 11):
 * "Over the last 90 days, N tickets were escalated to engineering. M
 * exceeded their resolution target...". Every number here comes from data
 * the user never typed — Zendesk's own SLA policies, Zendesk organizations,
 * and the Jira/Linear change history — computed live with the same pure
 * engine functions the dashboard and case detail page use, rather than
 * persisted `Commitment` status, so it's accurate immediately after backfill
 * and doesn't wait on the worker's next evaluation cycle. "Escalated" means
 * linked to any engineering tracker (Jira, Linear, or GitHub) — a case
 * doesn't stop counting just because a customer uses one tracker over
 * another.
 */
export async function getFindingsData(
  prisma: PrismaClient,
  organizationId: string,
  asOfDate: Date = new Date(),
): Promise<FindingsData> {
  const asOf = asOfDate.toISOString();
  const periodStart = new Date(
    asOfDate.getTime() - FINDINGS_PERIOD_DAYS * 86_400_000,
  );

  const escalatedCases = await prisma.case.findMany({
    where: {
      organizationId,
      deletedAt: null,
      openedAt: { gte: periodStart },
      caseLinks: { some: { system: { in: ISSUE_LINK_PROVIDERS } } },
    },
    include: { customer: true, commitments: true },
  });

  if (escalatedCases.length === 0) {
    return {
      periodDays: FINDINGS_PERIOD_DAYS,
      totalEscalated: 0,
      exceededTarget: 0,
      avgEngineeringMinutes: null,
      topAccounts: [],
    };
  }

  const caseIds = escalatedCases.map((c) => c.id);
  const policyVersionIds = [
    ...new Set(
      escalatedCases.flatMap((c) =>
        c.commitments.map((m) => m.policyVersionId),
      ),
    ),
  ];
  const calendarVersionIds = [
    ...new Set(
      escalatedCases.flatMap((c) =>
        c.commitments.map((m) => m.calendarVersionId),
      ),
    ),
  ];

  const [eventRows, policyVersionRows, calendarVersionRows] = await Promise.all(
    [
      prisma.normalizedEvent.findMany({ where: { caseId: { in: caseIds } } }),
      policyVersionIds.length > 0
        ? prisma.sLAPolicyVersion.findMany({
            where: { id: { in: policyVersionIds } },
          })
        : Promise.resolve([]),
      calendarVersionIds.length > 0
        ? prisma.businessCalendarVersion.findMany({
            where: { id: { in: calendarVersionIds } },
          })
        : Promise.resolve([]),
    ],
  );

  const policyVersionsById = new Map<string, SLAPolicyVersion>(
    policyVersionRows.map((row) => [
      row.id,
      {
        id: row.id,
        policyId: row.policyId,
        version: row.version,
        match: row.match as SLAPolicyMatch,
        targets: row.targets as { kind: CommitmentKind; minutes: number }[],
        pauseOnStates: row.pauseOnStates as NormalizedState[],
        calendarVersionId: row.calendarVersionId,
        warnAtPercent: row.warnAtPercent,
        effectiveFrom: row.effectiveFrom.toISOString(),
      },
    ]),
  );

  const calendarsById = new Map<string, BusinessCalendarVersion>(
    calendarVersionRows.map((row) => [
      row.id,
      {
        id: row.id,
        version: row.version,
        timezone: row.timezone,
        weekly: row.weekly as unknown as WeeklyWindow[],
        holidays: row.holidays,
        alwaysOpen: row.alwaysOpen,
      },
    ]),
  );

  const eventsByCaseId = new Map<string, NormalizedEvent[]>();
  for (const row of eventRows) {
    const domainEvent = toNormalizedEventDomain(row);
    const existing = eventsByCaseId.get(row.caseId);
    if (existing) existing.push(domainEvent);
    else eventsByCaseId.set(row.caseId, [domainEvent]);
  }

  let exceededTarget = 0;
  const engineeringMinutesByCaseId: number[] = [];
  const accountsByKey = new Map<string, FindingsAccountRow>();

  for (const caseRow of escalatedCases) {
    const accountKey = caseRow.customerId ?? caseRow.id;
    const accountName = caseRow.customer?.name ?? "Unknown account";
    const account = accountsByKey.get(accountKey) ?? {
      customerName: accountName,
      escalatedCases: 0,
      breachedCases: 0,
    };
    account.escalatedCases += 1;

    const events = eventsByCaseId.get(caseRow.id) ?? [];

    const resolution = caseRow.commitments.find((c) => c.kind === "resolution");
    if (resolution) {
      const policyVersion = policyVersionsById.get(resolution.policyVersionId);
      const calendar = calendarsById.get(resolution.calendarVersionId);
      if (policyVersion && calendar) {
        const evaluation = evaluateCommitment(
          toCommitmentDomain(resolution),
          events,
          policyVersion,
          calendar,
          asOf,
        );
        perfCount("evaluateCommitment");
        if (evaluation.status === "breached") {
          exceededTarget += 1;
          account.breachedCases += 1;
        }
      }
    }

    const { spans } = deriveLegSpans(events, {
      caseOpenedAt: caseRow.openedAt.toISOString(),
    });
    perfCount("deriveLegSpans");
    const endBound = caseRow.closedAt?.toISOString() ?? asOf;
    const engineeringMinutes = spans
      .filter((s) => s.leg === "engineering")
      .reduce(
        (sum, s) =>
          sum +
          (new Date(s.endedAt ?? endBound).getTime() -
            new Date(s.startedAt).getTime()) /
            60_000,
        0,
      );
    if (engineeringMinutes > 0)
      engineeringMinutesByCaseId.push(engineeringMinutes);

    accountsByKey.set(accountKey, account);
  }

  const avgEngineeringMinutes =
    engineeringMinutesByCaseId.length > 0
      ? Math.round(
          engineeringMinutesByCaseId.reduce((a, b) => a + b, 0) /
            engineeringMinutesByCaseId.length,
        )
      : null;

  const topAccounts = [...accountsByKey.values()]
    .sort(
      (a, b) =>
        b.breachedCases - a.breachedCases ||
        b.escalatedCases - a.escalatedCases,
    )
    .slice(0, TOP_ACCOUNTS_LIMIT);

  return {
    periodDays: FINDINGS_PERIOD_DAYS,
    totalEscalated: escalatedCases.length,
    exceededTarget,
    avgEngineeringMinutes,
    topAccounts,
  };
}
