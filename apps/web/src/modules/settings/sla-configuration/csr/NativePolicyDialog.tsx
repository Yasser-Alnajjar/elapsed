"use client";

import { MultiCombobox } from "@/components/shared/multi-combobox";
import { AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { CommitmentKind } from "@sla/core";
import { Actions } from "@/actions/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EntitlementWarningAlert, type EntitlementWarningPayload } from "@/components/shared/entitlement-alerts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCommitmentKind } from "@/lib/format";
import type {
  BusinessCalendarOption,
  CustomerCalendarSummary,
  SlaPolicySummary,
} from "@/lib/types/sla-configuration";

const COMMITMENT_KINDS: CommitmentKind[] = [
  "first_response",
  "next_reply",
  "resolution",
];
const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

/**
 * Sentinel Select value for "no explicit calendar" (4i) — the policy then
 * resolves its commitments to the organization's current default calendar,
 * or the system Always Open calendar when the organization has none, fresh
 * at commitment-creation time rather than a calendar frozen in at save time.
 */
const USE_ORGANIZATION_DEFAULT = "__use_organization_default__";

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

interface FormState {
  name: string;
  includedKinds: Set<CommitmentKind>;
  minutesByKind: Record<string, string>;
  priorities: Set<string>;
  customerIds: Set<string>;
  calendarId: string;
  warnAtPercent: string;
}

function calendarLabel(calendar: BusinessCalendarOption): string {
  const sourceLabel = calendar.source === "imported" ? "Imported" : "Native";
  return calendar.alwaysOpen
    ? `${calendar.name} (24/7) — ${sourceLabel}`
    : `${calendar.name} — ${calendar.timezone} — ${sourceLabel}`;
}

function initialState(policy: SlaPolicySummary | undefined): FormState {
  if (policy) {
    return {
      name: policy.name,
      includedKinds: new Set(policy.targets.map((t) => t.kind)),
      minutesByKind: Object.fromEntries(
        policy.targets.map((t) => [t.kind, String(t.minutes)]),
      ),
      priorities: new Set(policy.match.priority ?? []),
      customerIds: new Set(policy.match.customerIds ?? []),
      calendarId: policy.usesOrganizationDefaultCalendar
        ? USE_ORGANIZATION_DEFAULT
        : policy.calendarId,
      warnAtPercent: policy.warnAtPercent.join(", "),
    };
  }
  return {
    name: "",
    includedKinds: new Set(),
    minutesByKind: {},
    priorities: new Set(),
    customerIds: new Set(),
    // 4i: a new policy defaults to tracking the organization's default
    // calendar dynamically, not a snapshot frozen in at creation — the
    // admin can still explicitly pin a specific calendar below.
    calendarId: USE_ORGANIZATION_DEFAULT,
    warnAtPercent: "50, 80, 95",
  };
}

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
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
  const [state, setState] = useState<FormState>(() => initialState(policy));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A policy was created but the plan's soft limit was reached or passed (N6.3): kept open to say so.
  const [savedWarning, setSavedWarning] = useState<EntitlementWarningPayload | null>(null);

  useEffect(() => {
    if (!open) return;
    setState(initialState(policy));
    setError(null);
    setSavedWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    if (state.name.trim().length === 0) {
      setError("Name is required.");
      return;
    }
    if (state.includedKinds.size === 0) {
      setError("Set a target for at least one commitment.");
      return;
    }
    if (!state.calendarId) {
      setError("Choose a calendar.");
      return;
    }

    const targets: { kind: CommitmentKind; minutes: number }[] = [];
    for (const kind of state.includedKinds) {
      const minutes = Number(state.minutesByKind[kind]);
      if (
        !Number.isFinite(minutes) ||
        !Number.isInteger(minutes) ||
        minutes <= 0
      ) {
        setError(
          `Enter a positive whole number of minutes for ${formatCommitmentKind(kind).toLowerCase()}.`,
        );
        return;
      }
      targets.push({ kind, minutes });
    }

    const warnAtPercent = state.warnAtPercent
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number);
    if (warnAtPercent.some((p) => !Number.isInteger(p) || p <= 0 || p > 100)) {
      setError(
        "Warning thresholds must be whole percentages between 1 and 100.",
      );
      return;
    }

    const match = {
      priority: state.priorities.size > 0 ? [...state.priorities] : undefined,
      customerIds:
        state.customerIds.size > 0 ? [...state.customerIds] : undefined,
    };

    setSaving(true);
    setError(null);
    try {
      const explicitCalendarId =
        state.calendarId === USE_ORGANIZATION_DEFAULT ? null : state.calendarId;
      const result =
        mode === "create"
          ? await Actions.SlaConfiguration.createPolicy({
              name: state.name.trim(),
              match,
              targets,
              // Omit entirely (not null) on create: the API only treats a
              // missing field as "no explicit calendar" (4i).
              calendarId: explicitCalendarId ?? undefined,
              warnAtPercent,
            })
          : await Actions.SlaConfiguration.updatePolicy(policy!.id, {
              name: state.name.trim(),
              match,
              targets,
              calendarId: explicitCalendarId,
              warnAtPercent,
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
  const PRIORITY_OPTIONS = PRIORITIES.map((priority) => ({
    value: priority,
    label: priority.charAt(0).toUpperCase() + priority.slice(1),
  }));
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

          <div className="space-y-2">
            <Label>Targets</Label>
            <div className="space-y-2 rounded-lg bg-surface-container p-3">
              {COMMITMENT_KINDS.map((kind) => (
                <div key={kind} className="flex items-center gap-3">
                  <Checkbox
                    id={`kind-${kind}`}
                    checked={state.includedKinds.has(kind)}
                    onCheckedChange={(checked) =>
                      setState((s) => ({
                        ...s,
                        includedKinds:
                          checked === true
                            ? new Set([...s.includedKinds, kind])
                            : new Set(
                                [...s.includedKinds].filter(
                                  (value) => value !== kind,
                                ),
                              ),
                      }))
                    }
                    disabled={saving}
                  />

                  <Label
                    htmlFor={`kind-${kind}`}
                    className="min-w-0 flex-1 cursor-pointer font-normal"
                  >
                    {formatCommitmentKind(kind)}
                  </Label>
                  {state.includedKinds.has(kind) && (
                    <>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={state.minutesByKind[kind] ?? ""}
                        onChange={(e) =>
                          setState((s) => ({
                            ...s,
                            minutesByKind: {
                              ...s.minutesByKind,
                              [kind]: e.target.value,
                            },
                          }))
                        }
                        disabled={saving}
                        className="w-28"
                      />
                      <span className="text-sm text-on-surface-variant">
                        minutes
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* Matching */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Matching</h3>
              <p className="text-xs text-on-surface-variant">
                Define which cases this policy should apply to.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Priority */}
              <div className="space-y-2">
                <Label>Priority</Label>

                <MultiCombobox
                  options={PRIORITY_OPTIONS}
                  selected={[...state.priorities]}
                  onChange={(selected) =>
                    setState((s) => ({
                      ...s,
                      priorities: new Set(selected),
                    }))
                  }
                  placeholder="Select priorities..."
                  searchPlaceholder="Search priorities..."
                  emptyText="No priorities found."
                  allSelectedText="All priorities selected."
                  disabled={saving}
                />

                <p className="text-xs text-on-surface-variant">
                  Leave empty to match any priority.
                </p>
              </div>

              {/* Tier */}
              <div className="space-y-2">
                <Label>Tier</Label>

                <Select disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="No data source yet" />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="none">No data source yet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Customer */}
              {customers.length > 0 && (
                <div className="space-y-2">
                  <Label>Customers</Label>

                  <MultiCombobox
                    options={customers.map((customer) => ({
                      value: customer.id,
                      label: customer.name,
                    }))}
                    selected={[...state.customerIds]}
                    onChange={(selected) =>
                      setState((s) => ({
                        ...s,
                        customerIds: new Set(selected),
                      }))
                    }
                    placeholder="Select customers..."
                    searchPlaceholder="Search customers..."
                    emptyText="No customers found."
                    allSelectedText="All customers selected."
                    disabled={saving}
                  />

                  <p className="text-xs text-on-surface-variant">
                    Leave empty to match any customer.
                  </p>
                </div>
              )}

              {/* Calendar */}
              <div className="space-y-2">
                <Label>Calendar</Label>

                <Select
                  value={state.calendarId}
                  onValueChange={(value) =>
                    setState((s) => ({
                      ...s,
                      calendarId: value,
                    }))
                  }
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select calendar" />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value={USE_ORGANIZATION_DEFAULT}>
                      {defaultCalendarId
                        ? `Organization default (${businessCalendars.find((c) => c.id === defaultCalendarId)?.name ?? "unnamed"})`
                        : "Organization default (none set — falls back to Always open)"}
                    </SelectItem>
                    {businessCalendars.map((calendar) => (
                      <SelectItem key={calendar.id} value={calendar.id}>
                        {calendarLabel(calendar)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-on-surface-variant">
                  {state.calendarId === USE_ORGANIZATION_DEFAULT
                    ? "New commitments always use whichever calendar is currently the organization default (Settings → Business calendars), not a fixed snapshot."
                    : "Pinned to this calendar — new commitments use it until this policy is edited to point elsewhere."}
                </p>
              </div>
            </div>
          </div>

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
