import type { PrismaClient } from "@sla/db";
import type { BusinessCalendarVersion } from "@sla/core";
import { toCalendarVersionDomain } from "./calendar-domain";

/**
 * The per-organization reads the commitment, re-resolution and next-reply
 * pipelines all need (active policy versions with their calendar and policy
 * rows, and customer calendar overrides). A worker tick loads them once via
 * `loadPolicyContext` and passes the result to all three (`options.context`),
 * instead of each pipeline re-reading identical rows. Each pipeline still
 * loads its own when called without one (webhook tail, tests).
 *
 * Safe to share across the three: none of them writes a policy version,
 * calendar version or customer override, and the Zendesk policy/calendar
 * import that does runs earlier in the tick, before this is loaded.
 */
export interface PolicyContext {
  policyVersionRows: Awaited<ReturnType<typeof loadPolicyVersionRows>>;
  customersWithCalendarOverride: Awaited<ReturnType<typeof loadCustomerCalendarOverrides>>;
  /**
   * Calendar version id -> that calendar's *current* (latest) version, for
   * every calendar version a policy version or customer override references.
   * A policy/override only identifies *which calendar* applies; a new
   * commitment anchors to that calendar's version at creation time (D1b), so
   * a calendar edit reaches every commitment created after it. See
   * `currentCalendarVersion` (calendar-fallback.ts).
   */
  currentCalendarVersionById: Map<string, BusinessCalendarVersion>;
}

/** The owning-policy columns `toPolicyVersionDomain` reads; every policy-version loader includes exactly these. */
export const POLICY_SELECT = { position: true, source: true, sourceProvider: true } as const;

function loadPolicyVersionRows(prisma: PrismaClient, organizationId: string) {
  return prisma.sLAPolicyVersion.findMany({
    where: { policy: { organizationId, archivedAt: null, deactivatedAt: null } },
    include: {
      calendarVersion: true,
      policy: { select: POLICY_SELECT },
    },
  });
}

function loadCustomerCalendarOverrides(prisma: PrismaClient, organizationId: string) {
  // `Customer.calendarVersionId` only identifies the overriding calendar; new
  // commitments anchor to that calendar's current version (see
  // `loadCurrentCalendarVersions`).
  return prisma.customer.findMany({
    where: { organizationId, calendarVersionId: { not: null } },
    select: { id: true, calendarVersion: true },
  });
}

/**
 * Resolves every referenced calendar version to the latest version of the
 * calendar it belongs to — one query, regardless of how many versions exist.
 */
async function loadCurrentCalendarVersions(
  prisma: PrismaClient,
  referenced: readonly { id: string; calendarId: string }[],
): Promise<Map<string, BusinessCalendarVersion>> {
  const calendarIds = [...new Set(referenced.map((v) => v.calendarId))];
  const latestRows = calendarIds.length
    ? await prisma.businessCalendarVersion.findMany({
        where: { calendarId: { in: calendarIds } },
        orderBy: [{ calendarId: "asc" }, { version: "desc" }],
        distinct: ["calendarId"],
      })
    : [];
  const latestByCalendarId = new Map(latestRows.map((row) => [row.calendarId, toCalendarVersionDomain(row)]));
  const current = new Map<string, BusinessCalendarVersion>();
  for (const { id, calendarId } of referenced) {
    const latest = latestByCalendarId.get(calendarId);
    if (latest) current.set(id, latest);
  }
  return current;
}

export async function loadPolicyContext(prisma: PrismaClient, organizationId: string): Promise<PolicyContext> {
  const [policyVersionRows, customersWithCalendarOverride] = await Promise.all([
    loadPolicyVersionRows(prisma, organizationId),
    loadCustomerCalendarOverrides(prisma, organizationId),
  ]);
  const currentCalendarVersionById = await loadCurrentCalendarVersions(prisma, [
    ...policyVersionRows.map((row) => row.calendarVersion),
    ...customersWithCalendarOverride.flatMap((customer) => (customer.calendarVersion ? [customer.calendarVersion] : [])),
  ]);
  return { policyVersionRows, customersWithCalendarOverride, currentCalendarVersionById };
}

/** Postgres/Prisma `IN` lists are chunked at this size so a large organization never sends one enormous parameter list. */
export const IN_LIST_CHUNK_SIZE = 1000;

export function chunk<T>(items: readonly T[], size: number = IN_LIST_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
