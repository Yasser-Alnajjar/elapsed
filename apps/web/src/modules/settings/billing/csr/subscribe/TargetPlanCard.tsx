import { ArrowRight, Users } from "lucide-react";
import { BillingCaption, BillingCard, BillingPill } from "@/components/billing/billing-ui";
import { formatMoney } from "@/lib/billing-format";
import type { SubscribeReview } from "@/lib/types/billing-subscribe";

/** "Target subscription": the plan, its price, and the transition from where the organization is now. */
export function TargetPlanCard({ review }: { review: SubscribeReview }) {
  return (
    <BillingCard aria-labelledby="target-plan-title" className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <BillingCaption>Target subscription</BillingCaption>
          <h2 id="target-plan-title" className="text-foreground text-2xl font-semibold tracking-tight">
            {review.planName} Plan
          </h2>
          <p className="text-muted-foreground max-w-md text-sm">{review.planDescription}</p>
        </div>
        <p className="flex shrink-0 flex-col sm:items-end">
          <span className="text-foreground font-mono text-3xl font-bold tabular-nums">{review.priceCents === null ? "Contract" : formatMoney(review.priceCents)}</span>
          <span className="text-foreground-subtle font-mono text-[11px]">{review.priceCents === null ? "priced by contract" : "/ month · USD"}</span>
        </p>
      </div>

      <div className="border-border flex flex-wrap items-center gap-2 border-t pt-4">
        <BillingCaption className="mr-1">Plan transition</BillingCaption>
        <BillingPill tone="neutral">{review.transition.from}</BillingPill>
        <ArrowRight aria-hidden className="text-foreground-subtle size-3.5" />
        <BillingPill tone="primary">{review.transition.to}</BillingPill>
      </div>

      <div className="bg-surface-raised text-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2.5 text-sm">
        <span className="flex items-center gap-2">
          <Users aria-hidden className="text-primary size-4 shrink-0" />
          {review.seatsLine}
        </span>
        <span className="text-foreground-subtle font-mono text-[11px]">Seats never change price</span>
      </div>
    </BillingCard>
  );
}
