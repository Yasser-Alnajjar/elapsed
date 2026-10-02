import { TriangleAlert } from "lucide-react";
import { LINK_COVERAGE_FLAG_RATIO } from "@/lib/types/admin";
import type { LinkCoverage } from "@/lib/types/link-coverage";
import { cn } from "@/lib/utils";

/**
 * Share of cases opened in the last 30 days that have a confirmed link to an
 * engineering tracker, as a number and a thin bar. Flagged below
 * `LINK_COVERAGE_FLAG_RATIO`: that tenant cannot see where most of its
 * support work went in engineering.
 */
export function LinkCoverageMeter({
  coverage,
  className,
}: {
  coverage: LinkCoverage;
  className?: string;
}) {
  if (coverage.ratio === null) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <span className="text-foreground-subtle font-mono text-xs">—</span>
        <span className="text-foreground-subtle text-xxs">No recent cases</span>
      </div>
    );
  }

  const percent = Math.round(coverage.ratio * 100);
  const flagged = coverage.ratio < LINK_COVERAGE_FLAG_RATIO;

  return (
    <div className={cn("flex min-w-28 flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-2 font-mono text-xs">
        <span
          className={cn(
            "flex items-center gap-1 font-bold tabular-nums",
            flagged ? "text-warning-text" : "text-foreground",
          )}
        >
          {flagged && <TriangleAlert className="size-3" aria-hidden />}
          {percent}%
        </span>
        <span className="text-foreground-subtle text-xxs tabular-nums">
          {coverage.linkedCases} of {coverage.cases} linked
        </span>
      </div>
      <div
        role="meter"
        aria-label="Tracker link coverage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="bg-surface-hover h-1 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn(
            "h-full rounded-full",
            flagged ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {flagged && (
        <span className="text-warning-text text-[10px] leading-3">
          Under {Math.round(LINK_COVERAGE_FLAG_RATIO * 100)}% of recent cases
          are linked
        </span>
      )}
    </div>
  );
}
