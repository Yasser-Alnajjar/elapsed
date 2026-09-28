import pg from "pg";
import { createLogger } from "@sla/logger";
import type { PrismaClient } from "../generated/prisma/client";
import { isPerfMetricsEnabled } from "./perf-metrics";

const lockLogger = createLogger({ scope: "organization_lock" });

// Generous on purpose: a caller queued behind another's projection waits on
// this lock, and only the lock (no rows) is held meanwhile.
const LOCK_WAIT_TIMEOUT_MS = 15 * 60_000;

/**
 * Runs `work` while holding a per-organization Postgres advisory lock, so
 * normalization and the commitment/cycle/evaluation/notification pipeline
 * tail for one organization never run concurrently from two call sites —
 * the worker's own cycle, a Zendesk/Jira webhook delivery, and the
 * onboarding source-sync backfill routes all write the same Case/
 * NormalizedEvent/Commitment rows for that organization (roadmap step E-3).
 * Deliberately excludes provider backfill/ingestion: that's network-bound
 * and idempotent (RawEvent upserts), so it never needs to wait behind this
 * lock, only the DB-local projection and pipeline steps that follow it.
 *
 * The lock is held on a **dedicated, unpooled** `pg` connection — never
 * `prisma.$transaction` — for the same reason `advisory-lock.ts` uses one
 * for the worker's own lock: `work()` runs its own queries on `prisma`'s
 * shared pool, and a caller merely *waiting* for this lock must never pin
 * one of that pool's limited connections while it waits. Holding the wait on
 * a pooled connection self-deadlocks under any real concurrency — enough
 * simultaneous callers for one organization (e.g. a burst of Zendesk webhook
 * deliveries for one ticket update) exhaust the pool with connections idle
 * *waiting* for the lock, leaving the eventual winner with no connection
 * left to run `work()` on, so it hangs until the caller's own timeout (a
 * 504 upstream) — reproduced locally 2026-09-19 by a burst of ~10 concurrent
 * Zendesk webhook deliveries for the same ticket.
 *
 * `prisma` is kept in the signature for every caller's convenience (its pool
 * is what `work()` uses) but not used for the lock itself — the dedicated
 * connection is opened straight from `DATABASE_URL`, matching
 * `connectAdvisoryLockConnection`.
 */
export async function withOrganizationSlaLock<T>(
  _prisma: PrismaClient,
  organizationId: string,
  work: () => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  const trackMetrics = isPerfMetricsEnabled();
  const acquireStartedAt = trackMetrics ? performance.now() : 0;
  try {
    await client.query("BEGIN");
    // Postgres applies `lock_timeout` to an advisory-lock wait like any
    // other lock wait — the query below errors (55P03) instead of blocking
    // past this, rather than relying on a JS-side timer that can't actually
    // cancel a query already in flight on the wire.
    await client.query(`SET LOCAL lock_timeout = '${LOCK_WAIT_TIMEOUT_MS}ms'`);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`sla-processing:${organizationId}`],
    );
    const holdStartedAt = trackMetrics ? performance.now() : 0;
    const result = await work();
    await client.query("COMMIT");
    if (trackMetrics) {
      lockLogger.info("organization_lock_duration", {
        organizationId,
        waitMs: Math.round(holdStartedAt - acquireStartedAt),
        holdMs: Math.round(performance.now() - holdStartedAt),
      });
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
