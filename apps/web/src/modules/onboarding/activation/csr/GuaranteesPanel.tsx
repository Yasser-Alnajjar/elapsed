import type { ReactNode } from "react";
import { Hourglass, Lock, Network, type LucideIcon } from "lucide-react";
import { DESCRIPTION_CLASS } from "./constants";

function Guarantee({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-surface-container-low p-3">
      <Icon className="mt-0.5 size-[18px] text-primary shrink-0" />
      <div className="text-xs">
        <div className="font-medium text-on-surface">{title}</div>
        <div className={DESCRIPTION_CLASS}>{children}</div>
      </div>
    </div>
  );
}

/** The three product guarantees, naming the providers that are actually connected. */
export function GuaranteesPanel({
  sourceLabel,
  trackerLabel,
}: {
  sourceLabel: string;
  trackerLabel: string | null;
}) {
  return (
    <div className="flex h-full flex-col gap-4 rounded-xl bg-surface-container p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-label-caps text-label-caps uppercase tracking-wider text-on-surface-variant">
          What Elapsed guarantees from here
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Guarantee icon={Lock} title="Zero mutation">
          Read-only access — nothing is ever written back to {sourceLabel}
          {trackerLabel !== null ? ` or ${trackerLabel}` : ""}.
        </Guarantee>
        <Guarantee icon={Network} title="Deterministic correlation">
          Cases are matched via official issue links only — never fuzzy
          guesswork.
        </Guarantee>
        <Guarantee icon={Hourglass} title="Continuous SLA clock">
          The clock keeps running across support and engineering handoffs.
        </Guarantee>
      </div>
    </div>
  );
}
