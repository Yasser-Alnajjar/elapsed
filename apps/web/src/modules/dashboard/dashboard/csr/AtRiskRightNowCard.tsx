import Link from "next/link";
import { Gauge } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import type { DashboardData } from "@/lib/types/dashboard";
import { AtRiskSnapshotTable } from "./AtRiskSnapshotTable";

/** The dashboard's at-risk snapshot: header with a count, the table (or an empty state), and an overflow note. */
export function AtRiskRightNowCard({
  rows,
  overflowCount,
  engineeringMeasured,
}: {
  rows: DashboardData["atRisk"];
  overflowCount: number;
  engineeringMeasured: boolean;
}) {
  return (
    <div
      id="at-risk-table"
      className="bg-surface-container-low shadow-soft scroll-mt-20 overflow-hidden rounded-xl"
    >
      <div className="bg-surface-container/60 border-surface-container-highest/60 flex flex-col items-start justify-between gap-2 border-b p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="bg-warning size-3 animate-ping rounded-full shrink-0" />
          <div>
            <h2 className="text-on-surface text-base font-medium">
              At Risk Right Now
            </h2>
            <p className="text-outline text-sm">
              Cases projected to breach within 2.5 hours under current
              allocation trajectory
            </p>
          </div>
        </div>
        <span className="bg-warning/15 text-warning rounded px-2.5 py-1 font-mono text-xs font-medium">
          {rows.length} Active Escalation
          {rows.length !== 1 ? "s" : ""}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={Gauge}
            title="Nothing at risk right now"
            description="No open commitments are projected to breach soon."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <AtRiskSnapshotTable
            rows={rows}
            engineeringMeasured={engineeringMeasured}
          />
        </div>
      )}
      {overflowCount > 0 && (
        <p className="border-border-subtle bg-surface-subtle text-muted-foreground border-t px-4 py-2.5 text-xs">
          +{overflowCount} more open commitment(s) not shown —{" "}
          <Link href="/cases" className="text-primary hover:underline">
            see full case list
          </Link>
          .
        </p>
      )}
    </div>
  );
}
