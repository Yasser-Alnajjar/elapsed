"use client";

import { Download, ReceiptText } from "lucide-react";
import { BillingCaption, BillingCard, BillingPill } from "@/components/billing/billing-ui";
import { Button } from "@/components/ui/button";
import { formatBillingDate, formatBillingDateTime, formatMoney } from "@/lib/billing-format";
import type { BillingOverviewData } from "@/lib/types/billing";
import { OWNER_ONLY_HINT, PROVIDER_HINT, useBillingActions } from "../billing-actions-context";
import { useProviderSession } from "../useProviderSession";

/** The next scheduled charge with its itemized ledger and estimated total, or why there is none. */
export function UpcomingInvoiceCard({ data, onChoosePlan }: { data: BillingOverviewData; onChoosePlan: () => void }) {
  const { canManage, providerAvailable } = useBillingActions();
  const openPortal = useProviderSession("portal");
  const invoice = data.upcomingInvoice;
  const { subscription } = data;

  const emptyText = !subscription
    ? "No charge is scheduled. Billing starts when a plan is chosen."
    : subscription.status === "cancelled"
      ? `The subscription ended on ${formatBillingDate(subscription.endedAt ?? subscription.currentPeriodEnd)}. Nothing renews.`
      : subscription.cancelAtPeriodEnd
        ? `Cancellation is scheduled. Nothing renews after ${formatBillingDate(subscription.currentPeriodEnd)}.`
        : "No charge is scheduled.";

  return (
    <BillingCard aria-labelledby="upcoming-invoice-title" className="flex flex-col justify-between gap-6 p-5 sm:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ReceiptText aria-hidden className="text-primary size-5" />
            <h2 id="upcoming-invoice-title" className="text-foreground text-lg font-semibold tracking-tight sm:text-xl">
              Upcoming Invoice
            </h2>
          </div>
          <BillingPill tone={invoice ? "primary" : "neutral"}>{invoice ? "Pending" : "None"}</BillingPill>
        </div>

        {invoice ? (
          <>
            <div className="bg-surface-raised flex flex-col gap-1 rounded p-4">
              <BillingCaption>Scheduled charge · {invoice.planName}</BillingCaption>
              <p className="flex items-baseline gap-1">
                <span className="text-foreground text-4xl font-bold tracking-tight tabular-nums">{formatMoney(invoice.amountCents, invoice.currency)}</span>
                {invoice.amountCents !== null && <span className="text-foreground-subtle font-mono text-[11px]">{invoice.currency}</span>}
              </p>
              <span className="text-muted-foreground mt-1 font-mono text-[10px]">
                Next invoice: <span className="text-foreground tabular-nums">{formatBillingDateTime(invoice.nextAttemptAt)}</span>
              </span>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <BillingCaption>Itemized ledger</BillingCaption>
              <dl className="flex flex-col gap-1">
                {invoice.lineItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 py-1 text-xs">
                    <dt className="flex min-w-0 flex-col">
                      <span className="text-foreground font-medium">{item.label}</span>
                      <span className="text-foreground-subtle font-mono text-[10px]">{item.detail}</span>
                    </dt>
                    <dd className={item.amountCents ? "text-foreground font-mono font-semibold tabular-nums" : "text-muted-foreground font-mono tabular-nums"}>
                      {item.amountCents === null ? (invoice.amountCents === null ? "Contract" : "Included") : formatMoney(item.amountCents, invoice.currency)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        ) : (
          <div className="bg-surface-raised flex flex-col items-start gap-3 rounded p-4">
            <p className="text-muted-foreground text-sm">{emptyText}</p>
            {(!subscription || subscription.status === "cancelled") && (
              <Button type="button" size="sm" disabled={!canManage} title={canManage ? undefined : OWNER_ONLY_HINT} onClick={onChoosePlan} className="font-mono">
                Choose a plan
              </Button>
            )}
          </div>
        )}
      </div>

      {invoice && (
        <div className="flex flex-col gap-2">
          <div className="bg-surface-container flex items-center justify-between rounded px-3 py-2 font-mono text-[11px]">
            <span className="text-foreground font-bold">Estimated total</span>
            <span className="text-foreground text-sm font-bold tabular-nums">{formatMoney(invoice.amountCents, invoice.currency)}</span>
          </div>
          <Button
            type="button"
            variant="surface"
            size="sm"
            className="w-full font-mono"
            disabled={!providerAvailable || !canManage}
            title={providerAvailable ? undefined : PROVIDER_HINT}
            onClick={openPortal}
          >
            <Download aria-hidden />
            Download invoice PDF (draft)
          </Button>
        </div>
      )}
    </BillingCard>
  );
}
