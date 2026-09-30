import { getOrCreateWorkerSettings, getWorkStateSummary, type PrismaClient } from "@sla/db";
import { sendOpsAlert, type OpsAlertConfig } from "./ops-alert";
import { captureMessage } from "./sentry";

export type CycleKind = "active_set_poll" | "reconciliation_sweep";

/**
 * A kind is "stalled" once its most overdue organization is more than
 * `STALL_MULTIPLIER - 1` intervals late — the same "hasn't completed in over
 * 3x its interval" threshold as before, now measured per organization
 * (`OrganizationWorkState`) instead of off one global "last cycle" timestamp,
 * which stopped meaning anything once several workers each process their own
 * organizations. A run that is merely a little slow (a GC pause, a slow
 * provider API on one org) must never page anyone; this only fires once work
 * has gone conspicuously unserviced — no worker claiming it, or a holder that
 * never finishes.
 */
const STALL_MULTIPLIER = 3;
const MIN_STALL_MS = 60_000;

/**
 * How often this file's own timer re-checks — independent of either
 * kind's own interval, since a stalled worker is, by definition, not
 * re-checking itself on schedule.
 */
const CHECK_INTERVAL_MS = 2 * 60_000;

/**
 * Per-kind "have we already alerted for the stall that's currently in
 * progress" — in-memory, not persisted: only the watchdog leader runs this
 * check (see `startWatchdogLeadership` in index.ts), so a restart or a change
 * of leader already means a fresh incident either way, and re-alerting once
 * then is harmless. Cleared the moment the kind recovers, so a later,
 * separate stall alerts again rather than staying silently muted.
 */
const alerted = new Set<CycleKind>();

export function isStalled(lagMs: number, intervalMs: number): boolean {
  return lagMs > Math.max(intervalMs * (STALL_MULTIPLIER - 1), MIN_STALL_MS);
}

export async function checkForStalledCycles(
  prisma: PrismaClient,
  opsAlertConfig: OpsAlertConfig | null,
): Promise<void> {
  const [settings, summary] = await Promise.all([getOrCreateWorkerSettings(prisma), getWorkStateSummary(prisma)]);

  const kinds: { kind: CycleKind; lagMs: number; intervalMs: number }[] = [
    { kind: "active_set_poll", lagMs: summary.maxActiveLagMs, intervalMs: settings.activePollIntervalMs },
    { kind: "reconciliation_sweep", lagMs: summary.maxReconciliationLagMs, intervalMs: settings.reconciliationIntervalMs },
  ];

  for (const { kind, lagMs, intervalMs } of kinds) {
    const stalled = isStalled(lagMs, intervalMs);
    const alreadyAlerted = alerted.has(kind);

    if (stalled && !alreadyAlerted) {
      alerted.add(kind);
      const message =
        `${kind} is ${Math.round(lagMs / 1000)}s overdue for at least one organization — more than ` +
        `${STALL_MULTIPLIER - 1}x its configured ${Math.round(intervalMs / 1000)}-second interval ` +
        `(${summary.organizations} organizations, ${summary.leased} leased, ${summary.expiredLeases} with an expired lease).`;
      captureMessage(`SLA worker stalled: ${kind}`, { kind, lagMs, intervalMs, level: "error" });
      console.error(JSON.stringify({ event: "cycle_stalled", kind, lagMs, intervalMs, ...summary }));
      await sendOpsAlert(opsAlertConfig, { subject: `SLA worker stalled: ${kind}`, message });
    } else if (!stalled && alreadyAlerted) {
      alerted.delete(kind);
      console.log(JSON.stringify({ event: "cycle_recovered", kind }));
      await sendOpsAlert(opsAlertConfig, {
        subject: `SLA worker recovered: ${kind}`,
        message: `${kind} is being serviced again for every organization.`,
      });
    }
  }
}

/**
 * Limitation worth stating explicitly: this catches work that is overdue
 * while at least one worker process is alive to run this check (repeated
 * failures, expired leases nobody has re-claimed, a hung await). If every
 * worker is down there is no watchdog either — that failure mode is what the
 * container-level `HEALTHCHECK` against `health-server.ts`'s `/health` (and
 * the orchestrator's restart policy) is for, not this. Full external
 * watchdog infrastructure is this step's stated non-goal.
 */
export function startStalledCycleWatchdog(prisma: PrismaClient, opsAlertConfig: OpsAlertConfig | null): NodeJS.Timeout {
  return setInterval(
    () =>
      void checkForStalledCycles(prisma, opsAlertConfig).catch((error: unknown) =>
        console.error(JSON.stringify({ event: "watchdog_check_failed", error: error instanceof Error ? error.message : String(error) })),
      ),
    CHECK_INTERVAL_MS,
  );
}
