"use client";

import { CircleX, Landmark, PlayCircle } from "lucide-react";
import { BillingCard } from "@/components/billing/billing-ui";
import { Button } from "@/components/ui/button";
import { formatBillingDate } from "@/lib/billing-format";
import type { SubscriptionSummary } from "@/lib/types/billing";
import { OWNER_ONLY_HINT, useBillingActions } from "../billing-actions-context";
import { ConfirmBillingAction } from "../ConfirmBillingAction";

/**
 * "Plan Modifications & Tenant Governance": the quiet danger zone. Cancel
 * schedules the end of the subscription at the end of the period, behind a
 * confirmation; until then it can be resumed. An ended subscription is
 * restarted by choosing a plan.
 */
export function PlanGovernancePanel({ subscription, onChoosePlan }: { subscription: SubscriptionSummary | null; onChoosePlan: () => void }) {
  const { canManage, busy, run, version } = useBillingActions();
  const hint = canManage ? undefined : OWNER_ONLY_HINT;
  const disabled = !canManage || busy || version === null;
  const endDate = subscription ? formatBillingDate(subscription.status === "trialing" ? subscription.trialEndsAt ?? subscription.currentPeriodEnd : subscription.currentPeriodEnd) : null;

  const description = !subscription
    ? "Choose a plan to start a subscription. Changes and cancellations take effect at the end of a billing cycle."
    : subscription.status === "cancelled"
      ? `The subscription ended on ${formatBillingDate(subscription.endedAt ?? subscription.currentPeriodEnd)}. Monitoring, cases and SLA history stay available; choose a plan to subscribe again.`
      : subscription.cancelAtPeriodEnd
        ? `Cancellation is scheduled for ${endDate}. Resume before then to keep the subscription with nothing lost.`
        : "Modifications take effect at the end of the current billing cycle. Cancelling never pauses monitoring; your cases, SLA history and configuration stay intact.";

  return (
    <BillingCard className="flex flex-col justify-between gap-4 p-5 sm:p-6 md:flex-row md:items-center">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Landmark aria-hidden className="text-foreground-subtle size-4.5" />
          <h3 className="text-foreground font-mono text-sm font-semibold">Plan Modifications &amp; Tenant Governance</h3>
        </div>
        <p className="text-muted-foreground max-w-3xl text-xs leading-5">{description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {(!subscription || subscription.status === "cancelled") && (
          <Button type="button" size="sm" disabled={!canManage || busy} title={hint} onClick={onChoosePlan} className="font-mono">
            Choose a plan
          </Button>
        )}
        {subscription && subscription.status !== "cancelled" && subscription.cancelAtPeriodEnd && (
          <Button
            type="button"
            variant="surface"
            size="sm"
            disabled={disabled}
            title={hint}
            onClick={() => version !== null && run({ action: "resume", expectedVersion: version }, "Subscription resumed")}
            className="font-mono"
          >
            <PlayCircle aria-hidden />
            Resume subscription
          </Button>
        )}
        {subscription && subscription.status !== "cancelled" && !subscription.cancelAtPeriodEnd && (
          <ConfirmBillingAction
            title="Cancel the subscription?"
            description={`The subscription ends on ${endDate}, at the end of this ${subscription.status === "trialing" ? "trial" : "billing cycle"}, and does not renew. Monitoring and your data stay available, and you can resume until then.`}
            confirmLabel="Cancel subscription"
            destructive
            onConfirm={() => version !== null && run({ action: "cancel", expectedVersion: version }, "Cancellation scheduled")}
            trigger={
              <Button
                type="button"
                variant="surface"
                size="sm"
                disabled={disabled}
                title={hint}
                className="text-foreground-subtle hover:bg-error/10 hover:text-error font-mono"
              >
                <CircleX aria-hidden />
                Cancel subscription
              </Button>
            }
          />
        )}
      </div>
    </BillingCard>
  );
}
