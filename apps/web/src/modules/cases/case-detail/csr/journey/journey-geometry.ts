import type { CSSProperties } from "react";

/* Pure time/geometry helpers for the case journey bars. */

export function formatLiveDuration(seconds: number): string {
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

export function toMs(
  v: string | number | Date | null | undefined,
): number | null {
  if (v == null) return null;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function segmentGeometry(
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

export function segStyle(
  start: number,
  end: number,
  ds: number,
  dspan: number,
): CSSProperties {
  const { leftPct, widthPct } = segmentGeometry(start, end, ds, dspan);
  return { left: `${leftPct}%`, width: `${widthPct}%` };
}
