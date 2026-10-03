import { CreditCard } from "lucide-react";
import { Tag } from "@/components/admin/admin-ui";
import { BillingFactRow } from "@/components/billing/billing-ui";
import { formatBillingDate, formatMoney } from "@/lib/billing-format";
import { isPlanId, PLANS } from "@sla/db/plans";
import type { AdminTenantBillingDetail } from "@/lib/types/admin-billing";
import { DetailCard } from "./detail-card";

/** Price, plan, and the cycle facts: subscribed on, period, next renewal, open balance. */
export function SubscriptionPlanCard({ data, onEditTerms }: { data: AdminTenantBillingDetail; onEditTerms: () => void }) {
  const { subscription, tenant } = data;
  const live = subscription && subscription.status !== "cancelled";
  const pending = subscription?.pendingPlan && isPlanId(subscription.pendingPlan) ? PLANS[subscription.pendingPlan].name : null;

  return (
    <DetailCard
      icon={CreditCard}
      iconClassName="text-primary"
      title="Subscription plan"
      badge={<Tag tone={live && !subscription.cancelAtPeriodEnd ? "success" : "neutral"}>Auto-renew: {live && !subscription.cancelAtPeriodEnd ? "on" : "off"}</Tag>}
      footer={subscription ? `Since ${formatBillingDate(subscription.createdAt)}` : "No subscription yet"}
      action={live ? { label: "Edit terms", onClick: onEditTerms, chevron: true } : undefined}
    >
      {subscription ? (
        <>
          <div>
            <p className="flex items-baseline gap-1.5">
              <span className="text-foreground text-4xl font-bold tracking-tight tabular-nums">{formatMoney(subscription.unitPriceCents)}</span>
              {subscription.unitPriceCents !== null && <span className="text-foreground-subtle font-mono text-[11px] uppercase">USD / month</span>}
            </p>
            <p className="text-primary mt-1 font-mono text-sm font-semibold">{subscription.planName} plan</p>
          </div>
          <dl className="flex flex-col gap-1">
            <BillingFactRow label="Current period">
              {formatBillingDate(subscription.currentPeriodStart)} – {formatBillingDate(subscription.currentPeriodEnd)}
            </BillingFactRow>
            <BillingFactRow label={subscription.status === "trialing" ? "Trial ends" : "Next renewal"} tone={tenant.status === "past_due" ? "warning" : undefined}>
              {subscription.cancelAtPeriodEnd ? `Ends ${formatBillingDate(subscription.currentPeriodEnd)}` : formatBillingDate(tenant.nextBillingAt)}
            </BillingFactRow>
            {pending && (
              <BillingFactRow label="Scheduled" tone="warning">
                → {pending}
              </BillingFactRow>
            )}
            <BillingFactRow label="Open balance" tone={tenant.openCents > 0 ? "danger" : undefined}>
              {formatMoney(tenant.openCents)} USD
            </BillingFactRow>
          </dl>
        </>
      ) : (
        <p className="bg-surface-raised text-muted-foreground rounded p-4 text-sm">
          This organization has not chosen a plan{tenant.status === "trialing" && tenant.trialDaysLeft !== null ? `; its trial has ${tenant.trialDaysLeft} days left` : ""}.
        </p>
      )}
    </DetailCard>
  );
}
