"use client";

import { ArrowLeftRight, CircleAlert } from "lucide-react";
import { useState } from "react";
import type { PlanId } from "@sla/db/plans";
import { BillingPill } from "@/components/billing/billing-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBillingDate } from "@/lib/billing-format";
import { getUpgradeCta } from "@/lib/upgrade-cta";
import type { BillingOverviewData, PlanOption } from "@/lib/types/billing";
import { cn } from "@/lib/utils";
import { useBillingActions } from "./billing-actions-context";

interface ChangePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BillingOverviewData;
  /** The plan selected when the dialog opens: a recommended upgrade, or the current plan. */
  initial: PlanId | null;
}

/**
 * "Change Subscription Plan": one radio row per plan. Chooses the first plan
 * when there is no live subscription, otherwise changes it. Says when the
 * change applies before it is made; the server decides and re-validates.
 */
export function ChangePlanDialog({ open, onOpenChange, data, initial }: ChangePlanDialogProps) {
  const { run, busy, version } = useBillingActions();
  const subscription = data.subscription && data.subscription.status !== "cancelled" ? data.subscription : null;
  const options = data.planOptions;
  const fallback = subscription?.pendingPlan?.id ?? subscription?.planId ?? options.find((option) => option.selfServe && !option.unavailableReason)?.id ?? "team";
  const [selected, setSelected] = useState<PlanId>(initial ?? fallback);
  const [error, setError] = useState<string | null>(null);
  const choice = options.find((option) => option.id === selected);
  const contact = getUpgradeCta();

  const keepsCurrent = Boolean(subscription && choice?.current && subscription.pendingPlan);
  const unchanged = Boolean(subscription && choice?.current && !subscription.pendingPlan) || Boolean(choice?.pending);
  const disabled = !choice || busy || !choice.selfServe || choice.unavailableReason !== null || unchanged;

  const effectText = (option: PlanOption): string | null => {
    if (!subscription) {
      return data.trial && !data.trial.expired && data.trial.endsAt
        ? `Billing starts when the trial ends on ${formatBillingDate(data.trial.endsAt)}.`
        : "Starts now; the first invoice is issued today.";
    }
    if (option.current) return subscription.pendingPlan ? `Cancels the scheduled move to ${subscription.pendingPlan.name}.` : null;
    if (subscription.status === "trialing") return "Applies now; billing still starts when the trial ends.";
    if (option.effect === "now") return "Applies now. The price difference for the rest of this period is invoiced.";
    return `Applies at the end of this period, on ${formatBillingDate(subscription.currentPeriodEnd)}.`;
  };

  const submit = async () => {
    if (!choice) return;
    setError(null);
    const result =
      !subscription || version === null
        ? await run({ action: "start", plan: choice.id }, `Subscribed to ${choice.name}`)
        : await run(
            { action: "change_plan", plan: choice.id, expectedVersion: version },
            keepsCurrent ? `Staying on ${choice.name}` : choice.effect === "period_end" ? `Move to ${choice.name} scheduled` : `Moved to ${choice.name}`,
          );
    if (result.ok) onOpenChange(false);
    else setError(result.error ?? null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ArrowLeftRight aria-hidden className="text-primary size-5" />
            {subscription ? "Change subscription plan" : "Choose a subscription plan"}
          </DialogTitle>
          <DialogDescription>
            Upgrades apply immediately; downgrades take effect at the end of the current billing cycle. Prices come from the published pricing.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className="sr-only">Plan</legend>
          {options.map((option) => {
            const checked = option.id === selected;
            const blocked = !option.selfServe || option.unavailableReason !== null;
            return (
              <label
                key={option.id}
                className={cn(
                  "flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors",
                  blocked ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                  checked ? "border-primary/50 bg-primary/5" : "border-border bg-surface-raised hover:bg-surface-hover",
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <input
                    type="radio"
                    name="plan"
                    value={option.id}
                    checked={checked}
                    onChange={() => {
                      setSelected(option.id);
                      setError(null);
                    }}
                    className="accent-primary size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground font-mono text-sm font-semibold">{option.name} Tier</span>
                      {option.current && <BillingPill tone="primary">Current</BillingPill>}
                      {option.pending && <BillingPill tone="warning">Scheduled</BillingPill>}
                    </span>
                    <span className="text-muted-foreground block text-xs">{option.summary}</span>
                    {option.unavailableReason ? (
                      <span className="text-warning-text block text-xs">{option.unavailableReason}</span>
                    ) : !option.selfServe ? (
                      <span className="text-foreground-subtle block text-xs">Priced by contract. {contact.href ? "Contact us to move to it." : contact.label}</span>
                    ) : checked && effectText(option) ? (
                      <span className="text-primary block text-xs">{effectText(option)}</span>
                    ) : null}
                  </span>
                </span>
                <span className="text-foreground shrink-0 font-mono text-base font-bold tabular-nums">
                  {option.priceLabel}
                  {option.priceLabel !== "Custom" && <span className="text-foreground-subtle text-[10px] font-normal">/mo</span>}
                </span>
              </label>
            );
          })}
        </fieldset>

        {error && (
          <p role="alert" className="border-error/35 bg-error/10 text-error flex items-start gap-2 rounded-lg border p-3 text-sm">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="surface" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {choice && !choice.selfServe && contact.href ? (
            <Button asChild>
              <a href={contact.href}>Contact us</a>
            </Button>
          ) : (
            <Button type="button" disabled={disabled} onClick={submit}>
              {busy ? "Saving…" : !subscription ? "Start subscription" : keepsCurrent ? `Keep ${choice?.name}` : "Update plan"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
