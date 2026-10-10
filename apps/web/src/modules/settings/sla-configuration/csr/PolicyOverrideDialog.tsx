"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { AlertDescription } from "@/components/ui/alert";
import { DismissibleAlert } from "@/components/ui/dismissible-alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatCommitmentKind,
  formatMinutes,
  formatPolicyMatch,
} from "@/lib/format";
import type { SlaPolicySummary } from "@/lib/types/sla-configuration";

interface PolicyOverrideDialogProps {
  policy: SlaPolicySummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

type MinutesByKind = Record<string, string>;

function targetsToMinutes(targets: SlaPolicySummary["targets"]): MinutesByKind {
  return Object.fromEntries(
    targets.map((target) => [target.kind, String(target.minutes)]),
  );
}

export function PolicyOverrideDialog({
  policy,
  open,
  onOpenChange,
  onSaved,
}: PolicyOverrideDialogProps) {
  const [minutesByKind, setMinutesByKind] = useState<MinutesByKind>(() =>
    targetsToMinutes(policy.targets),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setMinutesByKind(targetsToMinutes(policy.targets));
    setError(null);
  }, [open, policy.targets]);

  const importedByKind = new Map(
    policy.importedTargets.map((target) => [target.kind, target.minutes]),
  );

  const singleKind =
    policy.targets.length === 1 ? policy.targets[0]?.kind : null;

  const title = singleKind
    ? `${policy.overridden ? "Edit" : "Override"} ${formatCommitmentKind(
        singleKind,
      ).toLowerCase()} target`
    : `${policy.overridden ? "Edit" : "Override"} policy targets`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) {
      return;
    }

    const targets = policy.targets.map((target) => ({
      kind: target.kind,
      minutes: Number(minutesByKind[target.kind]),
    }));

    const invalid = targets.some(
      (target) =>
        !Number.isFinite(target.minutes) ||
        !Number.isInteger(target.minutes) ||
        target.minutes <= 0,
    );

    if (invalid) {
      setError("Enter a positive whole number of minutes for each target.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { ok, body } = await Actions.SlaConfiguration.overridePolicyTargets(
        policy.id,
        targets,
      );

      if (!ok) {
        setError(body.error ?? "Failed to save override.");
        return;
      }

      onSaved();
    } catch {
      setError("Something went wrong while saving the override.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {formatPolicyMatch(policy.match)}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-3">
            {policy.targets.map((target) => {
              const importedMinutes = importedByKind.get(target.kind);

              return (
                <div
                  key={target.kind}
                  className="rounded-lg bg-surface-container p-4"
                >
                  <div className="mb-4">
                    <p className="text-sm font-medium text-foreground">
                      {formatCommitmentKind(target.kind)}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      Configure the target for new commitments.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-on-surface-variant">Imported</p>
                      <p className="text-sm font-medium text-foreground">
                        {formatMinutes(importedMinutes ?? target.minutes)}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs text-on-surface-variant">Current</p>
                      <p className="text-sm font-medium text-foreground">
                        {formatMinutes(target.minutes)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label htmlFor={`target-${target.kind}`}>New target</Label>

                    <div className="flex items-center gap-2">
                      <Input
                        id={`target-${target.kind}`}
                        type="number"
                        min={1}
                        step={1}
                        value={minutesByKind[target.kind] ?? ""}
                        onChange={(event) =>
                          setMinutesByKind((current) => ({
                            ...current,
                            [target.kind]: event.target.value,
                          }))
                        }
                        disabled={saving}
                        className="w-32"
                      />

                      <span className="text-sm text-on-surface-variant">
                        minutes
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg bg-surface-container px-3 py-2.5">
            <p className="text-xs leading-5 text-on-surface-variant">
              This creates a new policy version. Existing commitments keep their
              current target. The new target applies to new commitments only.
            </p>
          </div>

          {error && (
            <DismissibleAlert key={error} variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </DismissibleAlert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="surface"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>

            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {saving
                ? "Saving…"
                : policy.overridden
                  ? "Save changes"
                  : "Save override"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
