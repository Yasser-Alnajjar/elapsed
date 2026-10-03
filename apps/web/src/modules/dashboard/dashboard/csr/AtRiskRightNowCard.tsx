import Link from "next/link";
import { Gauge } from "lucide-react";
import {
  DataTableCard,
  DataTableFooter,
} from "@/components/shared/data-table/data-table-card";
import { DataTableEmpty } from "@/components/shared/data-table/data-table-states";
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
    <DataTableCard id="at-risk-table" className="scroll-mt-20">
      <div className="flex flex-col items-start justify-between gap-2 border-b border-border p-4 sm:flex-row sm:items-center">
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
        <DataTableEmpty
          icon={Gauge}
          title="Nothing at risk right now"
          description="No open commitments are projected to breach soon."
        />
      ) : (
        <AtRiskSnapshotTable
          rows={rows}
          engineeringMeasured={engineeringMeasured}
        />
      )}
      {overflowCount > 0 && (
        <DataTableFooter>
          <span>
            +{overflowCount} more open commitment(s) not shown —{" "}
            <Link href="/cases" className="text-primary hover:underline">
              see full case list
            </Link>
            .
          </span>
        </DataTableFooter>
      )}
    </DataTableCard>
  );
}
