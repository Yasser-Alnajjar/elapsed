import type { PrismaClient } from "@sla/db";
import { errorMessage } from "./utils";

/**
 * Usage instrumentation (N5.7): three facts, written to the database and
 * read back by the platform operator's usage queries. No third-party
 * analytics, no tracking outside the app.
 *
 * Every write here is best-effort. A failure is logged and swallowed, never
 * thrown into the request that triggered it, and none of them runs a query
 * the request depends on.
 */
const warn = (event: string, error: unknown) =>
  console.warn(JSON.stringify({ level: "warn", event, scope: "usage_tracking", error: errorMessage(error) }));

/** A user is stamped at most once per hour. */
export const LAST_SEEN_INTERVAL_MS = 60 * 60_000;

/**
 * Per-process memo of the last stamp attempt, so a busy user costs one write
 * an hour, not one query a request. It records the attempt, not the stored
 * value, so a stamp can lag by up to a further hour (another process wrote
 * first); a weekly measure does not care.
 */
const lastStamped = new Map<string, number>();
const MEMO_LIMIT = 10_000;

export function resetUsageThrottle(): void {
  lastStamped.clear();
}

/**
 * Weekly-active measurement: stamps `User.lastSeenAt`, at most once an hour
 * per user. The conditional update makes the hour a database fact, not just
 * this process's memory, so several web processes still write once an hour.
 */
export async function recordUserSeen(prisma: PrismaClient, userId: string, now: Date = new Date()): Promise<void> {
  const last = lastStamped.get(userId);
  if (last !== undefined && now.getTime() - last < LAST_SEEN_INTERVAL_MS) return;
  if (lastStamped.size >= MEMO_LIMIT) lastStamped.clear();
  lastStamped.set(userId, now.getTime());

  try {
    await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - LAST_SEEN_INTERVAL_MS) } }],
      },
      data: { lastSeenAt: now },
    });
  } catch (error) {
    lastStamped.delete(userId);
    warn("last_seen_write_failed", error);
  }
}

/**
 * Alert click-through: records the first open of a case from one of its
 * alerts' links (`?ref=alert&n=<notificationId>`). The write is scoped to the
 * session's organization and to the case being opened, so a notification id
 * from another organization, or from another case, matches nothing and is
 * ignored. It never reveals whether the id existed.
 */
export async function recordAlertOpened(
  prisma: PrismaClient,
  input: { organizationId: string; caseId: string; notificationId: string; now?: Date },
): Promise<void> {
  try {
    await prisma.notification.updateMany({
      where: {
        id: input.notificationId,
        openedAt: null,
        commitment: { case: { id: input.caseId, organizationId: input.organizationId } },
      },
      data: { openedAt: input.now ?? new Date() },
    });
  } catch (error) {
    warn("alert_open_write_failed", error);
  }
}

/** Time to first value: the first time anyone in the organization saw its findings. Set once. */
export async function recordFirstFindingsViewed(
  prisma: PrismaClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    await prisma.organization.updateMany({
      where: { id: organizationId, firstFindingsViewedAt: null },
      data: { firstFindingsViewedAt: now },
    });
  } catch (error) {
    warn("first_findings_write_failed", error);
  }
}
