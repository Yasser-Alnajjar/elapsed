import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A dedicated KPI tile for this page rather than an extension of the shared
 * `stat-tile.tsx` — this page's tiles measure runway-time-bands (Immediate
 * Threat / Elevated Risk / Active Clock Locus / Avg Transit Latency), a
 * different dimension than every other screen's status-count tiles, and
 * `stat-tile.tsx` is shared across other in-flight redesigned pages.
 */
export function AtRiskKpiTile({
  icon: Icon,
  label,
  value,
  qualifier,
  detail,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  qualifier?: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "destructive" | "warning" | "success";
}) {
  const toneBGClass = {
    destructive: "bg-error",
    warning: "bg-warning",
    success: "bg-success",
    default: "bg-muted-foreground",
  };
  const toneTextClass = {
    destructive: "text-error",
    warning: "text-warning",
    success: "text-success",
    default: "text-muted-foreground",
  };
  return (
    <div className="relative overflow-hidden rounded border border-border bg-card p-4">
      <div
        aria-hidden
        className={cn("absolute inset-y-0 inset-s-0 w-1", toneBGClass[tone])}
      />

      <div className="flex items-center justify-between gap-2 pl-2">
        <span
          className={
            "text-xxs font-medium uppercase tracking-wider text-muted-foreground"
          }
        >
          {label}
        </span>
        <Icon className={cn("size-3.5 shrink-0", toneTextClass[tone])} />
      </div>

      <p
        className={cn(
          "mt-1.5 pl-2 font-mono text-2xl truncate  font-semibold tabular-nums ",
          toneTextClass[tone],
        )}
      >
        <span>{value}</span>{" "}
        {qualifier && <span className="text-xs font-medium">{qualifier}</span>}
      </p>

      {detail && (
        <p className="mt-1 truncate pl-2 text-xs text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}
