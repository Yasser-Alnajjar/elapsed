"use client";

import { CircleAlert, Hourglass, MailCheck, RefreshCw, TimerReset, Unlink } from "lucide-react";
import { Tag } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { daysBetween, formatBillingDate, formatHoursMinutes, formatMoney } from "@/lib/billing-format";
import type { OverdueState, TenantConnector } from "@/lib/types/admin-billing";

interface DelinquencyBannerProps {
  overdue: OverdueState;
  asOf: string;
  connectors: TenantConnector[];
  providerAvailable: boolean;
  busy: boolean;
  onRetry: () => void;
  onGrantGrace: () => void;
}

/** The critical banner: which invoice is overdue, for how long, the grace window, and the two recovery actions. */
export function DelinquencyBanner({ overdue, asOf, connectors, providerAvailable, busy, onRetry, onGrantGrace }: DelinquencyBannerProps) {
  const graceLeft = Date.parse(overdue.graceEndsAt) - Date.parse(asOf);
  const daysLate = Math.max(1, daysBetween(overdue.dueAt, asOf));
  const failing = connectors.find((connector) => !connector.healthy);

  return (
    <section aria-label="Payment delinquency" className="bg-card border-error/35 relative overflow-hidden rounded-lg border p-4">
      <div aria-hidden className="bg-error absolute inset-y-0 left-0 w-1.5" />
      <div className="flex flex-col justify-between gap-4 pl-2 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <span className="bg-error/10 text-error mt-0.5 flex size-10 shrink-0 items-center justify-center rounded">
            <CircleAlert aria-hidden className="size-6" />
          </span>
          <div className="flex min-w-0 flex-col">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-error font-mono text-[11px] font-bold tracking-[0.06em] uppercase">✕ Payment delinquency</span>
              <Tag tone="warning">{graceLeft > 0 ? "Dunning: grace period active" : "Dunning: grace elapsed"}</Tag>
              <span className="text-foreground-subtle font-mono text-[10px]">ID: {overdue.invoiceNumber}</span>
            </div>
            <p className="text-foreground text-sm leading-snug">
              Invoice <span className="font-mono text-xs">{overdue.invoiceNumber}</span> for{" "}
              <span className="text-error font-mono font-bold">{formatMoney(overdue.amountCents)} USD</span> was due on{" "}
              <span className="font-mono text-xs">{formatBillingDate(overdue.dueAt)}</span> and is {daysLate} day{daysLate === 1 ? "" : "s"} late
              {overdue.openInvoices > 1 && ` (${overdue.openInvoices} invoices open)`}.
            </p>
            <div className="text-foreground-subtle mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px]">
              <span className="text-warning-text flex items-center gap-1">
                <Hourglass aria-hidden className="size-3.5" />
                {graceLeft > 0 ? `Grace window closes: ${formatHoursMinutes(graceLeft)}` : "Grace window closed; monitoring continues"}
              </span>
              <span className="text-border-strong">·</span>
              <span className="flex items-center gap-1">
                <MailCheck aria-hidden className="size-3.5" />
                Settled by direct invoice
              </span>
              {failing && (
                <>
                  <span className="text-border-strong">·</span>
                  <span className="text-error flex items-center gap-1">
                    <Unlink aria-hidden className="size-3.5" />
                    {failing.name} sync {failing.status}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="tonal"
            size="compact"
            disabled={busy || !providerAvailable}
            title={providerAvailable ? undefined : "Collecting a charge needs a payment provider."}
            onClick={onRetry}
            className="font-mono text-xs font-semibold"
          >
            <RefreshCw aria-hidden className="size-4" />
            Retry charge now
          </Button>
          <Button type="button" variant="surface" size="compact" disabled={busy} onClick={onGrantGrace} className="font-mono text-xs">
            <TimerReset aria-hidden className="text-warning-text size-4" />
            Grant 7-day grace
          </Button>
        </div>
      </div>
    </section>
  );
}
