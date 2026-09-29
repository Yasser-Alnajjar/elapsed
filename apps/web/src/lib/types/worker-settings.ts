import type { WorkerStatus } from "@sla/db";

export type { WorkerStatus };

// Deliberately not imported from `@sla/db` (which also exports these): this
// file is imported by client components (`modules/operator/monitoring/csr`),
// and a *value* import of anything from `@sla/db`'s barrel would pull the
// whole package — including the `pg`/`@prisma/adapter-pg` Node-only Postgres
// driver — into the browser bundle. These are UI-only convenience bounds
// (which options to offer); `@sla/db`'s `validateWorkerSettingsInput` is the
// actual source of truth, enforced server-side regardless of what the
// dropdown shows. Keep in sync with `MIN_ACTIVE_POLL_INTERVAL_MS` /
// `MAX_ACTIVE_POLL_INTERVAL_MS` / `MIN_RECONCILIATION_INTERVAL_MS` /
// `MAX_RECONCILIATION_INTERVAL_MS` in packages/db/src/worker-settings.ts.
const MIN_ACTIVE_POLL_INTERVAL_MS = 5_000;
const MAX_ACTIVE_POLL_INTERVAL_MS = 30 * 60_000;
const MIN_RECONCILIATION_INTERVAL_MS = 5 * 60_000;
const MAX_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60_000;

/** Mirrors the API's `WorkerSettings & WorkerStatus` response shape — see apps/web/src/app/api/settings/worker/route.ts. */
export interface WorkerMonitoringData {
  activePollIntervalMs: number;
  reconciliationIntervalMs: number;
  status: WorkerStatus;
  lastActivePollAt: string | null;
  /** The worker scheduler's own next-run time — never `lastActivePollAt + activePollIntervalMs`. Null until the worker has armed a timer for this kind at least once. */
  nextActivePollAt: string | null;
  lastReconciliationAt: string | null;
  /** Same contract as `nextActivePollAt`, for the reconciliation sweep. */
  nextReconciliationAt: string | null;
  /** Whether the signed-in user can change these settings (platform operator; this data is only served to platform operators). */
  canEdit: boolean;
}

export interface IntervalOption {
  ms: number;
  label: string;
}

/**
 * Human-friendly choices offered in the edit control — never raw
 * milliseconds. Each field's dropdown is filtered to this list by its own
 * min/max (see `ACTIVE_POLL_OPTIONS`/`RECONCILIATION_OPTIONS` below); the
 * server still re-validates independently (including the SLA-relative
 * safety check, which isn't representable as a static bound here).
 */
const ALL_INTERVAL_OPTIONS: IntervalOption[] = [
  { ms: 5_000, label: "5 seconds" },
  { ms: 10_000, label: "10 seconds" },
  { ms: 15_000, label: "15 seconds" },
  { ms: 30_000, label: "30 seconds" },
  { ms: 60_000, label: "1 minute" },
  { ms: 2 * 60_000, label: "2 minutes" },
  { ms: 5 * 60_000, label: "5 minutes" },
  { ms: 10 * 60_000, label: "10 minutes" },
  { ms: 15 * 60_000, label: "15 minutes" },
  { ms: 30 * 60_000, label: "30 minutes" },
  { ms: 60 * 60_000, label: "1 hour" },
  { ms: 2 * 60 * 60_000, label: "2 hours" },
  { ms: 6 * 60 * 60_000, label: "6 hours" },
  { ms: 12 * 60 * 60_000, label: "12 hours" },
  { ms: 24 * 60 * 60_000, label: "24 hours" },
];

export const ACTIVE_POLL_OPTIONS = ALL_INTERVAL_OPTIONS.filter(
  (option) => option.ms >= MIN_ACTIVE_POLL_INTERVAL_MS && option.ms <= MAX_ACTIVE_POLL_INTERVAL_MS,
);

export const RECONCILIATION_OPTIONS = ALL_INTERVAL_OPTIONS.filter(
  (option) => option.ms >= MIN_RECONCILIATION_INTERVAL_MS && option.ms <= MAX_RECONCILIATION_INTERVAL_MS,
);
