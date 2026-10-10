"use client";

import { Lock, TriangleAlert, X } from "lucide-react";
import { useId, useState } from "react";
import { AdminClientActions } from "@/actions/admin-client";
import { MonoLabel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatUtcDate } from "@/lib/admin-format";
import { notify } from "@/lib/notify";
import { AVAILABILITY_REASON_MAX_LENGTH, type AdminIntegrationAvailabilityRow, type AvailabilityImpact } from "@/lib/types/admin";

interface AllowlistDialogProps {
  row: AdminIntegrationAvailabilityRow | null;
  organizations: { id: string; name: string }[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}

/** A provider's Beta allowlist: add an organization, or remove one after reviewing what it loses. Every change needs a reason (audited). */
export function AllowlistDialog({ row, organizations, onOpenChange, onChanged }: AllowlistDialogProps) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      {row && <AllowlistForm key={row.provider} row={row} organizations={organizations} onClose={() => onOpenChange(false)} onChanged={onChanged} />}
    </Dialog>
  );
}

function AllowlistForm({
  row,
  organizations,
  onClose,
  onChanged,
}: {
  row: AdminIntegrationAvailabilityRow;
  organizations: AllowlistDialogProps["organizations"];
  onClose: () => void;
  onChanged: AllowlistDialogProps["onChanged"];
}) {
  const ids = { org: useId(), reason: useId() };
  const [organizationId, setOrganizationId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The removal being confirmed, with its impact. */
  const [removing, setRemoving] = useState<{ id: string; name: string; impact: AvailabilityImpact } | null>(null);

  const listed = new Set(row.allowlist.map((entry) => entry.organizationId));
  const candidates = organizations.filter((org) => !listed.has(org.id));
  const reasonOk = reason.trim().length > 0;
  const allowlistApplies = row.enabled && row.releaseStage === "beta" && row.betaAccess === "allowlist";

  async function add() {
    setBusy(true);
    setError(null);
    const { ok, body } = await AdminClientActions.addToBetaAllowlist(row.provider, organizationId, reason.trim());
    setBusy(false);
    if (!ok) {
      setError(body.error ?? "The organization could not be added");
      notify.error(`Could not add the organization to the ${row.name} allowlist.`);
      return;
    }
    notify.success(`Added to the ${row.name} allowlist and audited.`);
    setOrganizationId("");
    setReason("");
    await onChanged();
  }

  async function startRemoval(id: string, name: string) {
    setBusy(true);
    setError(null);
    const { ok, body } = await AdminClientActions.previewAvailabilityImpact(row.provider, { removeOrganizationId: id });
    setBusy(false);
    if (!ok) {
      setError(body.error ?? "The impact could not be calculated");
      return;
    }
    setRemoving({ id, name, impact: body });
  }

  async function confirmRemoval() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    const { ok, body } = await AdminClientActions.removeFromBetaAllowlist(row.provider, removing.id, reason.trim());
    setBusy(false);
    if (!ok) {
      setError(body.error ?? "The organization could not be removed");
      notify.error(`Could not remove the organization from the ${row.name} allowlist.`);
      return;
    }
    notify.success(
      body.pausedPolling
        ? `Removed from the ${row.name} allowlist; its polling is paused (resume it on the tenant page).`
        : `Removed from the ${row.name} allowlist and audited.`,
    );
    setRemoving(null);
    setReason("");
    await onChanged();
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{row.name} Beta allowlist</DialogTitle>
        <DialogDescription>
          {allowlistApplies
            ? `Only these organizations can use ${row.name} while it is in Beta.`
            : `Not in effect right now (${row.enabled ? "the provider is not Beta with an allowlist" : "the provider is disabled"}); kept for when it is.`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        {row.allowlist.length === 0 ? (
          <p className="text-muted-foreground border-border rounded border border-dashed px-3 py-4 text-center text-sm">No organizations on the allowlist.</p>
        ) : (
          <ul className="border-border divide-border divide-y rounded border">
            {row.allowlist.map((entry) => (
              <li key={entry.organizationId} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-foreground truncate text-sm">{entry.organizationName ?? entry.organizationId}</p>
                  <MonoLabel>
                    Added {formatUtcDate(entry.createdAt)} by {entry.addedByEmail}
                  </MonoLabel>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !reasonOk}
                  title={reasonOk ? undefined : "Enter a reason first"}
                  onClick={() => void startRemoval(entry.organizationId, entry.organizationName ?? entry.organizationId)}
                >
                  <X aria-hidden />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {removing && (
          <div className="border-warning/35 bg-warning/[0.06] flex flex-col gap-2 rounded border p-3 text-xs leading-4" role="status">
            <span className="text-foreground flex items-center gap-1.5 font-semibold">
              <TriangleAlert className="text-warning-text size-3.5" aria-hidden />
              Remove {removing.name}?
            </span>
            <p className="text-muted-foreground">
              {removing.impact.connectionsAffected > 0
                ? `${removing.impact.connectionsAffected} connection${removing.impact.connectionsAffected === 1 ? "" : "s"} will be paused by Elapsed. Its data and credentials are kept.`
                : "It has no connection that would be paused."}
              {row.provider === "custom" ? " Polling on its Custom REST integration is also paused; re-adding does not resume it." : ""}
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="destructive" onClick={() => void confirmRemoval()} disabled={busy}>
                Confirm removal
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
                Keep
              </Button>
            </div>
          </div>
        )}

        {row.allowlistAddBlock ? (
          <p className="border-warning/30 bg-warning/[0.07] text-muted-foreground flex items-start gap-2 rounded border px-3 py-2 text-xs leading-4">
            <Lock className="text-warning-text mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Adding organizations is blocked by {row.allowlistAddBlock.id}: {row.allowlistAddBlock.reason}
            </span>
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.org}>Add an organization</Label>
            {candidates.length === 0 ? (
              <p className="text-muted-foreground text-xs">Every organization is already on the allowlist.</p>
            ) : (
              <Select value={organizationId} onValueChange={setOrganizationId} disabled={busy}>
                <SelectTrigger id={ids.org} className="w-full">
                  <SelectValue placeholder="Choose an organization" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.reason}>Reason (audit log, required to add or remove)</Label>
          <Textarea
            id={ids.reason}
            value={reason}
            maxLength={AVAILABILITY_REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            disabled={busy}
          />
        </div>

        {error && (
          <p className="text-error text-xs" role="alert">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Close
        </Button>
        {!row.allowlistAddBlock && (
          <Button type="button" onClick={() => void add()} disabled={busy || !organizationId || !reasonOk}>
            Add to allowlist
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
