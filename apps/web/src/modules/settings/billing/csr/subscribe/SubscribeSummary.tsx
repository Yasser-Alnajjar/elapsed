import Link from "next/link";
import type { ReactNode } from "react";
import { BillingCaption, BillingCard } from "@/components/billing/billing-ui";
import { Button } from "@/components/ui/button";
import { formatBillingDate, formatMoney } from "@/lib/billing-format";
import { getUpgradeCta } from "@/lib/upgrade-cta";
import type { SubscribeInvoice, SubscribeReview } from "@/lib/types/billing-subscribe";
import { cn } from "@/lib/utils";

const PROFILE_HREF = "/billing?tab=payment";

function InvoiceBreakdown({ invoice }: { invoice: SubscribeInvoice }) {
  return (
    <div className="flex flex-col gap-3">
      <BillingCaption>You&apos;ll be invoiced</BillingCaption>
      {invoice.lines.length > 0 && (
        <dl className="flex flex-col gap-2">
          {invoice.lines.map((line) => (
            <div key={line.label} className="flex items-start justify-between gap-3 text-sm">
              <dt className="flex min-w-0 flex-col">
                <span className="text-foreground">{line.label}</span>
                <span className="text-foreground-subtle font-mono text-[11px]">{line.detail}</span>
              </dt>
              <dd className={cn("shrink-0 font-mono tabular-nums", line.amountCents === null ? "text-success" : "text-foreground")}>
                {line.amountCents === null ? "Included $0.00" : `${formatMoney(line.amountCents, invoice.currency)} ${invoice.currency}`}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="border-border flex items-end justify-between gap-3 border-t pt-3">
        <span className="text-foreground text-sm font-semibold">{invoice.estimated ? "Estimated total due" : "Total due"}</span>
        <span className="flex flex-col items-end">
          <span className="text-foreground font-mono text-3xl font-bold tabular-nums">
            {invoice.totalCents === null ? "Contract" : formatMoney(invoice.totalCents, invoice.currency)}
          </span>
          {invoice.totalCents !== null && (
            <span className="text-foreground-subtle font-mono text-[11px]">
              {invoice.currency} {invoice.estimated ? "· one-time, prorated" : "/ month"}
            </span>
          )}
        </span>
      </div>

      <div className="bg-surface-raised border-border flex items-start justify-between gap-3 rounded border px-3 py-2 font-mono text-[11px]">
        <span className="text-foreground-subtle tracking-wide uppercase">Invoice horizon</span>
        <span className="text-foreground text-right">
          {invoice.dueAt ? `Due ${formatBillingDate(invoice.dueAt)} (${invoice.dueNote})` : invoice.dueNote}
        </span>
      </div>
      {invoice.estimated && invoice.totalCents ? (
        <p className="text-foreground-subtle font-mono text-[11px]">The final amount is calculated when you confirm.</p>
      ) : null}
      {invoice.followUp && <p className="text-muted-foreground text-xs">{invoice.followUp}</p>}
    </div>
  );
}

export function PrimaryAction({
  review,
  busy,
  onConfirm,
  size = "lg",
  className,
}: {
  review: SubscribeReview;
  busy: boolean;
  onConfirm: () => void;
  size?: "lg" | "sm";
  className?: string;
}) {
  const contact = getUpgradeCta();
  if (review.block?.reason === "contact" && contact.href) {
    return (
      <Button asChild size={size} className={cn("font-semibold", className)}>
        <a href={contact.href}>{review.cta.label}</a>
      </Button>
    );
  }
  return (
    <Button type="button" size={size} disabled={review.cta.disabled || busy} onClick={onConfirm} className={cn("font-semibold", className)}>
      {busy ? "Saving…" : review.cta.label}
    </Button>
  );
}

/** The right column: when it takes effect, what is invoiced, how it settles, and the confirm button. */
export function SubscribeSummary({
  review,
  busy,
  onConfirm,
  footer,
}: {
  review: SubscribeReview;
  busy: boolean;
  onConfirm: () => void;
  footer?: ReactNode;
}) {
  const { effect, invoice, settlement } = review;
  const contractOnly = review.block?.reason === "contact";

  return (
    <BillingCard aria-labelledby="effect-title" className="border-primary/30 flex flex-col gap-5 p-5 sm:p-6 lg:sticky lg:top-20">
      <div className="flex flex-col gap-1">
        <BillingCaption>When this takes effect</BillingCaption>
        <h2 id="effect-title" className="text-foreground text-lg font-semibold tracking-tight">
          {effect.headline}
        </h2>
        {effect.detail && <p className="text-muted-foreground text-sm">{effect.detail}</p>}
      </div>

      {invoice && <InvoiceBreakdown invoice={invoice} />}

      {!contractOnly && review.block?.reason !== "internal" && (
        <div className="border-border flex flex-col gap-2 border-t pt-4">
          <BillingCaption>Settlement method</BillingCaption>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-foreground flex items-center gap-2">
              <span className="border-primary/30 bg-primary/10 text-primary rounded border px-1 font-mono text-[10px] font-bold">INV</span>
              {settlement.label}
            </span>
            <Link href={PROFILE_HREF} className="text-primary font-mono text-xs hover:underline">
              Edit billing profile
            </Link>
          </div>
          <p className="text-foreground-subtle font-mono text-[11px]">
            {settlement.billingEmail ? (
              <>
                Invoiced to: <span className="text-foreground">{settlement.billingEmail}</span>
              </>
            ) : (
              "No billing email set yet."
            )}
          </p>
        </div>
      )}

      <p className="text-foreground-subtle border-border border-t pt-4 text-xs leading-5">
        No credit card required. Monitoring never pauses. Cancel any time; cancellation takes effect at the end of your billing period.
      </p>

      <div className="flex flex-col gap-3">
        <PrimaryAction review={review} busy={busy} onConfirm={onConfirm} className="w-full" />
        {footer}
      </div>
    </BillingCard>
  );
}
