import { formatDateTimeWithOffset, formatSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CommitmentDetail } from "@/lib/types/cases";
import type { LedgerFigures } from "./ledger-math";

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

/** Gross → excluded → net elapsed → target → runway, one row per step. */
export function LedgerTable({
  commitment,
  figures,
}: {
  commitment: CommitmentDetail;
  figures: LedgerFigures;
}) {
  const {
    isClosed,
    grossSeconds,
    excludedSeconds,
    liveElapsed,
    targetSeconds,
    runwayVariant,
    runwayLabel,
    runwayValue,
  } = figures;

  return (
    <div className="overflow-hidden rounded-lg bg-surface-container">
      <div className="flex items-center justify-between bg-surface-container-high px-3 py-2 font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
        <span>Step / Interval Calculation Ledger</span>
        <span>Duration Applied</span>
      </div>

      <LedgerRow
        label="1. Gross Wall-Clock Time"
        sublabel={`From ${formatDateTimeWithOffset(commitment.startedAt)} to ${
          isClosed ? formatDateTimeWithOffset(commitment.closedAt!) : "now"
        }`}
        value={formatSeconds(grossSeconds)}
      />

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

      <LedgerRow
        variant="subtotal"
        label="Net SLA Elapsed Time"
        sublabel="Deterministic billable SLA duration"
        value={formatSeconds(liveElapsed)}
      />

      <LedgerRow
        variant="target"
        label="Target Allotment"
        sublabel={commitment.policyVersion.name}
        value={formatSeconds(targetSeconds)}
      />

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
  );
}
