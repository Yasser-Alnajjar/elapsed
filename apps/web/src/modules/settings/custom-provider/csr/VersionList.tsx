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
export function VersionList({
  status,
  isOwner,
}: {
  status: CustomStatus;
  isOwner: boolean;
}) {
  const router = useRouter();
  const timeZone = useOrgTimezone();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    version: number;
    outcome: ActivateOutcome;
    diffHash?: string;
  } | null>(null);

  async function rollback(version: number, hash?: string, diffHash?: string) {
    setBusy(true);
    const outcome = await Actions.CustomProvider.rollback(
      version,
      hash,
      diffHash,
    );
    setBusy(false);
    if (
      outcome.kind === "needs_confirmation" ||
      outcome.kind === "needs_diff_review"
    )
      return setPending({ version, outcome, diffHash });
    setPending(null);
    if (outcome.kind === "activated") {
      notify.success(`Rolled back to version ${version}.`);
      return router.refresh();
    }
    notify.error(
      outcome.kind === "error" &&
        outcome.code === "auth_changed_reenter_credentials"
        ? "That version uses different credentials. Edit the configuration and enter them again."
        : outcome.kind === "error" &&
            outcome.code === "next_reply_restore_blocked"
          ? "That version would support Next reply again while earlier Next reply commitments are cancelled. That is not allowed yet."
          : "The rollback could not be applied.",
    );
  }

  return (
    <div className="flex flex-col gap-3 h-fit">
      <ul className="flex flex-col gap-2">
        {status.versions.map((v) => (
          <li
            key={v.version}
            className={`flex flex-col gap-1.5 rounded-lg p-3 text-xs ${v.active ? "bg-surface-raised" : "bg-surface-container hover:bg-surface-container-lowest transition-colors"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span
                  className={`font-mono text-sm font-bold ${v.active ? "text-on-surface" : "text-on-surface-variant"}`}
                >
                  v{v.version}
                </span>
                <span className="text-on-surface-variant font-mono text-[10px]">
                  {formatLongDateTime(new Date(v.createdAt), timeZone)}
                </span>
              </span>
              {v.active ? (
                <Badge
                  variant="primary"
                  className="font-mono text-[10px] font-bold uppercase"
                >
                  {status.connected ? "Active" : "Last active"}
                </Badge>
              ) : (
                isOwner && (
                  <Button
                    type="button"
                    size="sm"
                    variant="surface"
                    disabled={busy}
                    onClick={() => void rollback(v.version)}
                  >
                    Roll back to this
                  </Button>
                )
              )}
            </div>
            {v.note && <p className="text-on-surface-variant">{v.note}</p>}
          </li>
        ))}
      </ul>
      {pending?.outcome.kind === "needs_diff_review" && (
        <ConfigDiffPanel
          diff={pending.outcome.diff}
          busy={busy}
          onConfirm={() =>
            void rollback(
              pending.version,
              undefined,
              pending.outcome.kind === "needs_diff_review"
                ? (pending.outcome.diff.hash ?? undefined)
                : undefined,
            )
          }
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.outcome.kind === "needs_confirmation" && (
        <ImpactPanel
          impact={pending.outcome.impact}
          busy={busy}
          onConfirm={() =>
            void rollback(
              pending.version,
              pending.outcome.kind === "needs_confirmation"
                ? pending.outcome.impact.cancellation?.previewHash
                : undefined,
              pending.diffHash,
            )
          }
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
