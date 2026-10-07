import { CASE_SOURCE_CONNECTED, SYSTEM_SOURCE_CONNECTED, type IntegrationProvider, type PrismaClient } from "@sla/db";

/**
 * Link coverage: of the cases opened in the last 30 days, the share that has at
 * least one currently-active, `certain` link to a work tracker or code host. A
 * case with no such link has no engineering leg timing, so its resolution time
 * is measured without it; the ratio says how much of a tenant's data that
 * affects. A `probable` link never counts.
 *
 * One implementation so every surface agrees: the platform admin's tenants list
 * and detail (N4.4), the customer's dashboard panel (N5.5) and the monthly
 * report (N5.6). The caller names which providers are trackers or code hosts
 * (its adapter registry), so this package knows no provider.
 */

/** Cases opened in this many days are measured. */
export const LINK_COVERAGE_WINDOW_DAYS = 30;

/** Link coverage of one organization over a window of recent cases. */
export interface LinkCoverage {
  /** Cases opened in the window (not deleted). */
  cases: number;
  /** Of those, cases with at least one active, `certain` link to a work tracker or code host. */
  linkedCases: number;
  /** `linkedCases / cases`; null when there are no cases to measure. */
  ratio: number | null;
}

export const NO_LINK_COVERAGE: LinkCoverage = { cases: 0, linkedCases: 0, ratio: null };

export async function computeLinkCoverage(
  prisma: PrismaClient,
  options: { issueLinkProviders: IntegrationProvider[]; organizationIds?: string[]; now?: Date },
): Promise<Map<string, LinkCoverage>> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - LINK_COVERAGE_WINDOW_DAYS * 24 * 3_600_000);
  const scope = {
    openedAt: { gte: since },
    deletedAt: null,
    ...CASE_SOURCE_CONNECTED,
    ...(options.organizationIds ? { organizationId: { in: options.organizationIds } } : {}),
  };

  const [casesByOrganization, linkedByOrganization] = await Promise.all([
    prisma.case.groupBy({ by: ["organizationId"], where: scope, _count: { _all: true } }),
    prisma.case.groupBy({
      by: ["organizationId"],
      where: {
        ...scope,
        caseLinks: {
          some: { confidence: "certain", unlinkedAt: null, system: { in: options.issueLinkProviders }, ...SYSTEM_SOURCE_CONNECTED },
        },
      },
      _count: { _all: true },
    }),
  ]);

  const linked = new Map(linkedByOrganization.map((row) => [row.organizationId, row._count._all]));
  const coverage = new Map<string, LinkCoverage>();
  for (const organizationId of options.organizationIds ?? []) coverage.set(organizationId, NO_LINK_COVERAGE);
  for (const row of casesByOrganization) {
    const cases = row._count._all;
    const linkedCases = linked.get(row.organizationId) ?? 0;
    coverage.set(row.organizationId, { cases, linkedCases, ratio: cases > 0 ? linkedCases / cases : null });
  }
  return coverage;
}
