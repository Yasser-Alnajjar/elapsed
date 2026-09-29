"use client";

import { ChevronRight, CircleAlert, Flame, Timer } from "lucide-react";
import Link from "next/link";

import { CountdownClock } from "@/components/shared/countdown-clock";
import { TimeAllocationBar } from "@/components/shared/time-allocation-bar";
import { caseCommitmentHref } from "@/lib/case-links";
import {
  formatCommitmentKind,
  formatLeg,
  formatMinutes,
  formatPriorityTier,
} from "@/lib/format";
import type { AtRiskRowData } from "@/lib/types/at-risk";
import { cn } from "@/lib/utils";

const STATUS_EDGE: Record<string, string> = {
  breached: "bg-error",
  at_risk: "bg-warning",
  on_track: "bg-outline",
  met: "bg-success",
  cancelled: "bg-border-strong",
};

const CLOCK_TONE: Record<string, string> = {
  breached: "text-error",
  at_risk: "text-warning",
  on_track: "text-outline",
  met: "text-success",
  cancelled: "text-muted-foreground",
};

const LEG_DOT: Record<string, string> = {
  support: "bg-leg-support",
  engineering: "bg-leg-engineering",
  waiting_customer: "bg-leg-waiting",
  unknown: "bg-leg-unknown",
};

const LEG_TONE: Record<string, string> = {
  support: "text-leg-support-text",
  engineering: "text-leg-engineering-text",
  waiting_customer: "text-leg-waiting-text",
  unknown: "text-muted-foreground",
};

const LINKED_SYSTEM_LABEL: Record<string, string> = {
  jira: "ENG",
  linear: "LIN",
  github: "GH",
};

export function AtRiskCard({ row }: { row: AtRiskRowData }) {
  const href = caseCommitmentHref(row.caseId, row.commitmentId);
  const severity = formatPriorityTier(row.priority);

  const elapsedMinutes = row.elapsedSeconds / 60;

  const elapsedPercent =
    row.targetMinutes > 0
      ? Math.min((elapsedMinutes / row.targetMinutes) * 100, 100)
      : 0;

  const supportPercent =
    elapsedMinutes > 0
      ? Math.min((row.supportLegMinutes / elapsedMinutes) * 100, 100)
      : 0;

  const engineeringPercent =
    elapsedMinutes > 0
      ? Math.min((row.engineeringLegMinutes / elapsedMinutes) * 100, 100)
      : 0;

  const waitingCustomerPercent =
    elapsedMinutes > 0
      ? Math.min((row.waitingCustomerLegMinutes / elapsedMinutes) * 100, 100)
      : 0;

  const currentLegTone = LEG_TONE[row.currentLeg] ?? LEG_TONE.unknown;
  const currentLegDot = LEG_DOT[row.currentLeg] ?? LEG_DOT.unknown;

  const isCritical = row.status === "breached" || row.status === "at_risk";

  return (
    <article className="flex flex-col gap-4 rounded bg-surface-container-low p-4 font-mono transition-colors hover:bg-surface-container sm:p-5">
      {/* Identification + Countdown */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3 lg:items-center">
          <div
            aria-hidden
            className={cn(
              "w-2 shrink-0 self-stretch rounded",
              STATUS_EDGE[row.status] ?? "bg-border-strong",
            )}
          />

          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {severity && (
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-xxs font-semibold uppercase tracking-wider",
                    severity === "P1" && "bg-error/15 text-error",
                    severity === "P2" &&
                      "bg-surface-container-high text-warning",
                    severity === "P3" && "bg-tertiary/15 text-tertiary",
                    severity === "P4" &&
                      "bg-surface-container-high text-muted-foreground",
                  )}
                >
                  {severity} - {row.priority}
                </span>
              )}

              <Link
                href={href}
                className="rounded bg-surface-container-lowest px-2 py-0.5 font-mono text-xs text-primary hover:underline"
              >
                #{row.externalId}
              </Link>

              {row.linkedIssue && (
                <>
                  <span
                    aria-hidden
                    className="font-mono text-xs text-muted-foreground"
                  >
                    ↔
                  </span>

                  <span className="rounded bg-surface-container-lowest px-2 py-0.5 font-mono text-xs text-secondary">
                    {LINKED_SYSTEM_LABEL[row.linkedIssue.system] ??
                      row.linkedIssue.system.toUpperCase()}
                    -{row.linkedIssue.externalId}
                  </span>
                </>
              )}

              <span className="text-xxs font-medium uppercase tracking-wider text-muted-foreground">
                {row.tier ?? formatCommitmentKind(row.kind)}
              </span>
            </div>

            <h2 className="truncate text-sm font-semibold text-foreground">
              {row.customerName ?? "Unknown customer"}
              {row.subject && (
                <span className="font-normal text-muted-foreground">
                  {" — "}
                  {row.subject}
                </span>
              )}
            </h2>

            {row.requesterName && (
              <p className="text-xs text-muted-foreground">
                Requested by {row.requesterName}
              </p>
            )}
          </div>
        </div>

        {/* Countdown Locus Panel */}
        <div className="flex shrink-0 flex-col gap-1 rounded bg-surface-container-lowest p-3 lg:items-end">
          <div
            className={cn(
              "flex items-center gap-1.5 text-xxs font-medium uppercase tracking-wider",
              CLOCK_TONE[row.status] ?? "text-muted-foreground",
            )}
          >
            {isCritical ? (
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full",
                  STATUS_EDGE[row.status] ?? "bg-error",
                  row.status === "breached" && "animate-ping",
                )}
              />
            ) : (
              <Timer className="size-3.5" />
            )}

            <span>
              {row.status === "breached"
                ? "Overdue"
                : row.status === "at_risk"
                  ? "Burning runway"
                  : "Runway remaining"}
            </span>
          </div>

          <CountdownClock
            remainingMinutes={row.remainingMinutes}
            className={cn(
              "font-mono text-2xl font-semibold leading-none",
              CLOCK_TONE[row.status],
            )}
          />

          <span className="text-xxs text-muted-foreground">
            Ceiling: {formatMinutes(row.targetMinutes)}{" "}
            {formatCommitmentKind(row.kind)} target
          </span>
        </div>
      </div>

      {/* Time Allocation */}
      <div className="flex flex-col gap-2 rounded bg-surface-container-lowest/80 p-3 font-mono">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-1.5 text-xxs font-medium uppercase tracking-wider">
            {isCritical ? (
              <Flame
                className={cn(
                  "size-3.5",
                  CLOCK_TONE[row.status] ?? "text-muted-foreground",
                )}
              />
            ) : (
              <Timer className="size-3.5 text-muted-foreground" />
            )}

            <span className="text-foreground">
              Time Allocation: Elapsed {formatMinutes(elapsedMinutes)} of{" "}
              {formatMinutes(row.targetMinutes)} Target (
              {elapsedPercent.toFixed(1)}% Expended)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xxs text-muted-foreground">
            <span>
              Support Leg:{" "}
              <strong className="font-mono text-foreground">
                {formatMinutes(row.supportLegMinutes)}
              </strong>{" "}
              ({supportPercent.toFixed(1)}%)
            </span>

            <span>
              Eng Leg:{" "}
              <strong
                className={cn(
                  "font-mono",
                  row.currentLeg === "engineering"
                    ? currentLegTone
                    : "text-foreground",
                )}
              >
                {formatMinutes(row.engineeringLegMinutes)}
              </strong>{" "}
              ({engineeringPercent.toFixed(1)}%)
            </span>

            <span>
              Pending Customer:{" "}
              <strong
                className={cn(
                  "font-mono",
                  row.currentLeg === "waiting_customer"
                    ? currentLegTone
                    : "text-foreground",
                )}
              >
                {formatMinutes(row.waitingCustomerLegMinutes)}
              </strong>{" "}
              ({waitingCustomerPercent.toFixed(1)}%)
            </span>

            <span>
              Runway:{" "}
              <strong
                className={cn(
                  "font-mono",
                  CLOCK_TONE[row.status] ?? "text-foreground",
                )}
              >
                <CountdownClock
                  remainingMinutes={row.remainingMinutes}
                  className="inline font-mono text-xs font-semibold"
                />
              </strong>
            </span>
          </div>
        </div>

        <TimeAllocationBar
          targetMinutes={row.targetMinutes}
          elapsedMinutes={elapsedMinutes}
          remainingMinutes={row.remainingMinutes}
          supportLegMinutes={row.supportLegMinutes}
          engineeringLegMinutes={row.engineeringLegMinutes}
          waitingCustomerLegMinutes={row.waitingCustomerLegMinutes}
        />

        {/* Locus */}
        <div className="flex flex-col gap-2 pt-1 text-xxs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-1.5 text-muted-foreground">
            <CircleAlert
              className={cn("mt-0.5 size-3.5 shrink-0", currentLegTone)}
            />

            <span className="truncate">
              Locus:{" "}
              <strong className={cn("font-semibold", currentLegTone)}>
                {formatLeg(row.currentLeg)} Active
              </strong>{" "}
              {row.linkedIssue && (
                <>
                  —{" "}
                  {LINKED_SYSTEM_LABEL[row.linkedIssue.system] ??
                    row.linkedIssue.system.toUpperCase()}
                  -{row.linkedIssue.externalId}
                </>
              )}{" "}
              ·{" "}
              <span className="text-foreground">
                {formatMinutes(row.minutesInCurrentLeg)} in queue
              </span>
            </span>
          </div>

          <span className="shrink-0 font-medium uppercase tracking-wider text-muted-foreground">
            {formatCommitmentKind(row.kind)} Target
          </span>
        </div>
      </div>

      {/* Remediation / Actions */}
      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", currentLegDot)}
          />

          <span>
            Assignee: Support (
            <span className="text-foreground">
              {row.supportAssigneeName ?? "Unassigned"}
            </span>
            )
          </span>
        </div>

        <Link
          href={href}
          className="inline-flex items-center justify-center gap-1 rounded bg-primary-container px-3 py-1.5 text-xs font-medium text-on-primary transition-colors hover:bg-primary-fixed-dim"
        >
          <span>Inspect Timeline</span>
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}
