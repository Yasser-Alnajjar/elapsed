import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Stitch's "Time Allocation" widget: how much of the commitment's target
 * has been consumed so far, and how the consumed time splits between the
 * support, engineering, and waiting-customer legs.
 *
 * `elapsedMinutes` positions the bar against `targetMinutes`, while the
 * three leg values split the filled portion by their cumulative wall-clock
 * leg time from `sumLegMinutes`.
 */
export function TimeAllocationBar({
  targetMinutes,
  elapsedMinutes,
  remainingMinutes,
  supportLegMinutes,
  engineeringLegMinutes,
  waitingCustomerLegMinutes,
}: {
  targetMinutes: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  supportLegMinutes: number;
  engineeringLegMinutes: number;
  waitingCustomerLegMinutes: number;
}) {
  const percentExpended =
    targetMinutes > 0
      ? Math.min(100, (elapsedMinutes / targetMinutes) * 100)
      : 0;

  const legs = [
    { label: "Support", minutes: supportLegMinutes, color: "bg-leg-support" },
    { label: "Eng", minutes: engineeringLegMinutes, color: "bg-leg-engineering" },
    { label: "Pending Customer", minutes: waitingCustomerLegMinutes, color: "bg-leg-waiting" },
  ];
  const legTotal = legs.reduce((sum, leg) => sum + leg.minutes, 0);
  const shareOf = (minutes: number) =>
    legTotal > 0 ? (minutes / legTotal) * 100 : 0;

  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">
        Time allocation:{" "}
        <span className="font-mono tabular-nums text-foreground">
          {formatMinutes(elapsedMinutes)}
        </span>{" "}
        of{" "}
        <span className="font-mono tabular-nums text-foreground">
          {formatMinutes(targetMinutes)}
        </span>{" "}
        target ({percentExpended.toFixed(1)}% expended)
      </p>

      <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-interactive">
        {legs.map((leg) => (
          <div
            key={leg.label}
            className={cn("h-full", leg.color)}
            style={{ width: `${(percentExpended * shareOf(leg.minutes)) / 100}%` }}
          />
        ))}
      </div>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xxs text-muted-foreground">
        {legs.map((leg) => (
          <span key={leg.label} className="inline-flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", leg.color)} />
            {leg.label}:{" "}
            <span className="font-mono tabular-nums">
              {formatMinutes(leg.minutes)}
            </span>{" "}
            ({shareOf(leg.minutes).toFixed(0)}%)
          </span>
        ))}

        <span>
          Runway:{" "}
          <span className="font-mono tabular-nums">
            {formatMinutes(remainingMinutes)}
          </span>
        </span>
      </p>
    </div>
  );
}
