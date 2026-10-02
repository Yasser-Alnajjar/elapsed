import { computeLinkCoverage, LINK_COVERAGE_WINDOW_DAYS, NO_LINK_COVERAGE } from "@sla/commitments";
import type { PrismaClient } from "@sla/db";
import { ISSUE_LINK_PROVIDERS } from "./providers";
import type { LinkCoverage, LinkCoveragePanel, UncoveredCaseRow } from "./types/link-coverage";

export { LINK_COVERAGE_WINDOW_DAYS, NO_LINK_COVERAGE };

/**
 * Link coverage (see `computeLinkCoverage` in `@sla/commitments`, shared with
 * the monthly report) for the organizations asked about, with this app's
 * registry deciding which providers are trackers or code hosts. Two `groupBy`
 * queries cover any number of organizations. Pass `organizationIds` to
 * restrict it; the result has an entry for each of them (zeros when they have
 * no cases), and otherwise only for organizations that opened a case in the
 * window.
 */
export function getLinkCoverage(
  prisma: PrismaClient,
  options: { organizationIds?: string[]; now?: Date } = {},
): Promise<Map<string, LinkCoverage>> {
  return computeLinkCoverage(prisma, { ...options, issueLinkProviders: ISSUE_LINK_PROVIDERS });
}

const UNCOVERED_CASES_LIMIT = 8;

/**
 * The customer's own link coverage (N5.5): `getLinkCoverage`'s number for one
 * organization, plus the cases that make up the gap. The percentage is the
 * shared function's, so the dashboard, the monthly report and the platform
 * admin print the same figure. A `probable` link never counts as covered; the
 * cases that hold only one are reported separately instead.
 */
export async function getLinkCoveragePanel(
  prisma: PrismaClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<LinkCoveragePanel> {
  const coverage = (await getLinkCoverage(prisma, { organizationIds: [organizationId], now })).get(organizationId) ?? NO_LINK_COVERAGE;
  const since = new Date(now.getTime() - LINK_COVERAGE_WINDOW_DAYS * 24 * 3_600_000);
  const uncoveredWhere = {
    organizationId,
    deletedAt: null,
    openedAt: { gte: since },
    caseLinks: { none: { confidence: "certain" as const, unlinkedAt: null, system: { in: ISSUE_LINK_PROVIDERS } } },
  };

  const [rows, probableOnlyCases] = await Promise.all([
    prisma.case.findMany({
      where: uncoveredWhere,
      select: {
        id: true,
        externalId: true,
        subject: true,
        openedAt: true,
        customer: { select: { name: true } },
        caseLinks: { where: { confidence: "probable", unlinkedAt: null, system: { in: ISSUE_LINK_PROVIDERS } }, select: { id: true }, take: 1 },
      },
      orderBy: { openedAt: "desc" },
      take: UNCOVERED_CASES_LIMIT,
    }),
    prisma.case.count({
      where: { ...uncoveredWhere, caseLinks: { some: { confidence: "probable", unlinkedAt: null, system: { in: ISSUE_LINK_PROVIDERS } } } },
    }),
  ]);
  const uncoveredCount = coverage.cases - coverage.linkedCases;

  const uncovered: UncoveredCaseRow[] = rows.map((row) => ({
    caseId: row.id,
    externalId: row.externalId,
    subject: row.subject,
    customerName: row.customer?.name ?? null,
    openedAt: row.openedAt.toISOString(),
    hasProbableLink: row.caseLinks.length > 0,
  }));

  return {
    ...coverage,
    windowDays: LINK_COVERAGE_WINDOW_DAYS,
    probableOnlyCases,
    uncovered,
    uncoveredOverflowCount: Math.max(0, uncoveredCount - uncovered.length),
  };
}
