import type { CommitmentDetail } from "@/lib/types/cases";
import { formatSeconds } from "@/lib/format";

export type RunwayVariant = "runway-ok" | "runway-risk";

/**
 * The ledger's arithmetic for one commitment: gross wall-clock time, the
 * time the clock did not count, net elapsed, and the runway (or overage)
 * left. `remainingSeconds` is the live, locally-ticking value, so open
 * commitments advance between server snapshots.
 */
export function computeLedger(
  commitment: CommitmentDetail,
  asOf: string,
  remainingSeconds: number,
) {
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
    : new Date(asOf).getTime() +
      (commitment.remainingSeconds - remainingSeconds) * 1000;
  const grossSeconds = Math.max(
    0,
    Math.round((referenceMs - new Date(commitment.startedAt).getTime()) / 1000),
  );
  // Gross = net elapsed + time the clock did not count (paused states,
  // outside business hours).
  const excludedSeconds = Math.max(0, grossSeconds - liveElapsed);

  const runwayVariant: RunwayVariant =
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

  return {
    targetSeconds,
    isClosed,
    liveElapsed,
    grossSeconds,
    excludedSeconds,
    runwayVariant,
    runwayLabel,
    runwayValue,
  };
}

export type LedgerFigures = ReturnType<typeof computeLedger>;
