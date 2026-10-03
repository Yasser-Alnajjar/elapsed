import type { CommitmentStatus, Leg } from "@sla/core";
import type { WorkerStatus } from "./types/worker-settings";
import { AlertTriangle, CheckCircle2, type LucideIcon } from "lucide-react";
import type { PriorityTier } from "./format";

/**
 * How every status-like value looks, in one place. Each class resolves to a
 * semantic token in styles/colors.css (`status-*`, `priority-*`, `leg-*`,
 * success/warning/danger), so a hue is changed there and a value's styling
 * here, never in a component. Labels stay in lib/format.ts.
 *
 * Classes are spelled out in full, not built from the key: Tailwind only
 * generates classes it can see as literal strings.
 */

/* ─── Generic tone: health, connection state, admin console ──── */

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning-text",
  danger: "text-error",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-foreground-subtle",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-error",
};

/** Bordered, tinted chip surface. */
export const TONE_SURFACE: Record<Tone, string> = {
  neutral: "border-border bg-surface-raised text-muted-foreground",
  primary: "border-primary/30 bg-primary/10 text-primary",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/35 bg-warning/10 text-warning-text",
  danger: "border-error/35 bg-error/10 text-error",
};

export const WORKER_STATUS_TONE: Record<WorkerStatus, Tone> = {
  running: "success",
  degraded: "warning",
  stopped: "danger",
};

/* ─── Commitment (SLA) status ────────────────────────────────── */

export interface CommitmentStatusStyle {
  /** Status-coloured text: filter chips, inline labels, icons. */
  text: string;
  /** Solid status fill: dots, progress bars, edge stripes. */
  fill: string;
  /** Tinted label chip. On track reads as "no news", so it stays neutral. */
  chip: string;
  /** The big remaining-time counter: only tinted while the status needs attention. */
  counter: string;
  icon: LucideIcon;
}

export const COMMITMENT_STATUS_STYLES: Record<
  CommitmentStatus,
  CommitmentStatusStyle
> = {
  on_track: {
    text: "text-status-on-track",
    fill: "bg-status-on-track",
    chip: "bg-surface-container-highest text-on-surface-variant",
    counter: "text-on-surface",
    icon: CheckCircle2,
  },
  at_risk: {
    text: "text-status-at-risk",
    fill: "bg-status-at-risk",
    chip: "bg-status-at-risk/15 text-status-at-risk",
    counter: "text-status-at-risk",
    icon: AlertTriangle,
  },
  breached: {
    text: "text-status-breached",
    fill: "bg-status-breached",
    chip: "bg-status-breached/15 text-status-breached",
    counter: "text-status-breached",
    icon: AlertTriangle,
  },
  met: {
    text: "text-status-met",
    fill: "bg-status-met",
    chip: "bg-status-met/15 text-status-met",
    counter: "text-on-surface",
    icon: CheckCircle2,
  },
  cancelled: {
    text: "text-status-cancelled",
    fill: "bg-status-cancelled",
    chip: "bg-status-cancelled/15 text-status-cancelled",
    counter: "text-status-cancelled",
    icon: CheckCircle2,
  },
};

/** Style for a status that arrives as a plain string; anything unknown reads as on track. */
export function commitmentStatusStyle(status: string): CommitmentStatusStyle {
  return (
    COMMITMENT_STATUS_STYLES[status as CommitmentStatus] ??
    COMMITMENT_STATUS_STYLES.on_track
  );
}

/* ─── Ticket priority tier (P1–P4) ───────────────────────────── */

export interface PriorityTierStyle {
  text: string;
  dot: string;
  chip: string;
}

export const PRIORITY_TIER_STYLES: Record<PriorityTier, PriorityTierStyle> = {
  P1: {
    text: "text-priority-p1",
    dot: "bg-priority-p1",
    chip: "bg-priority-p1/15 text-priority-p1",
  },
  P2: {
    text: "text-priority-p2",
    dot: "bg-priority-p2",
    chip: "bg-priority-p2/15 text-priority-p2",
  },
  P3: {
    text: "text-priority-p3",
    dot: "bg-priority-p3",
    chip: "bg-priority-p3/15 text-priority-p3",
  },
  P4: {
    text: "text-priority-p4",
    dot: "bg-priority-p4",
    chip: "bg-priority-p4/15 text-priority-p4",
  },
};

/* ─── SLA leg ────────────────────────────────────────────────── */

export interface LegStyle {
  /** Solid leg fill: bars, dots, legend swatches. */
  fill: string;
  /** Legible leg-coloured text on a surface. */
  text: string;
  /** Text drawn on top of `fill`. */
  onFill: string;
  /** CSS colours for chart libraries that take a colour, not a class. */
  chartFill: string;
  chartText: string;
}

export const LEG_STYLES: Record<Leg, LegStyle> = {
  support: {
    fill: "bg-leg-support",
    text: "text-leg-support-text",
    onFill: "text-on-leg-support",
    chartFill: "var(--leg-support)",
    chartText: "var(--stage-support-text)",
  },
  engineering: {
    fill: "bg-leg-engineering",
    text: "text-leg-engineering-text",
    onFill: "text-on-leg-engineering",
    chartFill: "var(--leg-engineering)",
    chartText: "var(--stage-eng-text)",
  },
  waiting_customer: {
    fill: "bg-leg-waiting",
    text: "text-leg-waiting-text",
    onFill: "text-on-leg-waiting",
    chartFill: "var(--leg-waiting)",
    chartText: "var(--stage-waiting-text)",
  },
  unknown: {
    fill: "bg-leg-unknown",
    text: "text-leg-unknown-text",
    onFill: "text-on-leg-unknown",
    chartFill: "var(--leg-unknown)",
    chartText: "var(--stage-limbo-text)",
  },
};

/** Style for a leg that arrives as a plain string; anything unknown reads as the unknown leg. */
export function legStyle(leg: string): LegStyle {
  return LEG_STYLES[leg as Leg] ?? LEG_STYLES.unknown;
}
