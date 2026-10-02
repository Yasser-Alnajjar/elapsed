import { Prisma, type PrismaClient } from "@sla/db";
import type { AdminUsageData, AdminUsageOrganizationRow } from "./types/admin";

/**
 * Platform-admin read model for the usage metrics (N5.7): weekly active
 * organizations, alert click-through and time to first value. Reads across
 * every organization, so callers must have confirmed `isPlatformOperator`, and
 * nothing outside `app/(admin)` and `modules/admin` may import it
 * (`admin-boundary.test.ts`). Four queries however many tenants there are.
 */
export const USAGE_ACTIVE_WINDOW_DAYS = 7;
export const USAGE_ALERT_WINDOW_DAYS = 30;

const DAY_MS = 24 * 3_600_000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export async function getAdminUsageData(prisma: PrismaClient, now: Date = new Date()): Promise<AdminUsageData> {
  const activeSince = new Date(now.getTime() - USAGE_ACTIVE_WINDOW_DAYS * DAY_MS);
  const alertsSince = new Date(now.getTime() - USAGE_ALERT_WINDOW_DAYS * DAY_MS);

  const [organizations, lastSeen, alertRows, weeklyActiveUsers] = await Promise.all([
    prisma.organization.findMany({
      select: { id: true, name: true, createdAt: true, firstFindingsViewedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.groupBy({ by: ["organizationId"], _max: { lastSeenAt: true } }),
    // A claim in flight (`channel = 'pending'`) is not a delivered alert.
    prisma.$queryRaw<{ organizationId: string; sent: bigint; opened: bigint }[]>(Prisma.sql`
      SELECT c."organizationId" AS "organizationId", count(*) AS sent, count(n."openedAt") AS opened
      FROM notifications n
      JOIN commitments m ON m.id = n."commitmentId"
      JOIN cases c ON c.id = m."caseId"
      WHERE n.channel <> 'pending' AND n."sentAt" >= ${alertsSince}
      GROUP BY c."organizationId"`),
    prisma.user.count({ where: { lastSeenAt: { gte: activeSince } } }),
  ]);

  const seenByOrganization = new Map(lastSeen.map((row) => [row.organizationId, row._max.lastSeenAt]));
  const alertsByOrganization = new Map(alertRows.map((row) => [row.organizationId, { sent: Number(row.sent), opened: Number(row.opened) }]));

  const rows: AdminUsageOrganizationRow[] = organizations.map((organization) => {
    const seen = seenByOrganization.get(organization.id) ?? null;
    const alerts = alertsByOrganization.get(organization.id) ?? { sent: 0, opened: 0 };
    return {
      organizationId: organization.id,
      name: organization.name,
      lastSeenAt: seen?.toISOString() ?? null,
      activeThisWeek: seen !== null && seen >= activeSince,
      alertsSent30d: alerts.sent,
      alertsOpened30d: alerts.opened,
      minutesToFirstValue: organization.firstFindingsViewedAt
        ? Math.max(0, Math.round((organization.firstFindingsViewedAt.getTime() - organization.createdAt.getTime()) / 60_000))
        : null,
    };
  });

  const sent = rows.reduce((sum, row) => sum + row.alertsSent30d, 0);
  const opened = rows.reduce((sum, row) => sum + row.alertsOpened30d, 0);
  const ttfv = rows.flatMap((row) => (row.minutesToFirstValue === null ? [] : [row.minutesToFirstValue]));

  return {
    asOf: now.toISOString(),
    activeWindowDays: USAGE_ACTIVE_WINDOW_DAYS,
    alertWindowDays: USAGE_ALERT_WINDOW_DAYS,
    organizationCount: rows.length,
    weeklyActiveOrganizations: rows.filter((row) => row.activeThisWeek).length,
    weeklyActiveUsers,
    alerts: { sent, opened, clickThroughRatio: sent > 0 ? opened / sent : null },
    timeToFirstValue: { organizations: ttfv.length, medianMinutes: median(ttfv) },
    // Never-seen first, then least recently seen: the organizations to look into lead.
    organizations: rows.sort((a, b) => {
      if (a.lastSeenAt === b.lastSeenAt) return a.name.localeCompare(b.name);
      if (a.lastSeenAt === null) return -1;
      if (b.lastSeenAt === null) return 1;
      return a.lastSeenAt < b.lastSeenAt ? -1 : 1;
    }),
  };
}
