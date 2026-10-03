"use client";

import { BadgeCheck, ChevronLeft, ChevronRight, CreditCard, Download, ExternalLink, FileText, ReceiptText } from "lucide-react";
import { BillingCard, InvoiceStatusPill } from "@/components/billing/billing-ui";
import { Button } from "@/components/ui/button";
import { formatBillingDate, formatBillingDateTime, formatMoney } from "@/lib/billing-format";
import type { BillingInvoice } from "@/lib/types/billing";
import { cn } from "@/lib/utils";
import { PROVIDER_HINT, useBillingActions } from "../billing-actions-context";
import { useProviderSession } from "../useProviderSession";

interface InvoiceTableProps {
  /** The filtered invoices; this table pages through them. */
  invoices: BillingInvoice[];
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  empty: { title: string; description: string; onReset?: () => void };
}

const HEAD = "text-foreground-subtle px-4 py-3 text-left font-mono text-[10px] leading-3 font-semibold tracking-[0.08em] uppercase";
const ICON_BUTTON = "bg-surface-raised hover:bg-surface-hover rounded p-1 transition-colors";

/** The settlement ledger: one row per invoice, with its window, amount, state, method and the per-invoice actions. */
export function InvoiceTable({ invoices, page, pageCount, onPage, empty }: InvoiceTableProps) {
  const { providerAvailable } = useBillingActions();
  const openPortal = useProviderSession("portal");
  const rows = invoices.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const unsettled = invoices.some((invoice) => invoice.status !== "paid" && invoice.status !== "void");

  return (
    <BillingCard className="flex flex-col overflow-hidden">
      <div className="bg-surface-raised text-foreground-subtle flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 font-mono text-[10px] tracking-[0.04em]">
        <span className="flex items-center gap-2 uppercase">
          <span aria-hidden className="bg-primary size-2 animate-pulse rounded-full" />
          Invoice ledger · {providerAvailable ? "provider settled" : "direct invoicing"}
        </span>
        <span className="text-muted-foreground font-bold uppercase">
          Page {Math.min(page + 1, Math.max(pageCount, 1))} of {Math.max(pageCount, 1)} ({invoices.length} entries)
        </span>
      </div>

      {invoices.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
          <ReceiptText aria-hidden className="text-foreground-subtle size-6" />
          <div>
            <p className="text-foreground text-sm font-semibold">{empty.title}</p>
            <p className="text-muted-foreground mt-0.5 text-sm">{empty.description}</p>
          </div>
          {empty.onReset && (
            <Button type="button" variant="surface" size="sm" onClick={empty.onReset}>
              Reset filters
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead className="bg-surface-container-lowest">
              <tr>
                <th scope="col" className={HEAD}>Invoice identifier</th>
                <th scope="col" className={HEAD}>Billing window</th>
                <th scope="col" className={HEAD}>Plan description &amp; seats</th>
                <th scope="col" className={HEAD}>Amount</th>
                <th scope="col" className={HEAD}>Settlement state</th>
                <th scope="col" className={HEAD}>Method</th>
                <th scope="col" className={HEAD}>Paid / due (UTC)</th>
                <th scope="col" className={cn(HEAD, "text-right")}>Verification &amp; PDF</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {rows.map((invoice) => (
                <tr key={invoice.id} className={cn("hover:bg-surface-hover/60 transition-colors", invoice.detailHighlighted && "bg-surface-raised/20")}>
                  <td className="text-primary px-4 py-3 font-mono text-xs font-bold whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <FileText aria-hidden className="text-primary/80 size-4" />
                      {invoice.number}
                    </span>
                  </td>
                  <td className="text-foreground px-4 py-3 font-mono text-xs">
                    {formatBillingDate(invoice.periodStart)} – {formatBillingDate(invoice.periodEnd)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-col">
                      <span className="text-foreground font-mono text-xs font-medium">{invoice.description}</span>
                      <span className={cn("font-mono text-[10px]", invoice.detailHighlighted ? "text-warning-text" : "text-foreground-subtle")}>
                        {invoice.detail}
                      </span>
                    </span>
                  </td>
                  <td className="text-foreground px-4 py-3 font-mono text-base font-bold whitespace-nowrap tabular-nums">
                    {formatMoney(invoice.amountCents, invoice.currency)}{" "}
                    <span className="text-foreground-subtle text-[10px] font-normal">{invoice.currency}</span>
                  </td>
                  <td className="px-4 py-3">
                    <InvoiceStatusPill status={invoice.status} />
                  </td>
                  <td className="text-muted-foreground px-4 py-3 font-mono text-xs whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <CreditCard aria-hidden className="text-foreground-subtle size-4" />
                      {invoice.paymentMethodLabel}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-4 py-3 font-mono text-xs">
                    {invoice.paidAt ? formatBillingDateTime(invoice.paidAt) : invoice.status === "open" ? `Due ${formatBillingDate(invoice.dueAt)}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        title={providerAvailable ? "Download invoice PDF" : `Invoice PDF: ${PROVIDER_HINT.toLowerCase()}`}
                        aria-label={`Download ${invoice.number} PDF`}
                        disabled={!providerAvailable}
                        onClick={openPortal}
                        className={cn(ICON_BUTTON, "text-foreground disabled:opacity-40")}
                      >
                        <Download className="size-4" />
                      </button>
                      <button
                        type="button"
                        title={providerAvailable ? "View payment receipt" : `Receipt: ${PROVIDER_HINT.toLowerCase()}`}
                        aria-label={`View ${invoice.number} receipt`}
                        disabled={!providerAvailable}
                        onClick={openPortal}
                        className={cn(ICON_BUTTON, "text-muted-foreground hover:text-primary disabled:opacity-40")}
                      >
                        <ExternalLink className="size-4" />
                      </button>
                      <span title={`Reference: ${invoice.reference}`} className={cn(ICON_BUTTON, "text-primary cursor-help")}>
                        <BadgeCheck aria-hidden className="size-4" />
                        <span className="sr-only">Reference {invoice.reference}</span>
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-surface-raised text-foreground-subtle flex flex-wrap items-center justify-between gap-2 px-4 py-3 font-mono text-[10px]">
        <span className="flex flex-wrap items-center gap-2">
          <span>
            Showing {rows.length} of {invoices.length} {invoices.length === 1 ? "cycle" : "cycles"}
          </span>
          {invoices.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-muted-foreground">{unsettled ? "Balance outstanding" : "All balances settled"}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-2">
          <Button type="button" variant="bare" size="bare" disabled={page === 0} onClick={() => onPage(page - 1)} className="bg-card hover:text-foreground rounded px-2.5 py-1">
            <ChevronLeft aria-hidden className="size-3" />
            Previous
          </Button>
          <Button
            type="button"
            variant="bare"
            size="bare"
            disabled={page + 1 >= pageCount}
            onClick={() => onPage(page + 1)}
            className="bg-card hover:text-foreground rounded px-2.5 py-1"
          >
            Next
            <ChevronRight aria-hidden className="size-3" />
          </Button>
        </span>
      </div>
    </BillingCard>
  );
}

export const PAGE_SIZE = 10;
