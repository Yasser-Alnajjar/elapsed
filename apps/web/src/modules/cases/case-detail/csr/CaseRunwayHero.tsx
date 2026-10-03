"use client";

import {
  formatClockDigits,
  formatCommitmentKind,
  formatLeg,
} from "@/lib/format";
import type { CommitmentDetail } from "@/lib/types/cases";
import type { Leg } from "@sla/core";
import { commitmentStatusStyle } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { useLiveRemaining } from "./useLiveRemaining";

const STATUS_PRECEDENCE = ["breached", "at_risk", "on_track"] as const;

export function pickHeroCommitment(
  commitments: CommitmentDetail[],
): CommitmentDetail | null {
  const open = commitments.filter((c) => c.closedAt === null);
  if (open.length === 0) return null;
  return (
    [...open].sort(
      (a, b) =>
        STATUS_PRECEDENCE.indexOf(
          a.status as (typeof STATUS_PRECEDENCE)[number],
        ) -
        STATUS_PRECEDENCE.indexOf(
          b.status as (typeof STATUS_PRECEDENCE)[number],
        ),
    )[0] ?? null
  );
}

export function CaseRunwayHero({
  commitment,
  currentLeg,
  linkedIssueLabel,
}: {
  commitment: CommitmentDetail;
  currentLeg: Leg;
  linkedIssueLabel: string | null;
}) {
  const remainingSeconds = useLiveRemaining(commitment);

  const { fill: dot, counter } = commitmentStatusStyle(commitment.status);
  const overdue = remainingSeconds < 0;

  return (
    <div className="flex min-w-70 flex-col items-start rounded-lg bg-surface-container p-4 lg:items-end">
      <div className="flex items-center gap-2">
        <span className="relative flex size-3">
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-75",
              dot,
            )}
          />
          <span
            className={cn("relative inline-flex size-3 rounded-full", dot)}
          />
        </span>
        <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-primary">
          Clock Active in {formatLeg(currentLeg)}
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className={cn("font-mono text-3xl font-medium tabular-nums", counter)}
        >
          {formatClockDigits(remainingSeconds)}
        </span>
        <span className="text-sm text-outline">
          {overdue ? "overdue" : "runway remaining"}
        </span>
      </div>

      <span className="mt-1 font-mono text-xxs text-muted-foreground">
        {formatCommitmentKind(commitment.kind)}
      </span>

      {linkedIssueLabel && (
        <span className="font-mono text-xs leading-4 text-muted-foreground">
          Active leg: {formatLeg(currentLeg)} ({linkedIssueLabel})
        </span>
      )}
    </div>
  );
}
