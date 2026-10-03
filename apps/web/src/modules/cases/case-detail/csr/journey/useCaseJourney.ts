"use client";

import { useEffect, useState } from "react";
import type { CaseDetailData } from "@/lib/types/cases";
import { toMs } from "./journey-geometry";

function useNow(enabled: boolean, fallback: number) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [enabled]);
  return now ?? fallback;
}

/**
 * Everything the journey renders, derived from the server snapshot and —
 * while the case is open — advanced once a second so the current leg and
 * the SLA clock keep counting.
 */
export function useCaseJourney(data: CaseDetailData) {
  const isOpen = !data.case.closedAt;
  const openedAt = toMs(data.case.openedAt) ?? 0;
  const closedAt = toMs(data.case.closedAt);
  const snapshotAt = toMs(data.asOf) ?? openedAt;
  const now = useNow(isOpen, snapshotAt);

  const legSegments = data.legSpans
    .flatMap((span) => {
      const start = toMs(span.startedAt);
      if (start === null) return [];
      return [{ span, start, end: toMs(span.endedAt) }];
    })
    .sort((a, b) => a.start - b.start);

  let currentStageIndex = -1;
  if (isOpen) {
    for (let i = legSegments.length - 1; i >= 0; i--) {
      if (legSegments[i]?.span.leg === data.currentLeg) {
        currentStageIndex = i;
        break;
      }
    }
  }

  const latestStoredEnd = Math.max(
    openedAt,
    ...legSegments.map((s) => s.end ?? s.start),
    ...data.runningIntervals.map((i) => toMs(i.end) ?? 0),
    ...data.pausedIntervals.map((i) => toMs(i.end) ?? 0),
  );

  const timelineEnd = isOpen
    ? Math.max(now, latestStoredEnd)
    : Math.max(closedAt ?? latestStoredEnd, latestStoredEnd);
  const timelineSpan = Math.max(1, timelineEnd - openedAt);

  // The current leg keeps accruing past the snapshot while the case is open.
  const currentLegName = legSegments[currentStageIndex]?.span.leg;
  const extraMinutes = Math.max(0, (now - snapshotAt) / 60_000);
  const liveLegTotals =
    isOpen && currentStageIndex >= 0
      ? data.legTotals.map((t) =>
          t.leg === currentLegName ? { ...t, minutes: t.minutes + extraMinutes } : t,
        )
      : data.legTotals;

  const totalLegMinutes = liveLegTotals.reduce((s, t) => s + t.minutes, 0);
  const minutesByLeg = new Map(liveLegTotals.map((t) => [t.leg, t.minutes]));

  // The last running interval is still open while the case is.
  const liveSlaSeconds = data.runningIntervals.reduce((total, interval, i) => {
    const start = toMs(interval.start);
    if (start === null) return total;
    const storedEnd = toMs(interval.end);
    const isLast = i === data.runningIntervals.length - 1;
    const end =
      isOpen && isLast ? Math.max(storedEnd ?? now, now) : (storedEnd ?? start);
    if (end <= start) return total;
    return total + (end - start) / 1000;
  }, 0);

  const firstHandoffAt = legSegments.length > 1 ? legSegments[1]!.start : null;

  const dominantLeg =
    totalLegMinutes > 0
      ? ([...liveLegTotals].sort((a, b) => b.minutes - a.minutes)[0] ?? null)
      : null;

  return {
    isOpen,
    now,
    openedAt,
    timelineSpan,
    legSegments,
    currentStageIndex,
    totalLegMinutes,
    minutesByLeg,
    liveSlaSeconds,
    firstHandoffAt,
    dominantLeg,
  };
}

export type CaseJourneyState = ReturnType<typeof useCaseJourney>;
