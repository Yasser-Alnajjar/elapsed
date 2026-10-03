"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Actions } from "@/actions/client";
import { Button } from "@/components/ui/button";
import { formatCommitmentKind, formatPolicyMatch } from "@/lib/format";
import type {
  BusinessCalendarOption,
  CustomerCalendarSummary,
  SlaPolicySummary,
} from "@/lib/types/sla-configuration";
import { formatTargetClock } from "./SlaSection";
import { NativePolicyDialog } from "./NativePolicyDialog";
import { PolicyOverrideDialog } from "./PolicyOverrideDialog";

/** Small mono chip used for a policy's version / source / status labels. */
export const policyChip =
  "bg-surface-container-highest rounded px-1.5 py-0.5 font-mono text-xxs";

/** Per-kind targets, with the imported value struck through where an override changed it. */
function TargetGrid({
  targets,
  baseline,
}: {
  targets: SlaPolicySummary["targets"];
  baseline?: SlaPolicySummary["targets"];
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {targets.map((target) => {
        const original = baseline?.find((b) => b.kind === target.kind);
        const changed = original && original.minutes !== target.minutes;

        return (
          <div
            key={target.kind}
            className="bg-surface-container-lowest flex flex-col gap-0.5 rounded-lg p-2.5"
          >
            <span className="text-outline font-mono text-xxs uppercase">
              {formatCommitmentKind(target.kind)}
            </span>
            <span className="text-primary font-mono text-base font-bold">
              {formatTargetClock(target.minutes)}
            </span>
            {changed && (
              <span className="text-outline font-mono text-xxs line-through">
                {formatTargetClock(original.minutes)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One policy: name/version/source/status chips, edit and (native) activate controls, match rule, targets, and its edit dialog. */
export function PolicyRow({
  policy,
  businessCalendars,
  customers,
  defaultCalendarId,
  onSaved,
}: {
  policy: SlaPolicySummary;
  businessCalendars: BusinessCalendarOption[];
  customers: CustomerCalendarSummary[];
  defaultCalendarId: string | null;
  onSaved: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  async function handleToggleActive() {
    setTogglingActive(true);

    const { ok } = await Actions.SlaConfiguration.setPolicyActive(
      policy.id,
      !policy.active,
    );

    setTogglingActive(false);

    if (ok) onSaved();
  }

  return (
    <>
      <div className="bg-surface-container hover:bg-surface-container-high/50 flex flex-col gap-3 rounded-lg p-4 transition-colors">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-on-surface text-base font-semibold">
              {policy.name}
            </p>

            <span className={`${policyChip} text-on-surface-variant`}>
              v{policy.version}
            </span>

            <span
              className={`${policyChip} ${policy.source === "imported" ? "text-secondary" : "text-primary"}`}
            >
              {policy.source === "imported" ? "Imported (Zendesk)" : "Native"}
            </span>

            {policy.overridden && (
              <span className={`${policyChip} text-warning font-semibold`}>
                ▲ Overridden
              </span>
            )}

            {policy.active ? (
              <span
                className={`${policyChip} text-success flex items-center gap-1`}
              >
                <span className="bg-success size-1.5 rounded-full" />
                Active
              </span>
            ) : (
              <span className={`${policyChip} text-warning`}>Inactive</span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-primary"
              onClick={() => setDialogOpen(true)}
            >
              {policy.source === "native" || policy.overridden
                ? "Edit"
                : "Override targets"}
            </Button>

            {policy.source === "native" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={policy.active ? "text-error" : "text-success"}
                onClick={handleToggleActive}
                disabled={togglingActive}
              >
                {togglingActive && <Loader2 className="animate-spin" />}
                {policy.active ? "Deactivate" : "Reactivate"}
              </Button>
            )}
          </div>
        </div>

        <div className="bg-surface-container-lowest flex items-center gap-2 overflow-x-auto rounded px-2.5 py-1.5">
          <span className="text-outline shrink-0 font-mono text-xxs">
            MATCH RULE:
          </span>
          <code className="text-secondary truncate font-mono text-xs">
            {formatPolicyMatch(policy.match)}
          </code>
        </div>

        <TargetGrid
          targets={policy.targets}
          baseline={policy.overridden ? policy.importedTargets : undefined}
        />
      </div>

      {policy.source === "imported" ? (
        <PolicyOverrideDialog
          policy={policy}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSaved={() => {
            setDialogOpen(false);
            onSaved();
          }}
        />
      ) : (
        <NativePolicyDialog
          mode="edit"
          policy={policy}
          businessCalendars={businessCalendars}
          customers={customers}
          defaultCalendarId={defaultCalendarId}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSaved={() => {
            setDialogOpen(false);
            onSaved();
          }}
        />
      )}
    </>
  );
}
