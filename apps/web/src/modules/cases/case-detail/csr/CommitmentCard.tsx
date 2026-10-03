"use client";

import { cn } from "@/lib/utils";
import {
  formatCommitmentDeadline,
  formatCommitmentKind,
  formatCommitmentStatus,
  formatSeconds,
} from "@/lib/format";
import {
  COMMITMENT_STATUS_STYLES,
  commitmentStatusStyle,
} from "@/lib/status-styles";
import type { CommitmentDetail } from "@/lib/types/cases";
import { useLiveRemaining } from "./useLiveRemaining";

export const CommitmentCard = ({
  commitment,
  cycleNumber,
}: {
  commitment: CommitmentDetail;
  cycleNumber?: number;
}) => {
  const remainingSeconds = useLiveRemaining(commitment);

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
  const statusStyle = commitmentStatusStyle(status);
  const StatusIcon = statusStyle.icon;
  const kindLabel = `${formatCommitmentKind(commitment.kind)}${
    commitment.kind === "next_reply" && cycleNumber !== undefined
      ? ` · Cycle ${cycleNumber}`
      : ""
  }`;
  const clockChip =
    !isClosed && commitment.clockState === "paused"
      ? { label: "Paused", className: "bg-clock-paused/15 text-clock-paused" }
      : !isClosed && commitment.clockState === "running"
        ? {
            label: "Running",
            className: "bg-clock-running/15 text-clock-running",
          }
        : null;

  return (
    <div className="rounded-xl bg-surface-container-low p-4 shadow-sm">
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-1">
          <StatusIcon className={cn("size-5", statusStyle.text)} />
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
              statusStyle.chip,
            )}
          >
            {formatCommitmentStatus(status)}
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between py-2">
        <div>
          <span
            className={cn(
              "font-mono text-2xl font-medium tabular-nums leading-none",
              statusStyle.counter,
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
            statusStyle.fill,
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
        <span
          className={
            headroomSeconds >= 0
              ? COMMITMENT_STATUS_STYLES.met.text
              : COMMITMENT_STATUS_STYLES.breached.text
          }
        >
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
