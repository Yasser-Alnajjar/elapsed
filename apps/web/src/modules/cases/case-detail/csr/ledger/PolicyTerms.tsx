import { formatDateTimeWithOffset, formatWeeklyWindow } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CommitmentDetail } from "@/lib/types/cases";

/** The active policy version and the calendar model it counts time against. */
export function PolicyCalendarCards({
  commitment,
}: {
  commitment: CommitmentDetail;
}) {
  return (
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
  );
}

/* ─── "Applied Contract Clauses" prose ──────────────────────── */

export function AppliedClauses({
  commitment,
}: {
  commitment: CommitmentDetail;
}) {
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
