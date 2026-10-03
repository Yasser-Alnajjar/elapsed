"use client";

import { Calculator } from "lucide-react";

import { formatMinutes, formatPolicyMatch } from "@/lib/format";
import type { CaseDetailData, CommitmentDetail } from "@/lib/types/cases";
import { pickHeroCommitment } from "./CaseRunwayHero";
import { useLiveRemaining } from "./useLiveRemaining";
import { LedgerTable } from "./ledger/LedgerTable";
import { computeLedger } from "./ledger/ledger-math";
import { AppliedClauses, PolicyCalendarCards } from "./ledger/PolicyTerms";

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

  const figures = computeLedger(commitment, data.asOf, remainingSeconds);

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

      <PolicyCalendarCards commitment={commitment} />

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

      <LedgerTable commitment={commitment} figures={figures} />

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
