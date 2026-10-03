import { ShieldCheck } from "lucide-react";
import { BillingCard, BillingPill } from "@/components/billing/billing-ui";

/** How card data is handled, and whether a payment provider is connected. */
export function BillingSecurityBanner({ providerAvailable }: { providerAvailable: boolean }) {
  return (
    <BillingCard className="bg-surface-raised/80 flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
      <div className="flex items-start gap-4 sm:items-center">
        <span className="bg-card text-primary flex size-9 shrink-0 items-center justify-center rounded-lg shadow-inner">
          <ShieldCheck aria-hidden className="size-5" />
        </span>
        <div className="flex flex-col">
          <span className="text-foreground flex flex-wrap items-center gap-1.5 font-mono text-xs font-bold">
            Provider-hosted payment pipeline
            <BillingPill tone="success">Card data never stored</BillingPill>
          </span>
          <span className="text-muted-foreground mt-0.5 text-xs">
            Card payments are collected on the payment provider&apos;s hosted pages. Elapsed never stores or reads raw card numbers.
          </span>
        </div>
      </div>
      <span className="text-foreground-subtle flex shrink-0 items-center gap-1.5 self-end font-mono text-[10px] sm:self-center">
        <span aria-hidden className={providerAvailable ? "bg-success size-1.5 rounded-full" : "bg-foreground-subtle size-1.5 rounded-full"} />
        Payment provider: {providerAvailable ? "connected" : "not connected"}
      </span>
    </BillingCard>
  );
}
