import {
  attributeBreachLegs,
  computeLinkCoverage,
  findBreachesInPeriod,
  getPersistedBreachedAt,
  NO_LINK_COVERAGE,
  type BreachOccurrence,
  type LinkCoverage,
} from "@sla/commitments";
import { monthBounds, type CommitmentKind, type Leg } from "@sla/core";
import type { IntegrationProvider, PrismaClient } from "@sla/db";

/**
 * The monthly customer report (N5.6): one organization, one calendar month on
 * its own wall clock. Every figure is read from persisted facts and computed by
 * the same functions the dashboard uses (`@sla/commitments`), so the report
 * and the dashboard cannot disagree.
 *
 * Language is neutral by design: it says where time was spent and how many
 * commitments were met, never who is at fault. `monthly-report-render.test.ts` scans
 * the rendered output for words that assign blame.
 */

/** A commitment kind in the order it is reported. */
export const REPORT_KIND_ORDER: CommitmentKind[] = ["first_response", "next_reply", "resolution"];

export interface MonthlyComplianceRow {
  kind: CommitmentKind;
  /** Commitments of this kind closed in the month as met. */
  met: number;
  /** Commitments of this kind whose clock crossed its target in the month. */
  breached: number;
  /** `met / (met + breached)` as a percentage with one decimal; null when nothing reached an outcome. */
  compliancePercent: number | null;
}

export interface MonthlyStageRow {
  leg: Leg;
  count: number;
}

export interface MonthlyCustomerRow {
  customerName: string;
  breaches: number;
}

/** One breach, for the attached CSV. Never includes the case subject or any message text. */
export interface MonthlyBreachRow {
  customerName: string | null;
  ticketId: string;
  kind: CommitmentKind;
  targetMinutes: number;
  breachedAt: string;
  stage: Leg;
}

export interface MonthlyReport {
  organizationId: string;
  organizationName: string;
  /** `YYYY-MM`, the month on the organization's wall clock. */
  period: string;
  timezone: string;
  /** First instant of the month, and of the next one (exclusive). */
  start: string;
  end: string;
  complianceByKind: MonthlyComplianceRow[];
  overall: { met: number; breached: number; compliancePercent: number | null };
  /** "Time by stage": where the clock was when each breach happened. Largest first. */
  breachesByStage: MonthlyStageRow[];
  topCustomers: MonthlyCustomerRow[];
  /** Cases opened in the month, for context beside the percentages. */
  casesOpened: number;
  linkCoverage: LinkCoverage;
  breaches: MonthlyBreachRow[];
  /** Where the full case list lives; null when the deployment has no public URL configured. */
  caseListUrl: string | null;
  generatedAt: string;
}

export interface BuildMonthlyReportInput {
  organizationId: string;
  period: string;
  /** Which providers are trackers or code hosts (the caller's adapter registry); this package names none. */
  issueLinkProviders: IntegrationProvider[];
  appUrl: string | null;
  now?: Date;
}

const TOP_CUSTOMERS = 5;
/** The attachment lists every breach up to this many; a month with more is cut, and the report says so. */
export const MAX_REPORT_BREACH_ROWS = 5000;

const percent = (met: number, breached: number): number | null =>
  met + breached === 0 ? null : Math.round((met / (met + breached)) * 1000) / 10;

/** Whether the month had anything to report: a case opened, a commitment met, or a breach. */
export function hasActivity(report: MonthlyReport): boolean {
  return report.casesOpened > 0 || report.overall.met > 0 || report.overall.breached > 0;
}

export async function buildMonthlyReport(prisma: PrismaClient, input: BuildMonthlyReportInput): Promise<MonthlyReport | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, timezone: true },
  });
  if (!organization) return null;

  const { start, end } = monthBounds(input.period, organization.timezone);
  const lastInstant = new Date(end.getTime() - 1);
  const scope = { organizationId: organization.id, deletedAt: null } as const;

  const [metByKind, breachCandidates, casesOpened, coverage] = await Promise.all([
    prisma.commitment.groupBy({
      by: ["kind"],
      where: { case: scope, status: "met", closedAt: { gte: start, lt: end } },
      _count: { _all: true },
    }),
    // Any commitment already marked breached whose nominal due date is before
    // month end. Its true crossing instant (`breachedAt`, pause-aware) can fall
    // later than `dueAt`, so the window is checked on that, below.
    prisma.commitment.findMany({
      where: { case: scope, status: "breached", dueAt: { lt: end } },
      select: { id: true, caseId: true, kind: true, dueAt: true, targetMinutes: true, case: { select: { openedAt: true } } },
    }),
    prisma.case.count({ where: { ...scope, openedAt: { gte: start, lt: end } } }),
    // The 30 days ending with the month, so the figure describes the month reported.
    computeLinkCoverage(prisma, { issueLinkProviders: input.issueLinkProviders, organizationIds: [organization.id], now: end }),
  ]);

  const breachedAt = await getPersistedBreachedAt(prisma, breachCandidates.map((c) => c.id));
  const targetByCommitment = new Map(breachCandidates.map((c) => [c.id, c.targetMinutes]));
  const breaches: BreachOccurrence[] = findBreachesInPeriod(
    breachCandidates.map((c) => ({ commitmentId: c.id, caseId: c.caseId, kind: c.kind, caseOpenedAt: c.case.openedAt, dueAt: c.dueAt })),
    breachedAt,
    start,
    lastInstant,
  );

  const withLegs = await attributeBreachLegs(prisma, breaches);

  const caseIds = [...new Set(breaches.map((b) => b.caseId))];
  const cases =
    caseIds.length > 0
      ? await prisma.case.findMany({
          where: { id: { in: caseIds } },
          select: { id: true, externalId: true, customer: { select: { name: true } } },
        })
      : [];
  const caseById = new Map(cases.map((c) => [c.id, c]));

  const metCount = new Map(metByKind.map((row) => [row.kind, row._count._all]));
  const breachedCount = new Map<CommitmentKind, number>();
  for (const breach of breaches) breachedCount.set(breach.kind, (breachedCount.get(breach.kind) ?? 0) + 1);

  const complianceByKind: MonthlyComplianceRow[] = REPORT_KIND_ORDER.map((kind) => {
    const met = metCount.get(kind) ?? 0;
    const breached = breachedCount.get(kind) ?? 0;
    return { kind, met, breached, compliancePercent: percent(met, breached) };
  });
  const overallMet = complianceByKind.reduce((sum, row) => sum + row.met, 0);
  const overallBreached = complianceByKind.reduce((sum, row) => sum + row.breached, 0);

  const stageCounts = new Map<Leg, number>();
  for (const { leg } of withLegs) stageCounts.set(leg, (stageCounts.get(leg) ?? 0) + 1);

  const customerCounts = new Map<string, number>();
  for (const breach of breaches) {
    const name = caseById.get(breach.caseId)?.customer?.name ?? "No customer";
    customerCounts.set(name, (customerCounts.get(name) ?? 0) + 1);
  }

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    period: input.period,
    timezone: organization.timezone,
    start: start.toISOString(),
    end: end.toISOString(),
    complianceByKind,
    overall: { met: overallMet, breached: overallBreached, compliancePercent: percent(overallMet, overallBreached) },
    breachesByStage: [...stageCounts.entries()].map(([leg, count]) => ({ leg, count })).sort((a, b) => b.count - a.count || a.leg.localeCompare(b.leg)),
    topCustomers: [...customerCounts.entries()]
      .map(([customerName, count]) => ({ customerName, breaches: count }))
      .sort((a, b) => b.breaches - a.breaches || a.customerName.localeCompare(b.customerName))
      .slice(0, TOP_CUSTOMERS),
    casesOpened,
    linkCoverage: coverage.get(organization.id) ?? NO_LINK_COVERAGE,
    breaches: withLegs.slice(0, MAX_REPORT_BREACH_ROWS).map(({ breach, leg }) => {
      const row = caseById.get(breach.caseId);
      return {
        customerName: row?.customer?.name ?? null,
        ticketId: row?.externalId ?? "",
        kind: breach.kind,
        targetMinutes: targetByCommitment.get(breach.commitmentId) ?? 0,
        breachedAt: breach.breachedAt.toISOString(),
        stage: leg,
      };
    }),
    caseListUrl: input.appUrl ? `${input.appUrl.replace(/\/$/, "")}/cases?status=breached` : null,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
