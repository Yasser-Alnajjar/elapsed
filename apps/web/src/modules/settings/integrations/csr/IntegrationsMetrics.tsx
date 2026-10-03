import { Coins, Hourglass, Radio, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** The four ingestion headline tiles above the provider cards. */
export function IntegrationsMetrics({
  connectedCount,
}: {
  connectedCount: number;
}) {
  const metrics = [
    {
      label: "Streaming ingress",
      value: `${connectedCount} Connectors`,
      hint: "100% deterministic SLA fidelity",
      hintTone: "text-success",
      icon: <Radio className="text-success size-4" />,
      tone: "text-on-surface",
    },
    {
      label: "24h event ingestion",
      value: "41,894 evts",
      hint: "Mean transit lag: 142ms",
      hintTone: "text-on-surface-variant",
      icon: <Coins className="text-primary size-4" />,
      tone: "text-on-surface",
    },
    {
      label: "Unattributed limbo",
      value: "14 Issues",
      hint: "Jira handoff gap > 30m",
      hintTone: "text-on-surface-variant",
      icon: <Hourglass className="text-warning size-4" />,
      tone: "text-warning",
    },
    {
      label: "Encrypted at rest",
      value: "AES-256-GCM",
      hint: "Rotated automatically 6h ago",
      hintTone: "text-on-surface-variant",
      icon: <ShieldCheck className="text-secondary size-4" />,
      tone: "text-on-surface",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="bg-surface-container-low flex flex-col gap-1 rounded-xl p-4 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-outline font-mono text-xxs uppercase">
              {metric.label}
            </span>
            {metric.icon}
          </div>
          <span
            className={cn(
              "truncate font-mono text-lg font-bold tracking-tight",
              metric.tone,
            )}
          >
            {metric.value}
          </span>
          <span className={cn("truncate text-xs", metric.hintTone)}>
            {metric.hint}
          </span>
        </div>
      ))}
    </div>
  );
}
