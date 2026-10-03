"use client";

import { Inbox } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Reveal } from "@/components/shared/reveal";
import { nextReplyCycleNumbers } from "@/lib/format";
import type { CaseDetailData } from "@/lib/types/cases";

import { CommitmentCard } from "./CommitmentCard";

export function CommitmentSummary({
  data,
  selectedCommitmentId,
}: {
  data: CaseDetailData;
  selectedCommitmentId: string | null;
}) {
  const commitments = selectedCommitmentId
    ? data.commitments.filter(
        (commitment) => commitment.id === selectedCommitmentId,
      )
    : data.commitments;
  // Computed from the case's full commitment list, not the filtered
  // `commitments` above, so a single selected Next Reply card still shows
  // its correct cycle position among all of the case's cycles.
  const cycleNumbers = nextReplyCycleNumbers(data.commitments);
  return (
    <Reveal delay={0.1}>
      {commitments.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No SLA policy has matched this case yet"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {commitments.map((commitment) => (
            <CommitmentCard
              key={commitment.id}
              commitment={commitment}
              cycleNumber={cycleNumbers.get(commitment.id)}
            />
          ))}
        </div>
      )}
    </Reveal>
  );
}
