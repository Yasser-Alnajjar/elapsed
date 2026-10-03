import { Gauge, Inbox, Link2, Unlink, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONE_TEXT = {
  error: "text-error",
  tertiary: "text-tertiary",
  muted: "text-on-surface-variant",
} as const;

interface MetricTileProps {
  icon: LucideIcon;
  label: string;
  value: number;
  caption: string;
  tone?: keyof typeof TONE_TEXT;
  spin?: boolean;
}

function MetricTile({
  icon: Icon,
  label,
  value,
  caption,
  tone,
  spin,
}: MetricTileProps) {
  const toneText = tone && TONE_TEXT[tone];

  return (
    <div className="flex min-w-0 flex-col justify-between rounded bg-surface-container-low p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "font-mono text-xxs font-semibold tracking-wider",
            toneText ?? "text-on-surface-variant",
          )}
        >
          {label}
        </span>

        <Icon
          className={cn(
            "size-4.5",
            tone === "error" || tone === "tertiary" ? toneText : "text-primary",
            spin && "animate-spin animation-duration-[9s]",
          )}
        />
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-1">
        <span
          className={cn(
            "font-mono text-2xl font-medium tracking-tight",
            toneText ?? "text-on-surface",
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
  const certainPercent = total > 0 ? (linkedCertain / total) * 100 : 0;

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <MetricTile
        icon={Inbox}
        label="TOTAL TRACKED CASES"
        value={total}
        caption={`${open} open`}
      />

      <MetricTile
        icon={Gauge}
        label="ACTIVE RUNNING SLA CLOCK"
        value={runningClock}
        caption="burning now"
        tone="error"
        spin={runningClock > 0}
      />

      <MetricTile
        icon={Link2}
        label="LINKED — CERTAIN"
        value={linkedCertain}
        caption={`${certainPercent.toFixed(1)}% deterministic`}
        tone="tertiary"
      />

      <MetricTile
        icon={Unlink}
        label="STANDALONE / UNLINKED"
        value={total - linked}
        caption="support-only"
        tone="muted"
      />
    </div>
  );
}
