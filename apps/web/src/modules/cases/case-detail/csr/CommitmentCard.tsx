"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatCommitmentDeadline,
  formatCommitmentKind,
  formatSeconds,
} from "@/lib/format";
import type { CommitmentDetail } from "@/lib/types/cases";

const getLiveRemainingSeconds = (c: CommitmentDetail): number => {
  if (c.clockState !== "running" || !c.effectiveDueAt)
    return c.remainingSeconds;
  return Math.floor((new Date(c.effectiveDueAt).getTime() - Date.now()) / 1000);
};

const STATUS_LABEL: Record<string, string> = {
  met: "Met",
  at_risk: "At risk",
  breached: "Breached",
  on_track: "On track",
  cancelled: "Cancelled",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  met: "bg-tertiary/15 text-tertiary",
  at_risk: "bg-warning/15 text-warning",
  breached: "bg-error/15 text-error",
  on_track: "bg-surface-container-highest text-on-surface-variant",
  cancelled: "bg-surface-container-highest text-on-surface-variant",
};

const STATUS_COUNTER_CLASS: Record<string, string> = {
  met: "text-on-surface",
  at_risk: "text-warning",
  breached: "text-error",
  on_track: "text-on-surface",
  cancelled: "text-on-surface-variant",
};

const STATUS_BAR_CLASS: Record<string, string> = {
  met: "bg-tertiary",
  at_risk: "bg-warning",
  breached: "bg-error",
  on_track: "bg-primary",
  cancelled: "bg-on-surface-variant",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  met: <CheckCircle2 className="size-5 text-tertiary" />,
  at_risk: <AlertTriangle className="size-5 text-warning" />,
  breached: <AlertTriangle className="size-5 text-error" />,
  on_track: <CheckCircle2 className="size-5 text-tertiary" />,
  cancelled: <CheckCircle2 className="size-5 text-outline" />,
};

export const CommitmentCard = ({
  commitment,
  cycleNumber,
}: {
  commitment: CommitmentDetail;
  cycleNumber?: number;
}) => {
  // Start from the server snapshot so SSR and first client render agree;
  // the effect below switches to the live ticking value.
  const [remainingSeconds, setRemainingSeconds] = useState(
    commitment.remainingSeconds,
  );

  useEffect(() => {
    const update = () =>
      setRemainingSeconds(getLiveRemainingSeconds(commitment));
    update();
    if (commitment.clockState !== "running" || !commitment.effectiveDueAt)
      return;
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [commitment]);

  const targetSeconds = commitment.targetMinutes * 60;
  const isClosed = commitment.closedAt !== null;
  const liveElapsedSeconds = isClosed
    ? commitment.elapsedSeconds
    : Math.max(0, targetSeconds - Math.max(0, remainingSeconds));
  const percentConsumed =
    targetSeconds > 0
      ? Math.min(100, Math.max(0, (liveElapsedSeconds / targetSeconds) * 100))
      : 0;
  const headroomSeconds = targetSeconds - liveElapsedSeconds;
  const status = commitment.status;
  const kindLabel = `${formatCommitmentKind(commitment.kind)}${
    commitment.kind === "next_reply" && cycleNumber !== undefined
      ? ` · Cycle ${cycleNumber}`
      : ""
  }`;
  const clockChip =
    !isClosed && commitment.clockState === "paused"
      ? { label: "Paused", className: "bg-warning/15 text-warning" }
      : !isClosed && commitment.clockState === "running"
        ? { label: "Running", className: "bg-primary/15 text-primary" }
        : null;

  return (
    <div className="rounded-xl bg-surface-container-low p-4 shadow-sm">
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-1">
          {STATUS_ICON[status]}
          <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
            Commitment {commitment.kind === "first_response" ? "A" : "B"} •{" "}
            {kindLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {clockChip && (
            <span
              className={cn(
                "rounded px-2 py-0.5 font-mono text-xxs font-semibold uppercase tracking-wider",
                clockChip.className,
              )}
            >
              {clockChip.label}
            </span>
          )}
          <span
            className={cn(
              "rounded px-2 py-0.5 font-mono text-xxs font-semibold uppercase tracking-wider",
              STATUS_BADGE_CLASS[status] ?? STATUS_BADGE_CLASS.on_track,
            )}
          >
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between py-2">
        <div>
          <span
            className={cn(
              "font-mono text-2xl font-medium tabular-nums leading-none",
              STATUS_COUNTER_CLASS[status] ?? "text-on-surface",
            )}
          >
            {isClosed
              ? `${formatSeconds(commitment.elapsedSeconds)} achieved`
              : `${formatSeconds(Math.max(0, remainingSeconds))} remaining`}
          </span>
        </div>
        <div className="text-end">
          <span className="block font-mono text-xxs uppercase tracking-wider text-outline">
            TARGET THRESHOLD
          </span>
          <span className="font-mono text-sm text-on-surface">
            {formatSeconds(targetSeconds)}
          </span>
        </div>
      </div>

      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-container">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            STATUS_BAR_CLASS[status] ?? STATUS_BAR_CLASS.on_track,
          )}
          style={{ width: `${percentConsumed}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-xxs text-outline">
        <span>
          {isClosed
            ? formatCommitmentDeadline(commitment)
            : `Elapsed Net: ${formatSeconds(liveElapsedSeconds)} (${percentConsumed.toFixed(1)}% consumed)`}
        </span>
        <span className={headroomSeconds >= 0 ? "text-tertiary" : "text-error"}>
          {headroomSeconds >= 0
            ? `+${formatSeconds(headroomSeconds)} headroom`
            : `Breached by ${formatSeconds(-headroomSeconds)}`}
        </span>
      </div>
      {!isClosed && (
        <p className="mt-1 font-mono text-xxs text-muted-foreground">
          {formatCommitmentDeadline(commitment)}
        </p>
      )}
    </div>
  );
};
