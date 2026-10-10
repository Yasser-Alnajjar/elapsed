"use client";

import { Lock, Plug } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { AdminClientActions } from "@/actions/admin-client";
import { AdminPanel, MonoLabel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/lib/notify";
import type { AdminTenantBetaAccess } from "@/lib/types/admin";

/**
 * This organization's place on each Beta allowlist (D33, N10), which replaced
 * the N9 Custom REST flag. Removing it from Custom REST also pauses polling on
 * its custom integration and re-adding does not resume it (plan 09 §8.7).
 * Every change needs a reason and is audited. Provider-wide settings live on
 * `/admin/integrations`.
 */
export function BetaAccessPanel({ organizationId, access }: { organizationId: string; access: AdminTenantBetaAccess[] }) {
  const router = useRouter();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(entry: AdminTenantBetaAccess) {
    setWorking(entry.provider);
    setError(null);
    const { ok, body } = entry.listed
      ? await AdminClientActions.removeFromBetaAllowlist(entry.provider, organizationId, reason.trim())
      : await AdminClientActions.addToBetaAllowlist(entry.provider, organizationId, reason.trim());
    setWorking(null);
    if (!ok) {
      setError(body.error ?? "The change failed");
      notify.error(`Could not change ${entry.name} Beta access.`);
      return;
    }
    notify.success(entry.listed ? `Removed from the ${entry.name} Beta and audited.` : `Added to the ${entry.name} Beta and audited.`);
    setReason("");
    router.refresh();
  }

  return (
    <AdminPanel className="overflow-hidden">
      <div className="bg-surface-raised border-border flex items-center gap-2.5 border-b px-4 py-3">
        <Plug className="text-primary size-4" aria-hidden />
        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">Beta access</h2>
      </div>
      <div className="flex flex-col gap-3 p-4">
        {access.length === 0 ? (
          <p className="text-muted-foreground text-xs">No provider is restricted to an allowlist right now.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {access.map((entry) => (
                <li key={entry.provider} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground text-sm">{entry.name}</span>
                    <span className="border-border text-foreground-subtle rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em] uppercase">
                      {entry.listed ? "On allowlist" : "Not listed"}
                    </span>
                  </div>
                  {!entry.allowlistApplies && <MonoLabel>Allowlist not in effect for this provider right now</MonoLabel>}
                  {entry.allowlistAddBlock && !entry.listed ? (
                    <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                      <Lock className="text-warning-text mt-0.5 size-3 shrink-0" aria-hidden />
                      Adding is blocked by {entry.allowlistAddBlock.id}.
                    </p>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant={entry.listed ? "outline" : "default"}
                      disabled={working !== null || reason.trim() === ""}
                      onClick={() => void toggle(entry)}
                      className="self-start"
                    >
                      {working === entry.provider ? "Saving" : entry.listed ? "Remove from Beta" : "Add to Beta"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={reasonId} className="text-xs">
                Reason (audit log)
              </Label>
              <Textarea id={reasonId} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} disabled={working !== null} />
            </div>
          </>
        )}
        {error && <p className="text-destructive text-xs">{error}</p>}
        <Link href="/admin/integrations" className="text-primary text-xs underline-offset-2 hover:underline">
          Provider-wide availability
        </Link>
      </div>
    </AdminPanel>
  );
}
