import os from "node:os";
import { randomBytes } from "node:crypto";
import * as Sentry from "@sentry/node";
/**
 * The worker runs unattended, so a missing provider config is not fatal: it
 * skips that provider and keeps polling the other one rather than crash-looping
 * an install that only connected one of the two systems.
 *
 * Zendesk/Jira OAuth app config, and now SMTP email configuration too, used
 * to live here — loaded once globally from env at startup. Both are now
 * per-organization (settings UI): OAuth app config lives in
 * `IntegrationConfig`, SMTP in `OrganizationEmailSettings`. `cycle.ts`
 * resolves the former per organization via `@sla/db`'s
 * `getIntegrationConfig` and the latter inside `runNotificationPipeline`
 * itself (`@sla/notifications`) — `appUrl` is all this config needs to pass
 * down, to build each provider's redirect URI.
 *
 * The active-poll/reconciliation intervals used to live here too, read once
 * from `WORKER_ACTIVE_POLL_MS`/`WORKER_RECONCILIATION_MS` at startup. They
 * now live in the database (`@sla/db`'s `WorkerSettings`, read fresh before
 * every scheduled tick in `index.ts`) so an owner can change them from the
 * Monitoring settings page without a restart — those env vars are only
 * still consulted once, by `getOrCreateWorkerSettings`, to seed that row on
 * a fresh install.
 *
 * `healthPort`/`opsAlert` (roadmap step 29) are genuinely deployment-level,
 * unlike the config above — there's no per-organization "worker liveness
 * port" or "who gets paged when the worker stalls" to store in the
 * database, so these stay plain env reads here rather than moving to
 * `WorkerSettings`.
 *
 * `lockRetryMs`/`lockPingMs` (roadmap step 42) are the same kind of
 * deployment-level knob, but the advisory lock they drive no longer serializes
 * the worker — any number of workers run side by side, coordinated by
 * per-organization leases in the database (`@sla/db`'s
 * `OrganizationWorkState`). The lock now only elects the one worker that runs
 * the singleton stalled-cycle watchdog; `lockRetryMs` is how often a worker
 * that isn't that one retries, `lockPingMs` how often the holder checks its
 * lock connection is alive.
 *
 * `workerId` names this process in leases and logs. It is unique per process
 * (hostname, pid and a random suffix), never shared, because a lease is owned
 * by exactly one process.
 *
 * `organizationConcurrency` is the same kind of knob: how many organizations
 * one cycle processes at once (integrations within an organization stay
 * sequential).
 */
import { DEFAULT_ORGANIZATION_CONCURRENCY, normalizeConcurrency } from "./concurrency";
import { loadOpsAlertConfig, type OpsAlertConfig } from "./ops-alert";

export interface WorkerConfig {
  appUrl: string | null;
  healthPort: number;
  opsAlert: OpsAlertConfig | null;
  lockRetryMs: number;
  lockPingMs: number;
  organizationConcurrency: number;
  workerId: string;
  /** How long an organization stays leased after this worker's last renewal — i.e. how long a crashed worker's organizations wait before another takes them over. */
  leaseTtlMs: number;
  /** Longest an idle worker sleeps between claim attempts. */
  claimPollMs: number;
  /** How long a stopping worker waits for in-flight organizations to finish before abandoning them. */
  shutdownGraceMs: number;
  /** Postgres connections this process's Prisma pool may open (see `resolveDatabasePoolMax`). */
  databasePoolMax: number;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Connections the worker's Prisma pool needs. The pool is per process, so
 * with several workers the total is the sum — the library-wide default of 20
 * (sized for the web app's request concurrency) would exhaust Postgres's
 * default 100 connections with only a few workers. A worker runs at most
 * `organizationConcurrency` organizations at once, each sequential within
 * itself, plus claim/renew/heartbeat traffic, so `2 × concurrency + 4` leaves
 * headroom without hoarding. `DATABASE_POOL_MAX` overrides it explicitly.
 *
 * Connections *outside* the pool, per worker: one advisory-lock connection
 * held for the watchdog election, and one short-lived per in-flight
 * organization (`withOrganizationSlaLock`) — `organizationConcurrency` more.
 */
export function resolveDatabasePoolMax(organizationConcurrency: number): number {
  return positiveInt("DATABASE_POOL_MAX", 2 * organizationConcurrency + 4);
}

function defaultWorkerId(): string {
  return `${os.hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
}

export function loadWorkerConfig(): WorkerConfig {
  const organizationConcurrency = normalizeConcurrency(
    process.env.ORGANIZATION_CONCURRENCY === undefined
      ? DEFAULT_ORGANIZATION_CONCURRENCY
      : Number(process.env.ORGANIZATION_CONCURRENCY),
  );
  return {
    appUrl: process.env.NEXTAUTH_URL ?? null,
    healthPort: Number(process.env.WORKER_HEALTH_PORT ?? 8081),
    opsAlert: loadOpsAlertConfig(),
    lockRetryMs: Number(process.env.WORKER_LOCK_RETRY_MS ?? 15_000),
    lockPingMs: Number(process.env.WORKER_LOCK_PING_MS ?? 30_000),
    organizationConcurrency,
    workerId: process.env.WORKER_ID || defaultWorkerId(),
    leaseTtlMs: positiveInt("WORKER_LEASE_TTL_MS", 60_000),
    claimPollMs: positiveInt("WORKER_CLAIM_POLL_MS", 1_000),
    shutdownGraceMs: positiveInt("WORKER_SHUTDOWN_GRACE_MS", 30_000),
    databasePoolMax: resolveDatabasePoolMax(organizationConcurrency),
  };
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
});
