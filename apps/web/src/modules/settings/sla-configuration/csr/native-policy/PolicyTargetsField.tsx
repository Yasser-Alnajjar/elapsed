"use client";

import type { Dispatch, SetStateAction } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCommitmentKind } from "@/lib/format";
import { COMMITMENT_KINDS } from "@sla/core";
import type { PolicyFormState } from "./native-policy-form";

/** One row per commitment kind: include it, then give its target in minutes. */
export function PolicyTargetsField({
  state,
  onChange,
  disabled,
}: {
  state: PolicyFormState;
  onChange: Dispatch<SetStateAction<PolicyFormState>>;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>Targets</Label>
      <div className="space-y-2 rounded-lg bg-surface-container p-3">
        {COMMITMENT_KINDS.map((kind) => (
          <div key={kind} className="flex items-center gap-3">
            <Checkbox
              id={`kind-${kind}`}
              checked={state.includedKinds.has(kind)}
              onCheckedChange={(checked) =>
                onChange((s) => ({
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
              disabled={disabled}
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
                    onChange((s) => ({
                      ...s,
                      minutesByKind: {
                        ...s.minutesByKind,
                        [kind]: e.target.value,
                      },
                    }))
                  }
                  disabled={disabled}
                  className="w-28"
                />
                <span className="text-sm text-on-surface-variant">minutes</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
