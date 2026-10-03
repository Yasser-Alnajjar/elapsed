import Link from "next/link";
import { Check } from "lucide-react";
import { BillingCard } from "@/components/billing/billing-ui";
import { Button } from "@/components/ui/button";
import type { SubscribeReview } from "@/lib/types/billing-subscribe";

/** Shown in place of the review once the change was saved. */
export function SubscribeSuccess({ review }: { review: SubscribeReview }) {
  const { success, settlement } = review;
  return (
    <BillingCard role="status" className="border-success/30 mx-auto my-6 flex w-full max-w-2xl flex-col items-center gap-5 p-8 text-center">
      <span aria-hidden className="border-success/40 bg-success/10 text-success flex size-12 items-center justify-center rounded-full border">
        <Check className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-foreground text-xl font-semibold">{success.title}</h2>
        <p className="text-muted-foreground text-sm leading-6">{success.message}</p>
      </div>
      <dl className="bg-surface-raised border-border flex w-full max-w-md flex-col gap-2 rounded-md border p-4 text-left font-mono text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-foreground-subtle uppercase">{success.effectiveLabel}</dt>
          <dd className="text-foreground font-semibold">{success.effectiveValue}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-foreground-subtle uppercase">Settlement</dt>
          <dd className="text-foreground">{settlement.label}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/billing">Go to Billing</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/billing?tab=invoices">View invoices</Link>
        </Button>
      </div>
    </BillingCard>
  );
}
