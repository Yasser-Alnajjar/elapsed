import type { PrismaClient } from "@sla/db";
import { ISSUE_LINK_PROVIDERS } from "./providers";
import type { LinkCoverage } from "./types/link-coverage";

/** Cases opened in this many days are measured. */
export const LINK_COVERAGE_WINDOW_DAYS = 30;

export const NO_LINK_COVERAGE: LinkCoverage = { cases: 0, linkedCases: 0, ratio: null };

/**
 * Link coverage: of the cases opened in the last 30 days, the share that has
 * at least one currently-active, `certain` link to a work tracker or code
 * host. A case with no such link has no engineering leg timing, so its
 * resolution time is measured without it; the ratio says how much of a
 * tenant's data that affects.
 *
 * One function so every surface agrees: the platform admin's tenants list and
 * detail (N4.4) and, later, the customer-facing panel (N5) both call it.
 * Two `groupBy` queries cover any number of organizations (no per-tenant
 * queries). Pass `organizationIds` to restrict it; the result has an entry for
 * each of them (zeros when they have no cases), and otherwise only for
 * organizations that opened a case in the window.
 */
export async function getLinkCoverage(
  prisma: PrismaClient,
  options: { organizationIds?: string[]; now?: Date } = {},
): Promise<Map<string, LinkCoverage>> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - LINK_COVERAGE_WINDOW_DAYS * 24 * 3_600_000);
  const scope = {
    openedAt: { gte: since },
    deletedAt: null,
    ...(options.organizationIds ? { organizationId: { in: options.organizationIds } } : {}),
  };

  const [casesByOrganization, linkedByOrganization] = await Promise.all([
    prisma.case.groupBy({ by: ["organizationId"], where: scope, _count: { _all: true } }),
    prisma.case.groupBy({
      by: ["organizationId"],
      where: {
        ...scope,
        caseLinks: {
          some: { confidence: "certain", unlinkedAt: null, system: { in: ISSUE_LINK_PROVIDERS } },
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
