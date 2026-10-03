import { BillingCaption, BillingCard, BillingPill } from "@/components/billing/billing-ui";
import { formatBillingDate, formatMoney } from "@/lib/billing-format";

interface LedgerHeaderProps {
  organizationName: string;
  year: number;
  annualCents: number;
  currency: string;
  nextBillingAt: string | null;
  autopay: boolean;
}

/** "Ledger & Settlement": scope breadcrumb, autopay state, this year's total and the next billing date. */
export function LedgerHeader({ organizationName, year, annualCents, currency, nextBillingAt, autopay }: LedgerHeaderProps) {
  return (
    <BillingCard className="relative flex flex-col justify-between gap-4 overflow-hidden p-4 md:flex-row md:items-center">
      <div aria-hidden className="bg-primary/5 pointer-events-none absolute -right-10 -bottom-10 size-64 rounded-full blur-3xl" />
      <div className="flex min-w-0 flex-col gap-1">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5">
          <BillingCaption>Ledger scope</BillingCaption>
          <BillingCaption>/</BillingCaption>
          <BillingCaption className="text-primary">{organizationName}</BillingCaption>
          <BillingCaption>/</BillingCaption>
          <BillingCaption className="text-foreground">Fiscal {year}</BillingCaption>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">Ledger &amp; Settlement</h1>
          <BillingPill tone={autopay ? "success" : "primary"} dot pulse={autopay} className="rounded-full px-2">
            {autopay ? "Autopay active" : "Direct invoicing"}
          </BillingPill>
        </div>
      </div>
      <div className="relative grid grid-cols-2 gap-3 sm:flex">
        <div className="bg-surface-raised flex flex-col gap-0.5 rounded-lg px-4 py-2">
          <BillingCaption>Annual aggregate ({year})</BillingCaption>
          <span className="text-foreground font-mono text-sm font-bold tabular-nums">
            {formatMoney(annualCents, currency)} <span className="text-foreground-subtle text-xs font-normal">{currency}</span>
          </span>
        </div>
        <div className="bg-surface-raised flex flex-col gap-0.5 rounded-lg px-4 py-2">
          <BillingCaption>Next billing horizon</BillingCaption>
          <span className="text-primary font-mono text-sm font-bold tabular-nums">{formatBillingDate(nextBillingAt)}</span>
        </div>
      </div>
    </BillingCard>
  );
}
