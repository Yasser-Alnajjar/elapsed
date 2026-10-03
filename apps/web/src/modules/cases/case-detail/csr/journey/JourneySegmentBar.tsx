"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime, formatLeg, formatMinutes } from "@/lib/format";
import type { CaseDetailData } from "@/lib/types/cases";
import { legStyle } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { segmentGeometry } from "./journey-geometry";
import type { CaseJourneyState } from "./useCaseJourney";

/** The flagship segmented leg bar, with clock-start / handoff / end captions under it. */
export function JourneySegmentBar({
  data,
  journey,
}: {
  data: CaseDetailData;
  journey: CaseJourneyState;
}) {
  const {
    isOpen,
    now,
    openedAt,
    timelineSpan,
    legSegments,
    currentStageIndex,
    totalLegMinutes,
    firstHandoffAt,
  } = journey;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-8 w-full overflow-hidden rounded-lg bg-surface-container p-1 flex gap-1">
        {legSegments.map(({ span, start, end }, index) => {
          const isCurrent = isOpen && index === currentStageIndex;
          const visualEnd = isCurrent
            ? Math.max(end ?? now, now)
            : (end ?? start);
          const { leftPct, widthPct } = segmentGeometry(
            start,
            visualEnd,
            openedAt,
            timelineSpan,
          );
          const segMinutes = Math.max(0, (visualEnd - start) / 60_000);
          const showLabel = widthPct >= 12;

          return (
            <Tooltip key={`${span.leg}-${index}`}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "absolute inset-y-1 flex items-center overflow-hidden whitespace-nowrap rounded px-2 transition-[filter] hover:brightness-110 cursor-pointer",
                    legStyle(span.leg).fill,
                  )}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                >
                  {showLabel && (
                    <span
                      className={cn(
                        "font-mono text-xxs font-semibold truncate",
                        legStyle(span.leg).onFill,
                      )}
                    >
                      {formatLeg(span.leg)} {formatMinutes(segMinutes)}
                      {totalLegMinutes > 0 &&
                        ` (${((segMinutes / totalLegMinutes) * 100).toFixed(1)}%)`}
                      {isCurrent && (
                        <span className="ms-2 inline-flex items-center gap-1">
                          <span className="size-1.5 animate-pulse rounded-full bg-current opacity-80" />
                          RUNNING NOW
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {formatLeg(span.leg)} · {formatDateTime(span.startedAt)} –{" "}
                {isCurrent
                  ? "Now"
                  : end !== null
                    ? formatDateTime(span.endedAt)
                    : "Now"}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex flex-col items-start md:flex-row md:items-center justify-between px-1 font-mono text-xxs text-outline">
        <span>{formatDateTime(data.case.openedAt)} · Clock Start</span>
        {firstHandoffAt && (
          <span className="text-primary">
            {formatDateTime(new Date(firstHandoffAt).toISOString())} · Handoff
          </span>
        )}
        <span
          className={cn(
            isOpen && !firstHandoffAt ? "text-error font-medium" : "",
          )}
        >
          {isOpen ? "Now" : formatDateTime(data.case.closedAt ?? data.asOf)}
        </span>
      </div>
    </div>
  );
}
