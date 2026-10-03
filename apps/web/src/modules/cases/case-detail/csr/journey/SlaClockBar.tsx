import type { CaseDetailData } from "@/lib/types/cases";
import { formatLiveDuration, segStyle, toMs } from "./journey-geometry";
import type { CaseJourneyState } from "./useCaseJourney";

/** Running vs. paused SLA-clock intervals on the same time axis as the leg bar. */
export function SlaClockBar({
  data,
  journey,
}: {
  data: CaseDetailData;
  journey: CaseJourneyState;
}) {
  const { isOpen, now, openedAt, timelineSpan, liveSlaSeconds } = journey;

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-on-surface">SLA clock</span>
          <span className="font-mono tabular-nums text-on-surface">
            {formatLiveDuration(liveSlaSeconds)}
          </span>
        </div>
        <div className="flex items-center gap-4 text-outline">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-clock-running" /> Running
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-clock-paused" /> Paused
          </span>
        </div>
      </div>

      <div className="relative mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-container">
        {data.runningIntervals.map((interval, i) => {
          const start = toMs(interval.start);
          if (start === null) return null;
          const storedEnd = toMs(interval.end);
          const isLast = i === data.runningIntervals.length - 1;
          const vEnd =
            isOpen && isLast
              ? Math.max(storedEnd ?? now, now)
              : (storedEnd ?? start);
          return (
            <div
              key={`r-${i}`}
              className="absolute inset-y-0 bg-clock-running"
              style={segStyle(start, vEnd, openedAt, timelineSpan)}
            />
          );
        })}
        {data.pausedIntervals.map((interval, i) => {
          const start = toMs(interval.start);
          const storedEnd = toMs(interval.end);
          if (start === null) return null;
          const isLast = i === data.pausedIntervals.length - 1;
          const isCurrPause =
            isOpen && isLast && data.currentLeg === "waiting_customer";
          const vEnd = isCurrPause
            ? Math.max(storedEnd ?? now, now)
            : (storedEnd ?? start);
          return (
            <div
              key={`p-${i}`}
              className="absolute inset-y-0 bg-clock-paused"
              style={segStyle(start, vEnd, openedAt, timelineSpan)}
            />
          );
        })}
      </div>
    </div>
  );
}
