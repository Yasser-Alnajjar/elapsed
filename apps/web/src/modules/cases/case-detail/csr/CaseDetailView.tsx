"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";

import type { CaseDetailData } from "@/lib/types/cases";

import { ActivityTimeline } from "./ActivityTimeline";
import { CaseHeader } from "./CaseHeader";
import { CaseJourney } from "./CaseJourney";
import { CommitmentSummary } from "./CommitmentSummary";
import { LinkedRecords } from "./LinkedRecords";
import { ConversationThread } from "./ConversationThread";
import { CalculationLedger } from "./CalculationLedger";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatExactTimestamp } from "@/lib/format";

/**
 * Keeps the URL's `commitmentId` pointed at the case's active Next Reply
 * cycle when the server-side poll advances it.
 */
function useNextReplyCycleSync(
  commitments: CaseDetailData["commitments"],
  selectedCommitmentId: string | null,
): void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selected = commitments.find((c) => c.id === selectedCommitmentId);
  const activeNextReply = commitments.find(
    (c) => c.kind === "next_reply" && c.status === "on_track",
  );

  const staleCommitmentId =
    selected?.kind === "next_reply" &&
    activeNextReply !== undefined &&
    activeNextReply.id !== selectedCommitmentId
      ? activeNextReply.id
      : null;

  useEffect(() => {
    if (!staleCommitmentId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("commitmentId", staleCommitmentId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [staleCommitmentId, pathname, router, searchParams]);
}

interface CaseDetailViewProps {
  data: CaseDetailData;
  selectedCommitmentId: string | null;
}

export const CaseDetailView = ({
  data,
  selectedCommitmentId,
}: CaseDetailViewProps) => {
  const timeZone = useOrgTimezone();
  useNextReplyCycleSync(data.commitments, selectedCommitmentId);

  return (
    <div className="w-full flex flex-col gap-4">
      {(data.case.sourceStaleSince || data.case.sourceNeverSynced) && (
        <Alert variant="warning">
          <ShieldAlert />
          <AlertDescription>
            {data.case.sourceStaleSince
              ? `Source data has been stale since ${formatExactTimestamp(data.case.sourceStaleSince, timeZone)}.`
              : "Source data is stale: its integration has not completed a successful sync yet."}{" "}
            SLA calculations use the latest received events; breach alerts are held until the source refreshes.
          </AlertDescription>
        </Alert>
      )}
      <CaseHeader data={data} />

      <CommitmentSummary
        data={data}
        selectedCommitmentId={selectedCommitmentId}
      />

      <CaseJourney data={data} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex flex-col gap-6 xl:col-span-7">
          <CalculationLedger
            data={data}
            selectedCommitmentId={selectedCommitmentId}
          />
          <LinkedRecords data={data} />
        </div>

        <div className="flex flex-col gap-6 xl:col-span-5">
          <ActivityTimeline data={data} />
        </div>
      </div>

      <ConversationThread data={data} />
    </div>
  );
};
