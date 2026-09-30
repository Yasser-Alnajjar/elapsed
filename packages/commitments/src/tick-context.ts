import type { PrismaClient } from "@sla/db";

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
  // 4d: frozen at the moment a customer's calendar override was set
  // (`Customer.calendarVersionId`), never the calendar's latest version.
  return prisma.customer.findMany({
    where: { organizationId, calendarVersionId: { not: null } },
    select: { id: true, calendarVersion: true },
  });
}

export async function loadPolicyContext(prisma: PrismaClient, organizationId: string): Promise<PolicyContext> {
  const [policyVersionRows, customersWithCalendarOverride] = await Promise.all([
    loadPolicyVersionRows(prisma, organizationId),
    loadCustomerCalendarOverrides(prisma, organizationId),
  ]);
  return { policyVersionRows, customersWithCalendarOverride };
}

/** Postgres/Prisma `IN` lists are chunked at this size so a large organization never sends one enormous parameter list. */
export const IN_LIST_CHUNK_SIZE = 1000;

export function chunk<T>(items: readonly T[], size: number = IN_LIST_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
