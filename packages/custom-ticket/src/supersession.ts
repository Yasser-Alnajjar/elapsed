/**
 * A stored sync run is superseded by a later clean check (D32, plan 09 6.12).
 *
 * A successful run that changed nothing is no longer stored, so the newest
 * stored run can be older than the integration's real state. The worker writes
 * `Integration.lastSuccessfulSyncAt` with the very instant it stores as that
 * run's `finishedAt`, so a stored successful run never supersedes itself and
 * any later successful check is strictly newer. A failed, partial or aborted
 * run never advances `lastSuccessfulSyncAt`, so a failure after the last clean
 * check is never superseded.
 */
export function isRunSuperseded(
  run: { startedAt: Date | string; finishedAt?: Date | string | null },
  lastSuccessfulSyncAt: Date | string | null | undefined,
): boolean {
  if (lastSuccessfulSyncAt === null || lastSuccessfulSyncAt === undefined) return false;
  return new Date(lastSuccessfulSyncAt).getTime() > new Date(run.finishedAt ?? run.startedAt).getTime();
}
