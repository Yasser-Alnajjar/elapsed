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
 * deployment-level knob: how often a standby retries the single-instance
 * advisory lock, and how often the holder checks its lock connection is
 * still alive.
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
}

export function loadWorkerConfig(): WorkerConfig {
  return {
    appUrl: process.env.NEXTAUTH_URL ?? null,
    healthPort: Number(process.env.WORKER_HEALTH_PORT ?? 8081),
    opsAlert: loadOpsAlertConfig(),
    lockRetryMs: Number(process.env.WORKER_LOCK_RETRY_MS ?? 15_000),
    lockPingMs: Number(process.env.WORKER_LOCK_PING_MS ?? 30_000),
    organizationConcurrency: normalizeConcurrency(
      process.env.ORGANIZATION_CONCURRENCY === undefined
        ? DEFAULT_ORGANIZATION_CONCURRENCY
        : Number(process.env.ORGANIZATION_CONCURRENCY),
    ),
  };
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
});
