"use client";

import { Lock, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { AdminClientActions } from "@/actions/admin-client";
import { MonoLabel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AVAILABILITY_REASON_MAX_LENGTH,
  BETA_ACCESS_LABELS,
  BETA_ACCESS_MODES,
  RELEASE_STAGE_LABELS,
  RELEASE_STAGES,
  STATUS_MESSAGE_MAX_LENGTH,
  type AdminIntegrationAvailabilityRow,
  type AvailabilityImpact,
  type AvailabilityPolicyFields,
  type BetaAccessMode,
  type ReleaseStage,
} from "@/lib/types/admin";

interface AvailabilityDialogProps {
  /** The provider being edited; null keeps the dialog closed. */
  row: AdminIntegrationAvailabilityRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => Promise<void>;
  /** Someone else saved first (409 `stale_version`): the list is reloaded. */
  onStale: (message: string) => Promise<void>;
}

export function AvailabilityDialog({ row, onOpenChange, onSaved, onStale }: AvailabilityDialogProps) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      {row && <AvailabilityForm key={`${row.provider}-${row.version}`} row={row} onCancel={() => onOpenChange(false)} onSaved={onSaved} onStale={onStale} />}
    </Dialog>
  );
}

/** Whether an organization (on or off the allowlist) may use the provider under these fields; mirrors `decideAvailability`. */
function availableUnder(fields: AvailabilityPolicyFields, onAllowlist: boolean): boolean {
  if (!fields.enabled || fields.releaseStage === "coming_soon") return false;
  return fields.releaseStage === "stable" || fields.betaAccess === "all_organizations" || onAllowlist;
}

/** Narrows availability: someone may lose access, so the change needs an impact review and an explicit confirmation. */
function narrows(before: AvailabilityPolicyFields, after: AvailabilityPolicyFields): boolean {
  return [true, false].some((onAllowlist) => availableUnder(before, onAllowlist) && !availableUnder(after, onAllowlist));
}

function AvailabilityForm({
  row,
  onCancel,
  onSaved,
  onStale,
}: {
  row: AdminIntegrationAvailabilityRow;
  onCancel: () => void;
  onSaved: AvailabilityDialogProps["onSaved"];
  onStale: AvailabilityDialogProps["onStale"];
}) {
  const ids = { enabled: useId(), stage: useId(), access: useId(), message: useId(), reason: useId(), confirm: useId() };
  const before: AvailabilityPolicyFields = {
    enabled: row.enabled,
    releaseStage: row.releaseStage,
    betaAccess: row.betaAccess,
    statusMessage: row.statusMessage,
  };
  const [enabled, setEnabled] = useState(row.enabled);
  const [releaseStage, setReleaseStage] = useState<ReleaseStage>(row.releaseStage);
  const [betaAccess, setBetaAccess] = useState<BetaAccessMode>(row.betaAccess);
  const [statusMessage, setStatusMessage] = useState(row.statusMessage ?? "");
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState<AvailabilityImpact | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const after: AvailabilityPolicyFields = { enabled, releaseStage, betaAccess, statusMessage: statusMessage.trim() || null };
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  const isNarrowing = narrows(before, after);
  const blocked = row.rolloutBlock;
  const reviewing = impact !== null;

  /** Only the fields that differ, so the request says exactly what the operator changed. */
  const changes = (): Partial<AvailabilityPolicyFields> =>
    Object.fromEntries(
      (Object.keys(after) as (keyof AvailabilityPolicyFields)[]).filter((key) => before[key] !== after[key]).map((key) => [key, after[key]]),
    );

  async function review() {
    setBusy(true);
    setError(null);
    const { ok, body } = await AdminClientActions.previewAvailabilityImpact(row.provider, changes()).catch(() => ({
      ok: false,
      status: 0,
      body: { error: "Network error" } as AvailabilityImpact & { error?: string },
    }));
    setBusy(false);
    if (!ok) {
      setError(body.error ?? "The impact could not be calculated");
      return;
    }
    setImpact(body);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const { ok, status, body } = await AdminClientActions.updateIntegrationAvailability(row.provider, {
      ...changes(),
      expectedVersion: row.version,
      reason: reason.trim(),
    }).catch(() => ({ ok: false, status: 0, body: { error: "Network error", code: undefined } as { error?: string; code?: string; changed?: boolean } }));
    setBusy(false);
    if (!ok) {
      const code = (body as { code?: string }).code;
      if (status === 409 && code === "stale_version") {
        await onStale(body.error ?? "Someone else changed this integration. The latest settings are loaded.");
        return;
      }
      setError(body.error ?? "The change failed");
      return;
    }
    await onSaved(body.changed ? `${row.name} availability saved and audited.` : "No changes.");
  }

  const reasonOk = reason.trim().length > 0 && reason.trim().length <= AVAILABILITY_REASON_MAX_LENGTH;
  const canSubmit = changed && reasonOk && !busy && (!isNarrowing || (reviewing && confirmed));

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Edit {row.name} availability</DialogTitle>
        <DialogDescription>
          Platform-wide. Enforced by the backend on connections, OAuth, webhooks, imports and the worker. Customer data is never deleted.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5">
          <Checkbox id={ids.enabled} checked={enabled} onCheckedChange={(value) => { setEnabled(value === true); setImpact(null); }} disabled={busy} />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor={ids.enabled}>Enabled</Label>
            <p className="text-muted-foreground text-xs">Off makes {row.name} unavailable to every organization, whatever its stage.</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.stage}>Release stage</Label>
          <Select value={releaseStage} onValueChange={(value) => { setReleaseStage(value as ReleaseStage); setImpact(null); }} disabled={busy}>
            <SelectTrigger id={ids.stage} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RELEASE_STAGES.map((stage) => (
                <SelectItem key={stage} value={stage} disabled={Boolean(blocked) && stage === "stable" && row.releaseStage !== "stable"}>
                  {RELEASE_STAGE_LABELS[stage]}
                  {blocked && stage === "stable" && row.releaseStage !== "stable" ? ` (blocked by ${blocked.id})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {releaseStage === "beta" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.access}>Beta access</Label>
            <Select value={betaAccess} onValueChange={(value) => { setBetaAccess(value as BetaAccessMode); setImpact(null); }} disabled={busy}>
              <SelectTrigger id={ids.access} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BETA_ACCESS_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode} disabled={Boolean(blocked) && mode === "all_organizations" && row.betaAccess !== "all_organizations"}>
                    {BETA_ACCESS_LABELS[mode]}
                    {blocked && mode === "all_organizations" && row.betaAccess !== "all_organizations" ? ` (blocked by ${blocked.id})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {blocked && (
          <p className="border-warning/30 bg-warning/[0.07] text-muted-foreground flex items-start gap-2 rounded border px-3 py-2 text-xs leading-4">
            <Lock className="text-warning-text mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Stable and &quot;All organizations&quot; are blocked by {blocked.id}: {blocked.reason}
            </span>
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.message}>Customer message (optional)</Label>
          <Textarea
            id={ids.message}
            value={statusMessage}
            maxLength={STATUS_MESSAGE_MAX_LENGTH}
            onChange={(event) => setStatusMessage(event.target.value)}
            placeholder="Shown to customers while it is unavailable, e.g. “Paused while we investigate a provider API issue.”"
            disabled={busy}
            rows={2}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.reason}>Reason (audit log)</Label>
          <Textarea
            id={ids.reason}
            value={reason}
            maxLength={AVAILABILITY_REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why this change is being made."
            disabled={busy}
            rows={2}
            required
          />
        </div>

        {isNarrowing && (
          <div className="border-warning/35 bg-warning/[0.06] flex flex-col gap-2 rounded border p-3 text-xs leading-4" role="status">
            <span className="text-foreground flex items-center gap-1.5 font-semibold">
              <TriangleAlert className="text-warning-text size-3.5" aria-hidden />
              This change takes {row.name} away from organizations
            </span>
            <ul className="text-muted-foreground list-disc space-y-0.5 ps-4">
              <li>New connections, reconnects, OAuth completions, connect links and manual imports are refused.</li>
              <li>The worker stops syncing it; its webhooks are acknowledged and ignored. Data goes stale.</li>
              <li>Connections, credentials, cases, events and commitments are kept; customers see &quot;Paused by Elapsed&quot;.</li>
              <li>Re-enabling resumes from the stored cursor and catches up.</li>
            </ul>
            {!reviewing ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void review()} disabled={busy || !changed} className="self-start">
                {busy ? "Calculating impact" : "Review impact"}
              </Button>
            ) : (
              <>
                <MonoLabel>Impact</MonoLabel>
                {impact.organizationsLosingAccess.length === 0 ? (
                  <p className="text-foreground">No connected organization loses access.</p>
                ) : (
                  <>
                    <p className="text-foreground">
                      {impact.organizationsLosingAccess.length} organization{impact.organizationsLosingAccess.length === 1 ? "" : "s"} and {impact.connectionsAffected} connection
                      {impact.connectionsAffected === 1 ? "" : "s"} will be paused:
                    </p>
                    <ul className="text-muted-foreground max-h-28 list-disc overflow-y-auto ps-4">
                      {impact.organizationsLosingAccess.map((org) => (
                        <li key={org.id}>{org.name}</li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="flex items-start gap-2">
                  <Checkbox id={ids.confirm} checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} disabled={busy} />
                  <Label htmlFor={ids.confirm} className="text-xs leading-4 font-normal">
                    I understand the impact and want to apply this change.
                  </Label>
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <p className="text-error text-xs" role="alert">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void save()} disabled={!canSubmit} variant={isNarrowing ? "destructive" : "default"}>
          {busy && reviewing ? "Saving" : "Save change"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
