"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Actions } from "@/actions/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EntitlementWarningAlert, type EntitlementWarningPayload } from "@/components/shared/entitlement-alerts";
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
import type {
  BusinessCalendarOption,
  CustomerCalendarSummary,
  SlaPolicySummary,
} from "@/lib/types/sla-configuration";
import { PolicyMatchingFields } from "./native-policy/PolicyMatchingFields";
import { PolicyTargetsField } from "./native-policy/PolicyTargetsField";
import {
  initialPolicyFormState,
  validatePolicyForm,
  type PolicyFormState,
} from "./native-policy/native-policy-form";

interface NativePolicyDialogProps {
  mode: "create" | "edit";
  policy?: SlaPolicySummary;
  businessCalendars: BusinessCalendarOption[];
  customers: CustomerCalendarSummary[];
  defaultCalendarId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function NativePolicyDialog({
  mode,
  policy,
  businessCalendars,
  customers,
  defaultCalendarId,
  open,
  onOpenChange,
  onSaved,
}: NativePolicyDialogProps) {
  const [state, setState] = useState<PolicyFormState>(() => initialPolicyFormState(policy));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A policy was created but the plan's soft limit was reached or passed (N6.3): kept open to say so.
  const [savedWarning, setSavedWarning] = useState<EntitlementWarningPayload | null>(null);

  useEffect(() => {
    if (!open) return;
    setState(initialPolicyFormState(policy));
    setError(null);
    setSavedWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const validation = validatePolicyForm(state);
    if ("error" in validation) {
      setError(validation.error);
      return;
    }
    const { explicitCalendarId, ...input } = validation.payload;

    setSaving(true);
    setError(null);
    try {
      const result =
        mode === "create"
          ? await Actions.SlaConfiguration.createPolicy({
              ...input,
              // Omit entirely (not null) on create: the API only treats a
              // missing field as "no explicit calendar" (4i).
              calendarId: explicitCalendarId ?? undefined,
            })
          : await Actions.SlaConfiguration.updatePolicy(policy!.id, {
              ...input,
              calendarId: explicitCalendarId,
            });

      if (!result.ok) {
        setError(result.body.error ?? "Failed to save policy.");
        return;
      }
      // The policy exists either way; a soft-limit warning only changes what the owner is told.
      const warning = "entitlementWarning" in result.body ? result.body.entitlementWarning : undefined;
      if (mode === "create" && warning) {
        setSavedWarning(warning);
        return;
      }
      onSaved();
    } catch {
      setError("Something went wrong while saving the policy.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing after a created-with-warning policy still has to refresh the list.
        if (!next && savedWarning) {
          setSavedWarning(null);
          onSaved();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create SLA policy" : `Edit ${policy?.name}`}
          </DialogTitle>
          <DialogDescription>
            A native policy created here is matched only when no imported
            Zendesk policy matches a case (D12).
          </DialogDescription>
        </DialogHeader>

        {savedWarning ? (
          <div className="space-y-4" data-testid="policy-created-with-warning">
            <Alert variant="success">
              <AlertDescription>Policy created.</AlertDescription>
            </Alert>
            <EntitlementWarningAlert warning={savedWarning} />
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  setSavedWarning(null);
                  onSaved();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="policy-name">Name</Label>
            <Input
              id="policy-name"
              value={state.name}
              onChange={(e) =>
                setState((s) => ({ ...s, name: e.target.value }))
              }
              disabled={saving}
            />
          </div>

          <PolicyTargetsField
            state={state}
            onChange={setState}
            disabled={saving}
          />
          <PolicyMatchingFields
            state={state}
            onChange={setState}
            disabled={saving}
            businessCalendars={businessCalendars}
            customers={customers}
            defaultCalendarId={defaultCalendarId}
          />

          {/* Warning thresholds */}
          <div className="space-y-2">
            <Label htmlFor="warn-at-percent">
              Warning thresholds (% of target)
            </Label>

            <Input
              id="warn-at-percent"
              value={state.warnAtPercent}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  warnAtPercent: e.target.value,
                }))
              }
              disabled={saving}
              placeholder="50, 80, 95"
              className="max-w-xs"
            />

            <p className="text-xs text-on-surface-variant">
              Comma-separated percentages used to trigger warnings.
            </p>
          </div>

          {/* Versioning notice */}
          {mode === "edit" && (
            <div className="rounded-lg bg-surface-container px-3 py-2.5">
              <p className="text-xs leading-5 text-on-surface-variant">
                This creates a new policy version. Existing commitments keep
                their current target. The new target applies to new commitments
                only.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Footer */}
          <DialogFooter className="gap-2">
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
                : mode === "create"
                  ? "Create policy"
                  : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
