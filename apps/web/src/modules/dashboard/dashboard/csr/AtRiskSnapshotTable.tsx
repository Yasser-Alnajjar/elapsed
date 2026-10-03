import { ArrowRightLeft } from "lucide-react";
import Link from "next/link";
import { PriorityTierChip } from "@/components/shared/priority-tier-chip";
import { StatusBadge } from "@/components/shared/status-badge";
import { caseCommitmentHref } from "@/lib/case-links";
import { formatCommitmentKind, formatMinutes } from "@/lib/format";
import { LEG_STYLES } from "@/lib/status-styles";
import type { AtRiskRow } from "@/lib/types/dashboard";
import { CountdownClock } from "@/components/shared/countdown-clock";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The Stitch dashboard's "At Risk Right Now" panel: a fixed 8-column
 * operational snapshot, not a generic sortable/paginated/searchable table —
 * this component deliberately has no such chrome. Composite cells (dual-ID
 * correlation, leg-allocation bar) instead of one scalar value per cell.
 */
export function AtRiskSnapshotTable({
  rows,
  engineeringMeasured = true,
}: {
  rows: AtRiskRow[];
  /** False without a tracker: engineering minutes are not measured, so they are not printed as a zero (N5.2). */
  engineeringMeasured?: boolean;
}) {
  console.log(rows);

  return (
    <table className="w-full text-start border-collapse">
      <thead>
        <tr className="bg-surface-container-lowest/80 text-outline border-b border-surface-container-highest/60 font-mono text-xxs font-semibold uppercase tracking-wider">
          <th className="py-3 px-4">Priority</th>
          <th className="py-3 px-4">Ticket correlation</th>
          <th className="py-3 px-4">Customer</th>
          <th className="py-3 px-4">SLA target</th>
          <th className="py-3 px-4">Health status</th>
          <th className="py-3 px-4">Leg time allocation</th>
          <th className="py-3 px-4 text-end">Time remaining</th>
          <th className="py-3 px-4 text-end">Inspect</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-surface-container-highest/40 text-sm">
        {rows.map((row) => {
          const supportMinutes = row.supportLegMinutes ?? 0;
          const engineeringMinutes = engineeringMeasured
            ? (row.engineeringLegMinutes ?? 0)
            : 0;
          const legTotal = supportMinutes + engineeringMinutes;
          const supportPercent =
            legTotal > 0 ? (supportMinutes / legTotal) * 100 : 100;
          const overdue = row.remainingMinutes < 0;

          return (
            <tr
              key={row.commitmentId}
              className="hover:bg-surface-container transition-colors"
            >
              <td className="py-3.5 px-4 whitespace-nowrap">
                <PriorityTierChip priority={row.priority}>
                  {row.priority}
                </PriorityTierChip>
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <span className="text-on-surface font-semibold">
                      #{row.externalId}
                    </span>
                    {row.linkedIssue ? (
                      <>
                        <ArrowRightLeft className="text-outline size-3" />
                        <span className="text-primary">
                          {row.linkedIssue.externalId}
                        </span>
                      </>
                    ) : (
                      <span className="text-outline">standalone</span>
                    )}
                  </div>
                  {row.subject && (
                    <span className="text-outline font-mono text-xxs">
                      {row.subject ?? "—"}
                    </span>
                  )}
                </div>
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap">
                <div className="flex flex-col">
                  <span className="text-on-surface font-medium">
                    {row.customerName ?? row.requesterName ?? "—"}
                  </span>
                  {row.tier && (
                    <span className="text-outline font-mono text-xxs">
                      {row.tier}
                    </span>
                  )}
                </div>
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap">
                <span className="text-on-surface-variant font-mono text-xs">
                  {formatCommitmentKind(row.kind)}
                  {row.targetMinutes
                    ? ` (${formatMinutes(row.targetMinutes)} max)`
                    : ""}
                </span>
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap">
                <StatusBadge status={row.status} />
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className={LEG_STYLES.support.text}>
                      Support {formatMinutes(supportMinutes)}
                    </span>
                    <span className="text-muted-foreground">•</span>
                    {engineeringMeasured ? (
                      <span
                        className={cn(
                          "font-medium",
                          LEG_STYLES.engineering.text,
                        )}
                      >
                        Eng {formatMinutes(engineeringMinutes)}
                      </span>
                    ) : (
                      <span
                        className="text-outline"
                        title="Engineering time appears once a tracker is connected"
                      >
                        Eng —
                      </span>
                    )}
                  </div>
                  <div className="bg-surface-container-highest flex h-1.5 w-32 overflow-hidden rounded-full">
                    <div
                      className={cn("h-full", LEG_STYLES.support.fill)}
                      style={{ width: `${supportPercent}%` }}
                    />
                    <div
                      className={cn("h-full", LEG_STYLES.engineering.fill)}
                      style={{ width: `${100 - supportPercent}%` }}
                    />
                  </div>
                </div>
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap text-end">
                <CountdownClock
                  remainingMinutes={row.remainingMinutes}
                  className={`text-sm font-semibold ${overdue ? "text-error" : "text-on-surface"}`}
                />
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap text-end">
                <Button
                  asChild
                  variant="surface"
                  size="chip"
                  className="rounded shadow-none"
                >
                  <Link href={caseCommitmentHref(row.caseId, row.commitmentId)}>
                    Open trace
                  </Link>
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
