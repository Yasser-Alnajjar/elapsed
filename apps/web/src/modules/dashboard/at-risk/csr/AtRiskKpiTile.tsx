import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { TONE_DOT, TONE_TEXT, type Tone } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

/** One of the At Risk page's runway-band KPI tiles, with a tone stripe on its leading edge. */
export function AtRiskKpiTile({
  icon: Icon,
  label,
  value,
  qualifier,
  detail,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  qualifier?: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="relative overflow-hidden rounded border border-border bg-card p-4">
      <div
        aria-hidden
        className={cn("absolute inset-y-0 inset-s-0 w-1", TONE_DOT[tone])}
      />

      <div className="flex items-center justify-between gap-2 ps-2">
        <span className="text-xxs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className={cn("size-3.5 shrink-0", TONE_TEXT[tone])} />
      </div>

      <p
        className={cn(
          "mt-1.5 truncate ps-2 font-mono text-2xl font-semibold tabular-nums",
          TONE_TEXT[tone],
        )}
      >
        <span>{value}</span>{" "}
        {qualifier && <span className="text-xs font-medium">{qualifier}</span>}
      </p>

      {detail && (
        <p className="mt-1 truncate ps-2 text-xs text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}
