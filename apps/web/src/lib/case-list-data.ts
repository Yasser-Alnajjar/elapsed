import "server-only";
import { perfCount, withPerfScope, type PrismaClient } from "@sla/db";
import {
  deriveLegSpans,
  evaluateCommitment,
  sumLegMinutes,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type CommitmentStatus,
  type NormalizedState,
  type SLAPolicyMatch,
  type SLAPolicyVersion,
  type WeeklyWindow,
} from "@sla/core";
import { toCommitmentDomain, toNormalizedEventDomain } from "@sla/commitments";
import { getAtRiskData } from "./at-risk-data";
import type { AtRiskRowData } from "./types/at-risk";
import type { CaseListData, CaseListRow } from "./types/cases";

// Precedence for picking one representative status out of a case's several
// commitments — worst-first, so a single breached commitment surfaces even
// if another commitment on the same case has already been met.
const STATUS_PRECEDENCE: CommitmentStatus[] = [
  "breached",
  "at_risk",
  "on_track",
  "met",
  "cancelled",
];

function worstStatus(statuses: CommitmentStatus[]): CommitmentStatus | null {
  if (statuses.length === 0) return null;
  return (
    STATUS_PRECEDENCE.find((status) => statuses.includes(status)) ??
    statuses[0] ??
    null
  );
}

/** Picks one live row per case — worst-first (same precedence as `worstStatus`), so a case with several open commitments (e.g. First Response + Resolution) surfaces its most urgent one. */
function worstLiveRow(rows: AtRiskRowData[]): AtRiskRowData | undefined {
  return [...rows].sort(
    (a, b) =>
      STATUS_PRECEDENCE.indexOf(a.status) - STATUS_PRECEDENCE.indexOf(b.status),
  )[0];
}

/**
 * All cases for the organization, open or closed, with every commitment
 * status — no filtering by `Case.closedAt` or `Commitment.status`. The
 * persisted `worstCommitmentStatus` badge is unconditional (covers closed
 * cases too), but `liveCommitment` — the "SLA Target & Runway"/"Leg
 * Allocation" columns' data — is only ever populated for a case with a
 * currently open commitment, by reusing `getAtRiskData`'s live evaluation
 * (the same org-wide pass `/at-risk` already does) rather than re-running
 * `evaluateCommitment` a second time here.
 */
export async function getCaseListData(
  prisma: PrismaClient,
  organizationId: string,
): Promise<CaseListData> {
  return withPerfScope(
    "case_list",
    () => getCaseListDataInner(prisma, organizationId),
    { organizationId },
  );
}

async function getCaseListDataInner(
  prisma: PrismaClient,
  organizationId: string,
): Promise<CaseListData> {
  const [rows, liveRows] = await Promise.all([
    prisma.case.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        customer: true,
        commitments: {
          select: {
            kind: true,
            status: true,
            targetMinutes: true,
          },
        },
        // Same "active relationship" filter as the case-detail page's
        // `links` (see case-detail-data.ts) — a link whose `unlinkedAt` is
        // set must not present a case as currently correlated.
        caseLinks: {
          where: {
            unlinkedAt: null,
            system: { in: ["jira", "linear", "github"] },
          },
          select: {
            system: true,
            externalId: true,
            confidence: true,
            evidence: true,
          },
          take: 1,
        },
      },
      orderBy: { openedAt: "desc" },
    }),
    getAtRiskData(prisma, organizationId),
  ]);

  const liveByCaseId = new Map<string, AtRiskRowData[]>();
  for (const liveRow of liveRows) {
    const existing = liveByCaseId.get(liveRow.caseId);
    if (existing) existing.push(liveRow);
    else liveByCaseId.set(liveRow.caseId, [liveRow]);
  }

  // Settled cases (no live commitment) still show progress: leg minutes come
  // from the case's events, so fetch them only for those cases.
  const settledCaseIds = rows
    .filter((row) => !liveByCaseId.has(row.id) && row.commitments.length > 0)
    .map((row) => row.id);
  const settledEventRows =
    settledCaseIds.length > 0
      ? await prisma.normalizedEvent.findMany({
          where: { caseId: { in: settledCaseIds } },
        })
      : [];
  // Settled elapsed is evaluated (not read from the last persisted
  // `Evaluation`, which can be stale) — same approach as case-detail-data.
  const settledCommitmentRows =
    settledCaseIds.length > 0
      ? await prisma.commitment.findMany({
          where: { caseId: { in: settledCaseIds } },
          include: { policyVersion: true, calendarVersion: true },
        })
      : [];
  const settledRowsByCaseId = new Map<string, typeof settledCommitmentRows>();
  for (const c of settledCommitmentRows) {
    const list = settledRowsByCaseId.get(c.caseId) ?? [];
    list.push(c);
    settledRowsByCaseId.set(c.caseId, list);
  }
  const settledEventsByCaseId = new Map<
    string,
    ReturnType<typeof toNormalizedEventDomain>[]
  >();
  for (const eventRow of settledEventRows) {
    const list = settledEventsByCaseId.get(eventRow.caseId) ?? [];
    list.push(toNormalizedEventDomain(eventRow));
    settledEventsByCaseId.set(eventRow.caseId, list);
  }

  const cases: CaseListRow[] = rows.map((row) => {
    const link = row.caseLinks[0];
    const live = worstLiveRow(liveByCaseId.get(row.id) ?? []);

    let settledCommitment: CaseListRow["settledCommitment"] = null;
    const settledRows = settledRowsByCaseId.get(row.id) ?? [];
    if (!live && settledRows.length > 0) {
      const worst = worstStatus(settledRows.map((c) => c.status));
      const commitment =
        settledRows.find((c) => c.status === worst) ?? settledRows[0]!;
      const asOf = (row.closedAt ?? new Date()).toISOString();
      const events = settledEventsByCaseId.get(row.id) ?? [];
      const policy: SLAPolicyVersion = {
        id: commitment.policyVersion.id,
        policyId: commitment.policyVersion.policyId,
        version: commitment.policyVersion.version,
        match: commitment.policyVersion.match as SLAPolicyMatch,
        targets: commitment.policyVersion.targets as {
          kind: CommitmentKind;
          minutes: number;
        }[],
        pauseOnStates: commitment.policyVersion
          .pauseOnStates as NormalizedState[],
        calendarVersionId: commitment.policyVersion.calendarVersionId,
        warnAtPercent: commitment.policyVersion.warnAtPercent,
        effectiveFrom: commitment.policyVersion.effectiveFrom.toISOString(),
      };
      const calendar: BusinessCalendarVersion = {
        id: commitment.calendarVersion.id,
        version: commitment.calendarVersion.version,
        timezone: commitment.calendarVersion.timezone,
        weekly: commitment.calendarVersion.weekly as unknown as WeeklyWindow[],
        holidays: commitment.calendarVersion.holidays,
        alwaysOpen: commitment.calendarVersion.alwaysOpen,
      };
      const evaluation = evaluateCommitment(
        toCommitmentDomain(commitment),
        events,
        policy,
        calendar,
        commitment.closedAt?.toISOString() ?? asOf,
      );
      perfCount("evaluateCommitment");
      const { spans } = deriveLegSpans(events, {
        caseOpenedAt: row.openedAt.toISOString(),
      });
      perfCount("deriveLegSpans");
      settledCommitment = {
        kind: commitment.kind,
        status: commitment.status,
        targetMinutes: commitment.targetMinutes,
        elapsedSeconds: evaluation.elapsedSeconds,
        supportLegMinutes: sumLegMinutes(spans, "support", asOf),
        engineeringLegMinutes: sumLegMinutes(spans, "engineering", asOf),
      };
    }

    return {
      caseId: row.id,
      externalId: row.externalId,
      subject: row.subject,
      customerName: row.customer?.name ?? null,
      requesterName: row.requesterName ?? null,
      priority: row.priority,
      tier: row.tier,
      channel: row.channel,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      worstCommitmentStatus: worstStatus(row.commitments.map((c) => c.status)),
      assigneeName: row.assigneeName,
      primaryLink: link
        ? {
            system: link.system as "jira" | "linear" | "github",
            externalId: link.externalId,
            confidence: link.confidence as "certain" | "probable",
            statusName:
              (link.evidence as { statusName?: string } | null)?.statusName ??
              null,
          }
        : null,
      liveCommitment: live
        ? {
            kind: live.kind,
            status: live.status,
            targetMinutes: live.targetMinutes,
            remainingMinutes: live.remainingMinutes,
            elapsedSeconds: live.elapsedSeconds,
            supportLegMinutes: live.supportLegMinutes,
            engineeringLegMinutes: live.engineeringLegMinutes,
          }
        : null,
      settledCommitment,
    };
  });

  return { asOf: new Date().toISOString(), cases };
}
