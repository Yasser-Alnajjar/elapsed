"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime, formatLeg, formatMinutes } from "@/lib/format";
import type { CaseDetailData } from "@/lib/types/cases";
import { cn } from "@/lib/utils";
import { CircleAlert } from "lucide-react";

/* ─── Stitch token mappings for each leg ─────────────────────── */

const LEG_BAR_CLASS: Record<string, string> = {
  support: "bg-leg-support",
  engineering: "bg-leg-engineering",
  waiting_customer: "bg-leg-waiting",
  unknown: "bg-leg-unknown",
};

const LEG_TEXT_CLASS: Record<string, string> = {
  support: "text-on-leg-support",
  engineering: "text-on-leg-engineering",
  waiting_customer: "text-on-leg-waiting",
  unknown: "text-on-leg-unknown",
};

const LEG_PCT_CLASS: Record<string, string> = {
  support: "text-primary",
  engineering: "text-leg-engineering-text",
  waiting_customer: "text-outline",
  unknown: "text-tertiary",
};

const LEG_METRIC_CLASS: Record<string, string> = {
  support: "text-on-surface",
  engineering: "text-error",
  waiting_customer: "text-on-surface-variant",
  unknown: "text-tertiary",
};

/** Fixed order — 4-metric grid always shows all 4 cells. */
const LEG_ORDER = [
  "support",
  "engineering",
  "waiting_customer",
  "unknown",
] as const;

const LEG_HEADER_CLASS: Record<string, string> = {
  support: "text-outline",
  engineering: "text-leg-engineering-text",
  waiting_customer: "text-outline",
  unknown: "text-outline",
};

const LEG_DESCRIPTIONS: Record<(typeof LEG_ORDER)[number], string> = {
  support: "Triage, reproduction, and Jira sync dispatch.",
  engineering: "Currently in engineering queue backlog.",
  waiting_customer: "No pending customer queries or blockers.",
  unknown: "Zero unmapped interval gaps across sync.",
};

/* ─── Geometry helpers ───────────────────────────────────────── */

function formatLiveDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const r = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m ${r}s`;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function toMs(v: string | number | Date | null | undefined): number | null {
  if (v == null) return null;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function segmentGeometry(
  start: number,
  end: number,
  domainStart: number,
  domainSpan: number,
  minW = 0.5,
): { leftPct: number; widthPct: number } {
  const left = clamp(((start - domainStart) / domainSpan) * 100, 0, 100);
  const right = clamp(((end - domainStart) / domainSpan) * 100, 0, 100);
  return {
    leftPct: left,
    widthPct: Math.min(100 - left, Math.max(minW, right - left)),
  };
}

function segStyle(
  start: number,
  end: number,
  ds: number,
  dspan: number,
): CSSProperties {
  const { leftPct, widthPct } = segmentGeometry(start, end, ds, dspan);
  return { left: `${leftPct}%`, width: `${widthPct}%` };
}

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

/* ─── Component ──────────────────────────────────────────────── */

export function CaseJourney({ data }: { data: CaseDetailData }) {
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

  if (legSegments.length === 0) {
    return (
      <div className="rounded-xl bg-surface-container-low p-6 shadow-sm">
        <p className="text-sm text-on-surface-variant">No journey data yet.</p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-xl bg-surface-container-low p-6 shadow-sm">
      {/* Title row + legend */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-primary">
            Deterministic Time Split
          </span>
          <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-on-surface">
            Segmented Case Journey &amp; Queue Attribution
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-outline">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded bg-leg-support" />
            Support Leg
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded bg-leg-engineering" />
            Engineering Leg
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded bg-surface-variant" />
            Maintenance (Excluded)
          </span>
        </div>
      </div>

      {/* ── Flagship segmented bar ── */}
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
                      LEG_BAR_CLASS[span.leg] ?? "bg-outline",
                    )}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  >
                    {showLabel && (
                      <span
                        className={cn(
                          "font-mono text-xxs font-semibold truncate",
                          LEG_TEXT_CLASS[span.leg] ?? "text-on-leg-unknown",
                        )}
                      >
                        {formatLeg(span.leg)} {formatMinutes(segMinutes)}
                        {totalLegMinutes > 0 &&
                          ` (${((segMinutes / totalLegMinutes) * 100).toFixed(1)}%)`}
                        {isCurrent && (
                          <span className="ml-2 inline-flex items-center gap-1">
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

        {/* Axis captions */}
        <div className="flex items-center justify-between px-1 font-mono text-xxs text-outline">
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

      {/* ── 4-metric grid ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {LEG_ORDER.map((leg) => {
          const minutes = minutesByLeg.get(leg) ?? 0;
          const pct =
            totalLegMinutes > 0 ? (minutes / totalLegMinutes) * 100 : 0;
          const isCurr = isOpen && leg === data.currentLeg;

          return (
            <div
              key={leg}
              className="flex flex-col rounded-lg bg-surface-container p-3"
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "font-mono text-xxs font-semibold uppercase tracking-wider",
                    LEG_HEADER_CLASS[leg],
                  )}
                >
                  {formatLeg(leg)}
                </span>
                {isCurr && (
                  <span className="size-2 animate-pulse rounded-full bg-error" />
                )}
              </div>
              <span
                className={cn(
                  "mt-1 font-mono text-lg font-semibold tabular-nums",
                  LEG_METRIC_CLASS[leg],
                )}
              >
                {formatLiveDuration(minutes * 60)}
              </span>
              <span
                className={cn("font-mono text-xxs mt-1", LEG_PCT_CLASS[leg])}
              >
                {pct.toFixed(1)}% of Net Elapsed
              </span>
              <span className="mt-1 text-xxs text-outline">
                {LEG_DESCRIPTIONS[leg]}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Attribution finding ── */}
      {dominantLeg && dominantLeg.minutes > 0 && (
        <div className="flex items-start md:items-center gap-3 rounded-lg bg-surface-container-high p-3 text-sm text-on-surface">
          {/* <span className="mt-0.5 text-primary text-base">ℹ</span> */}
          <CircleAlert
            size="14"
            className="mt-1 md:mt-0 text-primary text-base shrink-0"
          />
          <p>
            <strong className="font-medium text-primary">
              Attribution Finding:{" "}
            </strong>
            {((dominantLeg.minutes / totalLegMinutes) * 100).toFixed(1)}% of
            this case&apos;s total elapsed SLA window has accrued while under{" "}
            <strong className="text-on-surface">
              {formatLeg(dominantLeg.leg)}
            </strong>{" "}
            care. SLA clock has been running for{" "}
            <strong className="text-on-surface">
              {formatLiveDuration(liveSlaSeconds)}
            </strong>{" "}
            net.
          </p>
        </div>
      )}

      {/* ── SLA clock bar ── */}
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
    </div>
  );
}
