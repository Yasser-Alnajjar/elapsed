import type { ReactNode } from "react";
import { CircleAlert, Flame, Timer } from "lucide-react";
import { CountdownClock } from "@/components/shared/countdown-clock";
import { TimeAllocationBar } from "@/components/shared/time-allocation-bar";
import {
  formatCommitmentKind,
  formatLeg,
  formatLinkedSystemShort,
  formatMinutes,
} from "@/lib/format";
import type { CommitmentStatusStyle } from "@/lib/status-styles";
import type { AtRiskRowData } from "@/lib/types/at-risk";
import { cn } from "@/lib/utils";
import { timeAllocation } from "./allocation";

/** "Leg: <minutes> (n%)", the minutes tinted when that leg is the current one. */
function LegShare({
  label,
  minutes,
  percent,
  valueClass,
}: {
  label: ReactNode;
  minutes: number;
  percent: number;
  valueClass: string;
}) {
  return (
    <span>
      {label}:{" "}
      <strong className={cn("font-mono", valueClass)}>
        {formatMinutes(minutes)}
      </strong>{" "}
      ({percent.toFixed(1)}%)
    </span>
  );
}

/** Elapsed vs. target, the per-leg split, the allocation bar, and where the case sits now. */
export function TimeAllocationPanel({
  row,
  statusStyle,
  isCritical,
  currentLegTone,
}: {
  row: AtRiskRowData;
  statusStyle: CommitmentStatusStyle;
  isCritical: boolean;
  currentLegTone: string;
}) {
  const {
    elapsedMinutes,
    elapsedPercent,
    supportPercent,
    engineeringPercent,
    waitingCustomerPercent,
  } = timeAllocation(row);

  const legValueClass = (leg: AtRiskRowData["currentLeg"]) =>
    row.currentLeg === leg ? currentLegTone : "text-foreground";

  return (
    <div className="flex flex-col gap-2 rounded bg-surface-container-lowest/80 p-3 font-mono">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-1.5 text-xxs font-medium uppercase tracking-wider">
          {isCritical ? (
            <Flame className={cn("size-3.5", statusStyle.counter)} />
          ) : (
            <Timer className="size-3.5 text-muted-foreground" />
          )}

          <span className="text-foreground">
            Time Allocation: Elapsed {formatMinutes(elapsedMinutes)} of{" "}
            {formatMinutes(row.targetMinutes)} Target (
            {elapsedPercent.toFixed(1)}% Expended)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xxs text-muted-foreground">
          <LegShare
            label="Support Leg"
            minutes={row.supportLegMinutes}
            percent={supportPercent}
            valueClass="text-foreground"
          />

          <LegShare
            label="Eng Leg"
            minutes={row.engineeringLegMinutes}
            percent={engineeringPercent}
            valueClass={legValueClass("engineering")}
          />

          <LegShare
            label="Pending Customer"
            minutes={row.waitingCustomerLegMinutes}
            percent={waitingCustomerPercent}
            valueClass={legValueClass("waiting_customer")}
          />

          <span>
            Runway:{" "}
            <strong className={cn("font-mono", statusStyle.counter)}>
              <CountdownClock
                remainingMinutes={row.remainingMinutes}
                className="inline font-mono text-xs font-semibold"
              />
            </strong>
          </span>
        </div>
      </div>

      <TimeAllocationBar
        targetMinutes={row.targetMinutes}
        elapsedMinutes={elapsedMinutes}
        remainingMinutes={row.remainingMinutes}
        supportLegMinutes={row.supportLegMinutes}
        engineeringLegMinutes={row.engineeringLegMinutes}
        waitingCustomerLegMinutes={row.waitingCustomerLegMinutes}
      />

      <div className="flex flex-col gap-2 pt-1 text-xxs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
          <CircleAlert
            className={cn("mt-0.5 size-3.5 shrink-0", currentLegTone)}
          />

          <span className="truncate">
            Locus:{" "}
            <strong className={cn("font-semibold", currentLegTone)}>
              {formatLeg(row.currentLeg)} Active
            </strong>{" "}
            {row.linkedIssue && (
              <>
                — {formatLinkedSystemShort(row.linkedIssue.system)}-
                {row.linkedIssue.externalId}
              </>
            )}{" "}
            ·{" "}
            <span className="text-foreground">
              {formatMinutes(row.minutesInCurrentLeg)} in queue
            </span>
          </span>
        </div>

        <span className="shrink-0 font-medium uppercase tracking-wider text-muted-foreground">
          {formatCommitmentKind(row.kind)} Target
        </span>
      </div>
    </div>
  );
}
