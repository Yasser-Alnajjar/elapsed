"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CustomStatus } from "@/lib/custom-provider/status";

/**
 * Review of a sync stopped by the mass-lifecycle-change safety check (plan 09,
 * 6.11). Read-only preview, then a reason and a single-use confirmation bound
 * to exactly this record set (it lapses after 24 hours or if the data changes).
 * Only this check can be overridden; a mass deletion cannot. Owner only.
 */
export function OverridePanel({ status, isOwner }: { status: CustomStatus; isOwner: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const aborted = status.override;
  if (!aborted) return null;

  async function confirm(via?: "support") {
    setBusy(true);
    const response = await Actions.CustomProvider.confirmOverride({ previewHash: aborted!.previewHash, reason, via });
    setBusy(false);
    if (response.ok) {
      setResult(via === "support" ? "Recorded. A support operator can now apply it." : "Confirmed. The next sync will apply exactly this change once.");
      router.refresh();
    } else {
      setResult(response.body.error === "stale_preview" ? "The data changed. Review the new preview." : "That could not be recorded.");
    }
  }

  return (
    <div className="border-warning/30 bg-warning/10 flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <p className="font-medium">A sync was stopped before any change was applied</p>
      <p>
        {aborted.counts.R} of {aborted.counts.L} existing tickets would switch between open and closed in one sync
        {aborted.counts.ratio !== null ? ` (${Math.round(aborted.counts.ratio * 100)}%)` : ""}. That is more than the safety check allows, so nothing was changed.
      </p>
      {aborted.recordIds.length > 0 && <p className="text-xs">Examples: {aborted.recordIds.join(", ")}.</p>}
      {isOwner ? (
        <>
          <label className="flex flex-col gap-1 text-xs">
            Why is this change expected? (required)
            <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy || reason.trim() === ""} onClick={() => void confirm()}>
              Apply this change on the next sync
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy || reason.trim() === ""} onClick={() => void confirm("support")}>
              Ask support to apply it
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs">Only an organization owner can review this.</p>
      )}
      {result && <Alert>{result}</Alert>}
    </div>
  );
}
