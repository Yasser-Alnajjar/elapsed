import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricTileProps {
  icon: LucideIcon;
  label: string;
  value: number;
  caption: string;
  tone?: "error" | "tertiary" | "muted";
  spin?: boolean;
}

export function MetricTile({
  icon: Icon,
  label,
  value,
  caption,
  tone,
  spin,
}: MetricTileProps) {
  const text =
    tone === "error"
      ? "text-error"
      : tone === "tertiary"
        ? "text-tertiary"
        : "text-on-surface-variant";

  const iconColor =
    tone === "error"
      ? "text-error"
      : tone === "tertiary"
        ? "text-tertiary"
        : "text-primary";

  return (
    <div className="flex min-w-0 flex-col justify-between rounded bg-surface-container-low p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "font-mono text-xxs font-semibold tracking-wider",
            text,
          )}
        >
          {label}
        </span>

        <Icon
          className={cn(
            "size-4.5",
            iconColor,
            spin && "animate-spin animation-duration-[9s]",
          )}
        />
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-1">
        <span
          className={cn(
            "font-mono text-2xl font-medium tracking-tight",
            tone ? text : "text-on-surface",
          )}
        >
          {value}
        </span>

        <span className="font-mono text-xs text-on-surface-variant">
          {caption}
        </span>
      </div>
    </div>
  );
}

interface CaseListMetricsProps {
  total: number;
  open: number;
  runningClock: number;
  linkedCertain: number;
  linked: number;
}

export function CaseListMetrics({
  total,
  open,
  runningClock,
  linkedCertain,
  linked,
}: CaseListMetricsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <MetricTile
        icon={require("lucide-react").Inbox}
        label="TOTAL TRACKED CASES"
        value={total}
        caption={`${open} open`}
      />

      <MetricTile
        icon={require("lucide-react").Gauge}
        label="ACTIVE RUNNING SLA CLOCK"
        value={runningClock}
        caption="burning now"
        tone="error"
        spin={runningClock > 0}
      />

      <MetricTile
        icon={require("lucide-react").Link2}
        label="LINKED — CERTAIN"
        value={linkedCertain}
        caption={`${((linkedCertain / total) * 100).toFixed(1)}% deterministic`}
        tone="tertiary"
      />

      <MetricTile
        icon={require("lucide-react").Unlink}
        label="STANDALONE / UNLINKED"
        value={total - linked}
        caption="support-only"
        tone="muted"
      />
    </div>
  );
}
