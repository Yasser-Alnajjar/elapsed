"use client";

import { useEffect, useState } from "react";

import {
  formatDateTimeWithOffset,
  formatMinutes,
  formatPolicyMatch,
  formatSeconds,
  formatWeeklyWindow,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CaseDetailData, CommitmentDetail } from "@/lib/types/cases";
import { pickHeroCommitment } from "./CaseRunwayHero";
import { Calculator } from "lucide-react";

/* ─── live remaining seconds (mirrors CommitmentCard) ────────── */

function getLiveRemainingSeconds(c: CommitmentDetail): number {
  if (c.clockState !== "running" || !c.effectiveDueAt)
    return c.remainingSeconds;
  return Math.floor((new Date(c.effectiveDueAt).getTime() - Date.now()) / 1000);
}

function useLiveRemaining(c: CommitmentDetail): number {
  const [remaining, setRemaining] = useState(c.remainingSeconds);

  useEffect(() => {
    setRemaining(getLiveRemainingSeconds(c));
    if (c.clockState !== "running" || !c.effectiveDueAt) return;
    const id = window.setInterval(
      () => setRemaining(getLiveRemainingSeconds(c)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [c.effectiveDueAt, c.clockState, c.remainingSeconds]);

  return remaining;
}

/* ─── "Applied Contract Clauses" prose ──────────────────────── */

function AppliedClauses({ commitment }: { commitment: CommitmentDetail }) {
  const pauseStates = commitment.pauseOnStates;
  const neverPauses = pauseStates.length === 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-container p-3">
      <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
        Applied Contract Clauses
      </span>

      <p className="text-sm text-on-surface-variant">
        •{" "}
        {neverPauses ? (
          <>
            <strong className="text-on-surface">
              Clock runs continuously.
            </strong>{" "}
            This commitment type does not pause for any ticket state — the
            customer-facing clock runs uninterrupted until the commitment is met
            or breached.
          </>
        ) : (
          <>
            <strong className="text-on-surface">
              Pause states:{" "}
              {pauseStates.map((s) => s.replace(/_/g, " ")).join(", ")}.
            </strong>{" "}
            When the ticket enters one of these states the SLA clock pauses.
            Internal engineering backlog or cross-team transfers{" "}
            <strong className="text-on-surface">
              do not pause the customer-facing clock
            </strong>
            .
          </>
        )}
      </p>

      {!commitment.calendar.alwaysOpen && (
        <p className="text-sm text-on-surface-variant">
          •{" "}
          <strong className="text-on-surface">
            Business-hours calendar applied.
          </strong>{" "}
          Only time within the configured business windows (
          {commitment.calendar.timezone}) counts toward elapsed SLA time.
        </p>
      )}
    </div>
  );
}

/* ─── Arithmetic ledger table ────────────────────────────────── */

function LedgerRow({
  label,
  sublabel,
  value,
  variant = "default",
}: {
  label: string;
  sublabel?: string;
  value: string;
  variant?:
    | "default"
    | "deduction"
    | "subtotal"
    | "target"
    | "runway-ok"
    | "runway-risk";
}) {
  const rowClass = {
    default: "border-b border-surface-container-high/30",
    deduction:
      "border-b border-surface-container-high/30 bg-surface-container-lowest/40",
    subtotal:
      "border-b border-surface-container-high/50 bg-surface-container-high",
    target: "bg-surface-container-highest",
    "runway-ok": "bg-tertiary-container",
    "runway-risk": "bg-error-container",
  }[variant];

  const labelClass = {
    default: "text-on-surface",
    deduction: "text-primary",
    subtotal: "text-on-surface font-semibold",
    target: "text-on-surface",
    "runway-ok":
      "text-on-tertiary-container font-semibold uppercase tracking-wide text-sm",
    "runway-risk": "text-error font-semibold uppercase tracking-wide text-sm",
  }[variant];

  const valueClass = {
    default: "text-on-surface",
    deduction: "text-primary",
    subtotal: "text-on-surface font-semibold",
    target: "text-on-surface",
    "runway-ok": "text-on-tertiary-container text-lg font-bold",
    "runway-risk": "text-error text-lg font-bold",
  }[variant];

  return (
    <div
      className={cn("flex items-center justify-between px-3 py-2.5", rowClass)}
    >
      <div className="flex flex-col gap-0.5">
        <span className={cn("text-sm", labelClass)}>{label}</span>
        {sublabel && (
          <span className="font-mono text-xxs text-outline">{sublabel}</span>
        )}
      </div>
      <span className={cn("font-mono tabular-nums", valueClass)}>{value}</span>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────── */

export function CalculationLedger({
  data,
  selectedCommitmentId,
}: {
  data: CaseDetailData;
  selectedCommitmentId: string | null;
}) {
  // The commitment the user navigated from, else the most urgent open one
  // (same priority as the hero), else the first (all closed / historical).
  const commitment =
    data.commitments.find((c) => c.id === selectedCommitmentId) ??
    pickHeroCommitment(data.commitments) ??
    data.commitments[0] ??
    null;

  const remainingSeconds = useLiveRemaining(
    commitment ?? ({} as CommitmentDetail),
  );

  if (!commitment) return null;

  const targetSeconds = commitment.targetMinutes * 60;
  const isClosed = commitment.closedAt !== null;

  // Live elapsed — extend server snapshot by local drift for open commitments
  const liveElapsed = isClosed
    ? commitment.elapsedSeconds
    : commitment.elapsedSeconds +
      (commitment.remainingSeconds - remainingSeconds);

  // Gross wall-clock from startedAt to now (or closedAt)
  const referenceMs = isClosed
    ? new Date(commitment.closedAt!).getTime()
    : new Date(data.asOf).getTime() +
      (commitment.remainingSeconds - remainingSeconds) * 1000;
  const grossSeconds = Math.max(
    0,
    Math.round((referenceMs - new Date(commitment.startedAt).getTime()) / 1000),
  );
  // Gross = net elapsed + time the clock did not count (paused states,
  // outside business hours).
  const excludedSeconds = Math.max(0, grossSeconds - liveElapsed);

  const runwayVariant: "runway-ok" | "runway-risk" =
    remainingSeconds < 0 ||
    commitment.status === "breached" ||
    commitment.status === "at_risk"
      ? "runway-risk"
      : "runway-ok";

  const runwayLabel =
    remainingSeconds >= 0 ? "Net Runway Remaining" : "Net Overage";

  const runwayValue =
    remainingSeconds >= 0
      ? formatSeconds(remainingSeconds)
      : `+${formatSeconds(-remainingSeconds)}`;

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-container-low shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="hidden md:inline text-primary text-lg leading-none" />
          <h2 className="text-xl font-semibold tracking-tight text-on-surface">
            How this was calculated
          </h2>
        </div>
        <span className="rounded bg-surface-container px-2 py-1 font-mono text-xxs text-outline">
          Policy v{commitment.policyVersion.version}
        </span>
      </div>

      {/* Policy + calendar 2-col grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col rounded-lg bg-surface-container p-3">
          <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
            Active SLA Policy
          </span>
          <span className="mt-1 text-base font-semibold text-on-surface">
            {commitment.policyVersion.name}
          </span>
          <span className="mt-0.5 font-mono text-xxs text-outline">
            Version: v{commitment.policyVersion.version} (Eff:{" "}
            {formatDateTimeWithOffset(commitment.policyVersion.effectiveFrom)})
          </span>
        </div>

        <div className="flex flex-col rounded-lg bg-surface-container p-3">
          <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
            Calendar Model
          </span>
          <span className="mt-1 text-base font-semibold text-on-surface">
            {commitment.calendar.alwaysOpen
              ? "24×7 Continuous"
              : commitment.calendar.timezone}
          </span>
          <span
            className={cn(
              "mt-0.5 font-mono text-xxs",
              commitment.calendar.alwaysOpen
                ? "text-tertiary"
                : "text-muted-foreground",
            )}
          >
            {commitment.calendar.alwaysOpen
              ? "No business hours deduction"
              : commitment.calendar.weekly.map(formatWeeklyWindow).join(", ")}
          </span>
        </div>
      </div>

      {/* Applied Contract Clauses */}
      <AppliedClauses commitment={commitment} />

      {/* Match rule */}
      <p className="font-mono text-xxs text-outline">
        Match rule:{" "}
        <span className="text-on-surface">
          {formatPolicyMatch(commitment.policyVersion.match)}
        </span>
        {commitment.targetChangeHistory.length > 0 && (
          <span className="ms-3">
            · {commitment.targetChangeHistory.length} target change
            {commitment.targetChangeHistory.length > 1 ? "s" : ""} recorded
          </span>
        )}
      </p>

      {/* Arithmetic ledger table */}
      <div className="overflow-hidden rounded-lg bg-surface-container">
        {/* Table header */}
        <div className="flex items-center justify-between bg-surface-container-high px-3 py-2 font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
          <span>Step / Interval Calculation Ledger</span>
          <span>Duration Applied</span>
        </div>

        {/* 1. Gross */}
        <LedgerRow
          label="1. Gross Wall-Clock Time"
          sublabel={`From ${formatDateTimeWithOffset(commitment.startedAt)} to ${
            isClosed ? formatDateTimeWithOffset(commitment.closedAt!) : "now"
          }`}
          value={formatSeconds(grossSeconds)}
        />

        {/* 2. Excluded time — paused states / outside business hours */}
        <LedgerRow
          variant="deduction"
          label="2. Excluded Time"
          sublabel={
            excludedSeconds > 0
              ? "Time the clock did not count (paused states / outside business hours)"
              : "Nothing excluded"
          }
          value={`−${formatSeconds(excludedSeconds)}`}
        />

        {/* Net SLA Elapsed */}
        <LedgerRow
          variant="subtotal"
          label="Net SLA Elapsed Time"
          sublabel="Deterministic billable SLA duration"
          value={formatSeconds(liveElapsed)}
        />

        {/* Target */}
        <LedgerRow
          variant="target"
          label="Target Allotment"
          sublabel={commitment.policyVersion.name}
          value={formatSeconds(targetSeconds)}
        />

        {/* Runway / overage */}
        <LedgerRow
          variant={runwayVariant}
          label={runwayLabel}
          sublabel={
            commitment.effectiveDueAt
              ? `Expected breach at ${formatDateTimeWithOffset(commitment.effectiveDueAt)}`
              : undefined
          }
          value={runwayValue}
        />
      </div>

      {/* Footer audit note */}
      <div className="flex items-center justify-between font-mono text-xxs text-outline">
        <span>
          Target: fixed at {formatMinutes(commitment.targetMinutes)} since
          commitment started.
          {commitment.targetChangeHistory.length > 0 &&
            ` ${commitment.targetChangeHistory.length} re-resolution(s) recorded.`}
        </span>
      </div>
    </div>
  );
}
