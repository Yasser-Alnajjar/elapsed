"use client";

import { useEffect, useMemo, useState } from "react";
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

  /* sorted leg segments */
  const legSegments = useMemo(
    () =>
      data.legSpans
        .flatMap((span) => {
          const start = toMs(span.startedAt);
          if (start === null) return [];
          return [{ span, start, end: toMs(span.endedAt) }];
        })
        .sort((a, b) => a.start - b.start),
    [data.legSpans],
  );

  /* index of the currently-active segment */
  const currentStageIndex = useMemo(() => {
    if (!isOpen) return -1;
    for (let i = legSegments.length - 1; i >= 0; i--) {
      if (legSegments[i]?.span.leg === data.currentLeg) return i;
    }
    return -1;
  }, [data.currentLeg, isOpen, legSegments]);

  /* timeline domain */
  const latestStoredEnd = useMemo(
    () =>
      Math.max(
        openedAt,
        ...legSegments.map((s) => s.end ?? s.start),
        ...data.runningIntervals.map((i) => toMs(i.end) ?? 0),
        ...data.pausedIntervals.map((i) => toMs(i.end) ?? 0),
      ),
    [openedAt, legSegments, data.runningIntervals, data.pausedIntervals],
  );

  const timelineEnd = isOpen
    ? Math.max(now, latestStoredEnd)
    : Math.max(closedAt ?? latestStoredEnd, latestStoredEnd);
  const timelineSpan = Math.max(1, timelineEnd - openedAt);

  /* live leg totals */
  const liveLegTotals = useMemo(() => {
    if (!isOpen || currentStageIndex < 0) return data.legTotals;
    const currentLegName = legSegments[currentStageIndex]?.span.leg;
    const extra = Math.max(0, (now - snapshotAt) / 60_000);
    return data.legTotals.map((t) =>
      t.leg === currentLegName ? { ...t, minutes: t.minutes + extra } : t,
    );
  }, [data.legTotals, isOpen, currentStageIndex, legSegments, now, snapshotAt]);

  const totalLegMinutes = liveLegTotals.reduce((s, t) => s + t.minutes, 0);

  const minutesByLeg = useMemo(
    () => new Map(liveLegTotals.map((t) => [t.leg, t.minutes])),
    [liveLegTotals],
  );

  /* live SLA elapsed */
  const liveSlaSeconds = useMemo(
    () =>
      data.runningIntervals.reduce((total, interval, i) => {
        const start = toMs(interval.start);
        if (start === null) return total;
        const storedEnd = toMs(interval.end);
        const isLast = i === data.runningIntervals.length - 1;
        const end =
          isOpen && isLast
            ? Math.max(storedEnd ?? now, now)
            : (storedEnd ?? start);
        if (end <= start) return total;
        return total + (end - start) / 1000;
      }, 0),
    [data.runningIntervals, isOpen, now],
  );

  /* first handoff timestamp */
  const firstHandoffAt = legSegments.length > 1 ? legSegments[1]!.start : null;

  /* dominant leg for attribution finding */
  const dominantLeg = useMemo(() => {
    if (totalLegMinutes <= 0) return null;
    return [...liveLegTotals].sort((a, b) => b.minutes - a.minutes)[0] ?? null;
  }, [liveLegTotals, totalLegMinutes]);

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
