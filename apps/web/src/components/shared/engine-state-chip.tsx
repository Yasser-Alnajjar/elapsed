import { Network } from "lucide-react";

/** Engine-state status chip shown next to an onboarding step title — the mockups' "Engine State" readout. */
export function EngineStateChip({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-container-low p-3 shadow-sm">
      <div className="flex flex-col text-end">
        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
          {label}
        </span>
        <span className="font-mono-metric-md text-mono-metric-md text-tertiary">
          {value}
        </span>
      </div>
      <div className="flex size-8 shrink-0 items-center justify-center rounded bg-surface-container-high text-primary">
        <Network className="size-5 shrink-0" />
      </div>
    </div>
  );
}
