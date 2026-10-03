import { Timer } from "lucide-react";
import { CountdownClock } from "@/components/shared/countdown-clock";
import { formatCommitmentKind, formatMinutes } from "@/lib/format";
import type { CommitmentStatusStyle } from "@/lib/status-styles";
import type { AtRiskRowData } from "@/lib/types/at-risk";
import { cn } from "@/lib/utils";

/** The big runway countdown with its status caption and the target ceiling. */
export function RunwayCountdown({
  row,
  statusStyle,
  isCritical,
}: {
  row: AtRiskRowData;
  statusStyle: CommitmentStatusStyle;
  isCritical: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1 rounded bg-surface-container-lowest p-3 lg:items-end">
      <div
        className={cn(
          "flex items-center gap-1.5 text-xxs font-medium uppercase tracking-wider",
          statusStyle.counter,
        )}
      >
        {isCritical ? (
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              statusStyle.fill,
              row.status === "breached" && "animate-ping",
            )}
          />
        ) : (
          <Timer className="size-3.5" />
        )}

        <span>
          {row.status === "breached"
            ? "Overdue"
            : row.status === "at_risk"
              ? "Burning runway"
              : "Runway remaining"}
        </span>
      </div>

      <CountdownClock
        remainingMinutes={row.remainingMinutes}
        className={cn(
          "font-mono text-2xl font-semibold leading-none",
          statusStyle.counter,
        )}
      />

      <span className="text-xxs text-muted-foreground">
        Ceiling: {formatMinutes(row.targetMinutes)}{" "}
        {formatCommitmentKind(row.kind)} target
      </span>
    </div>
  );
}
