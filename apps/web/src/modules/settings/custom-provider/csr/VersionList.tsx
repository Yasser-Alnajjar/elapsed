"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { notify } from "@/lib/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CustomStatus } from "@/lib/custom-provider/status";
import { formatLongDateTime } from "@/lib/format";
import type { ActivateOutcome } from "@/lib/types/custom-provider";
import { ConfigDiffPanel } from "./ConfigDiffPanel";
import { ImpactPanel } from "./ImpactPanel";

/** Immutable configuration versions. Rolling back re-activates mapping for future processing only: commitments a later version cancelled are never restored. */
export function VersionList({ status, isOwner }: { status: CustomStatus; isOwner: boolean }) {
  const router = useRouter();
  const timeZone = useOrgTimezone();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ version: number; outcome: ActivateOutcome; diffHash?: string } | null>(null);

  async function rollback(version: number, hash?: string, diffHash?: string) {
    setBusy(true);
    const outcome = await Actions.CustomProvider.rollback(version, hash, diffHash);
    setBusy(false);
    if (outcome.kind === "needs_confirmation" || outcome.kind === "needs_diff_review") return setPending({ version, outcome, diffHash });
    setPending(null);
    if (outcome.kind === "activated") {
      notify.success(`Rolled back to version ${version}.`);
      return router.refresh();
    }
    notify.error(
      outcome.kind === "error" && outcome.code === "auth_changed_reenter_credentials"
        ? "That version uses different credentials. Edit the configuration and enter them again."
        : outcome.kind === "error" && outcome.code === "next_reply_restore_blocked"
          ? "That version would support Next reply again while earlier Next reply commitments are cancelled. That is not allowed yet."
          : "The rollback could not be applied.",
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5 text-xs">
        {status.versions.map((v) => (
          <li key={v.version} className="flex items-center justify-between gap-3">
            <span>
              Version {v.version} · {formatLongDateTime(new Date(v.createdAt), timeZone)} {v.note ? `· ${v.note}` : ""}
            </span>
            {v.active ? (
              <Badge variant="primary">Active</Badge>
            ) : (
              isOwner && (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void rollback(v.version)}>
                  Roll back to this
                </Button>
              )
            )}
          </li>
        ))}
      </ul>
      {pending?.outcome.kind === "needs_diff_review" && (
        <ConfigDiffPanel
          diff={pending.outcome.diff}
          busy={busy}
          onConfirm={() => void rollback(pending.version, undefined, pending.outcome.kind === "needs_diff_review" ? (pending.outcome.diff.hash ?? undefined) : undefined)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.outcome.kind === "needs_confirmation" && (
        <ImpactPanel
          impact={pending.outcome.impact}
          busy={busy}
          onConfirm={() => void rollback(pending.version, pending.outcome.kind === "needs_confirmation" ? pending.outcome.impact.cancellation?.previewHash : undefined, pending.diffHash)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
