import { perfCount, withPerfScope, type PrismaClient } from "@sla/db";
import {
  deriveLegSpans,
  evaluateCommitment,
  sumLegMinutes,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type Leg,
  type LegSpan,
  type NormalizedEvent,
  type NormalizedState,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import { toCommitmentDomain, toNormalizedEventDomain } from "@sla/commitments";

import type { AtRiskLinkedIssue, AtRiskRowData } from "@/lib/types/at-risk";

function minutesBetween(from: string, to: Date): number {
  return Math.round((to.getTime() - new Date(from).getTime()) / 60000);
}

const ISSUE_TRACKER_SYSTEMS = new Set(["jira", "linear", "github"]);

/** Picks one active link to show per case — `certain` over `probable` when a case somehow carries both. Mirrors `dashboard-data.ts`'s `preferredLink`, kept local so this route's data shape stays decoupled from the dashboard reconstruction. */
function preferredLink(
  links: { system: string; externalId: string; confidence: string }[],
): AtRiskLinkedIssue | null {
  const trackerLinks = links.filter((l) => ISSUE_TRACKER_SYSTEMS.has(l.system));
  if (trackerLinks.length === 0) return null;
  const best =
    trackerLinks.find((l) => l.confidence === "certain") ?? trackerLinks[0]!;
  return {
    system: best.system as AtRiskLinkedIssue["system"],
    externalId: best.externalId,
    confidence: best.confidence as AtRiskLinkedIssue["confidence"],
  };
}

export async function getAtRiskData(
  prisma: PrismaClient,
  organizationId: string,
  asOfDate: Date = new Date(),
): Promise<AtRiskRowData[]> {
  return withPerfScope(
    "at_risk",
    () => getAtRiskDataInner(prisma, organizationId, asOfDate),
    {
      organizationId,
    },
  );
}

async function getAtRiskDataInner(
  prisma: PrismaClient,
  organizationId: string,
  asOfDate: Date,
): Promise<AtRiskRowData[]> {
  const asOf = asOfDate.toISOString();

  const openCommitmentRows = await prisma.commitment.findMany({
    where: {
      case: {
        organizationId,
        deletedAt: null,
      },
      closedAt: null,
    },
    include: {
      case: {
        include: {
          customer: true,
        },
      },
    },
  });

  if (openCommitmentRows.length === 0) {
    return [];
  }

  const policyVersionIds = [
    ...new Set(
      openCommitmentRows.map((commitment) => commitment.policyVersionId),
    ),
  ];

  const calendarVersionIds = [
    ...new Set(
      openCommitmentRows.map((commitment) => commitment.calendarVersionId),
    ),
  ];

  const caseIds = [
    ...new Set(openCommitmentRows.map((commitment) => commitment.caseId)),
  ];

  const [policyVersionRows, calendarVersionRows, eventRows, caseLinkRows] =
    await Promise.all([
      prisma.sLAPolicyVersion.findMany({
        where: {
          id: {
            in: policyVersionIds,
          },
        },
      }),

      prisma.businessCalendarVersion.findMany({
        where: {
          id: {
            in: calendarVersionIds,
          },
        },
      }),

      prisma.normalizedEvent.findMany({
        where: {
          caseId: {
            in: caseIds,
          },
        },
      }),

      // Same "active relationship" filter as case-detail-data.ts's `links` —
      // powers the dual Zendesk⇄Jira id pairing and "Linked: Certain (n/n)"
      // pill, neither of which existed on this row before this reconstruction.
      prisma.caseLink.findMany({
        where: { caseId: { in: caseIds }, unlinkedAt: null },
      }),
    ]);

  const linksByCaseId = new Map<
    string,
    { system: string; externalId: string; confidence: string }[]
  >();

  for (const link of caseLinkRows) {
    const existing = linksByCaseId.get(link.caseId);

    if (existing) {
      existing.push(link);
    } else {
      linksByCaseId.set(link.caseId, [link]);
    }
  }

  const linkedIssueFor = (caseId: string): AtRiskLinkedIssue | null =>
    preferredLink(linksByCaseId.get(caseId) ?? []);

  const policyVersionsById = new Map<string, SLAPolicyVersion>(
    policyVersionRows.map((row) => [
      row.id,
      {
        id: row.id,
        policyId: row.policyId,
        version: row.version,
        match: row.match as SLAPolicyMatch,
        targets: row.targets as {
          kind: CommitmentKind;
          minutes: number;
        }[],
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
    const event = toNormalizedEventDomain(row);

    const existing = eventsByCaseId.get(row.caseId);

    if (existing) {
      existing.push(event);
    } else {
      eventsByCaseId.set(row.caseId, [event]);
    }
  }

  const legSpansByCaseId = new Map<string, LegSpan[]>();

  const getLegSpans = (caseId: string, caseOpenedAt: Date): LegSpan[] => {
    const cached = legSpansByCaseId.get(caseId);

    if (cached) {
      return cached;
    }

    const { spans } = deriveLegSpans(eventsByCaseId.get(caseId) ?? [], {
      caseOpenedAt: caseOpenedAt.toISOString(),
    });
    perfCount("deriveLegSpans");

    legSpansByCaseId.set(caseId, spans);

    return spans;
  };

  const rows: AtRiskRowData[] = [];

  for (const row of openCommitmentRows) {
    const policyVersion = policyVersionsById.get(row.policyVersionId);

    const calendar = calendarsById.get(row.calendarVersionId);

    if (!policyVersion || !calendar) {
      continue;
    }

    const events = eventsByCaseId.get(row.caseId) ?? [];

    const evaluation = evaluateCommitment(
      toCommitmentDomain(row),
      events,
      policyVersion,
      calendar,
      asOf,
    );
    perfCount("evaluateCommitment");

    if (
      evaluation.status !== "on_track" &&
      evaluation.status !== "at_risk" &&
      evaluation.status !== "breached"
    ) {
      continue;
    }

    const spans = getLegSpans(row.caseId, row.case.openedAt);

    const currentSpan = spans[spans.length - 1];

    const currentLeg: Leg = currentSpan?.leg ?? "unknown";

    const minutesInCurrentLeg = currentSpan
      ? minutesBetween(currentSpan.startedAt, asOfDate)
      : 0;

    const targetMinutes =
      policyVersion.targets.find((t) => t.kind === row.kind)?.minutes ?? 0;

    rows.push({
      commitmentId: row.id,
      caseId: row.caseId,
      externalId: row.case.externalId,
      subject: row.case.subject,
      customerName: row.case.customer?.name ?? null,
      requesterName: row.case.requesterName ?? null,
      kind: row.kind,
      remainingMinutes: evaluation.remainingMinutes,
      status: evaluation.status,
      currentLeg,
      minutesInCurrentLeg,
      priority: row.case.priority ?? null,
      tier: row.case.customer?.tier ?? row.case.tier ?? null,
      targetMinutes,
      elapsedSeconds: evaluation.elapsedSeconds,
      supportLegMinutes: sumLegMinutes(spans, "support", asOf),
      engineeringLegMinutes: sumLegMinutes(spans, "engineering", asOf),
      waitingCustomerLegMinutes: sumLegMinutes(spans, "waiting_customer", asOf),
      supportAssigneeName: row.case.assigneeName ?? null,
      linkedIssue: linkedIssueFor(row.caseId),
    });
  }

  rows.sort((a, b) => a.remainingMinutes - b.remainingMinutes);

  return rows;
}
