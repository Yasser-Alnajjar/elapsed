import { cn } from "@/lib/utils";
import { COMMITMENT_STATUS_STYLES } from "@/lib/status-styles";
import { formatCommitmentKind } from "@/lib/format";
import type { CommitmentKindHealth } from "@/lib/types/dashboard";

/**
 * Phase 6.1: on-track/at-risk/breached, broken out per `CommitmentKind`
 * (First Response, Next Reply, Resolution) — the KPI tiles above roll every
 * kind together, so a kind that's quietly all-breached while the others are
 * healthy has nowhere else to show up.
 */
export function SlaHealthByKindCard({
  rows,
}: {
  rows: CommitmentKindHealth[];
}) {
  return (
    <div className="h-full bg-surface-container-low shadow-soft flex flex-col overflow-hidden rounded-xl">
      <div className="bg-surface-container/60 border-surface-container-highest/60 border-b p-4">
        <h3 className="text-on-surface text-base font-medium">
          SLA Health by Commitment Type
        </h3>
        <p className="text-outline text-sm">
          On track, at risk, and breached — among currently open commitments
        </p>
      </div>
      <div className="flex flex-col gap-4 p-4">
        {rows.map((row) => {
          const total = row.onTrack + row.atRisk + row.breached;
          return (
            <div key={row.kind} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-on-surface font-medium">
                  {formatCommitmentKind(row.kind)}
                </span>
                <span className="text-outline font-mono text-xs">
                  {total} open
                </span>
              </div>
              {total === 0 ? (
                <div className="bg-surface-container-highest h-2 w-full rounded-full" />
              ) : (
                <div className="bg-surface-container-highest flex h-2 w-full overflow-hidden rounded-full">
                  <div
                    className={cn("h-full", COMMITMENT_STATUS_STYLES.on_track.fill)}
                    style={{ width: `${(row.onTrack / total) * 100}%` }}
                    title={`${row.onTrack} on track`}
                  />
                  <div
                    className={cn("h-full", COMMITMENT_STATUS_STYLES.at_risk.fill)}
                    style={{ width: `${(row.atRisk / total) * 100}%` }}
                    title={`${row.atRisk} at risk`}
                  />
                  <div
                    className={cn("h-full", COMMITMENT_STATUS_STYLES.breached.fill)}
                    style={{ width: `${(row.breached / total) * 100}%` }}
                    title={`${row.breached} breached`}
                  />
                </div>
              )}
              <div className="text-outline flex items-center gap-3 font-mono text-xxs">
                <span className="flex items-center gap-1">
                  <span className={cn("size-1.5 rounded-full", COMMITMENT_STATUS_STYLES.on_track.fill)} />
                  {row.onTrack} on track
                </span>
                <span className="flex items-center gap-1">
                  <span className={cn("size-1.5 rounded-full", COMMITMENT_STATUS_STYLES.at_risk.fill)} />
                  {row.atRisk} at risk
                </span>
                <span className="flex items-center gap-1">
                  <span className={cn("size-1.5 rounded-full", COMMITMENT_STATUS_STYLES.breached.fill)} />
                  {row.breached} breached
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
