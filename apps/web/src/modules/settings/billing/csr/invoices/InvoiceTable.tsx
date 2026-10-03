"use client";

import { BadgeCheck, CreditCard, Download, ExternalLink, FileText, ReceiptText } from "lucide-react";
import { InvoiceStatusPill } from "@/components/billing/billing-ui";
import { DataTableEmpty } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBillingDate, formatBillingDateTime, formatMoney } from "@/lib/billing-format";
import type { BillingInvoice } from "@/lib/types/billing";
import { cn } from "@/lib/utils";
import { PROVIDER_HINT, useBillingActions } from "../billing-actions-context";
import { useProviderSession } from "../useProviderSession";

interface InvoiceTableProps {
  /** The current page of the filtered invoices. */
  invoices: BillingInvoice[];
  empty: { title: string; description: string; onReset?: () => void };
}

/** The settlement ledger: one row per invoice, with its window, amount, state, method and the per-invoice actions. Lives in the card with its toolbar and pager. */
export function InvoiceTable({ invoices, empty }: InvoiceTableProps) {
  const { providerAvailable } = useBillingActions();
  const openPortal = useProviderSession("portal");

  if (invoices.length === 0) {
    return (
      <DataTableEmpty
        icon={ReceiptText}
        title={empty.title}
        description={empty.description}
        action={
          empty.onReset && (
            <Button type="button" variant="outline" size="sm" onClick={empty.onReset}>
              Reset filters
            </Button>
          )
        }
      />
    );
  }

  return (
    <Table className="min-w-[960px]">
      <TableHeader>
        <TableRow>
          <TableHead>Invoice identifier</TableHead>
          <TableHead>Billing window</TableHead>
          <TableHead>Plan description &amp; seats</TableHead>
          <TableHead align="end">Amount</TableHead>
          <TableHead>Settlement state</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Paid / due (UTC)</TableHead>
          <TableHead align="end">Verification &amp; PDF</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow key={invoice.id} className={cn(invoice.detailHighlighted && "bg-surface-raised/20")}>
            <TableCell nowrap className="text-primary font-mono text-xs font-bold">
              <span className="flex items-center gap-1.5">
                <FileText aria-hidden className="text-primary/80 size-4" />
                {invoice.number}
              </span>
            </TableCell>
            <TableCell className="text-foreground font-mono text-xs">
              {formatBillingDate(invoice.periodStart)} – {formatBillingDate(invoice.periodEnd)}
            </TableCell>
            <TableCell>
              <span className="flex flex-col">
                <span className="text-foreground font-mono text-xs font-medium">{invoice.description}</span>
                <span className={cn("font-mono text-[10px]", invoice.detailHighlighted ? "text-warning-text" : "text-foreground-subtle")}>
                  {invoice.detail}
                </span>
              </span>
            </TableCell>
            <TableCell align="end" nowrap className="text-foreground font-mono text-base font-bold tabular-nums">
              {formatMoney(invoice.amountCents, invoice.currency)}{" "}
              <span className="text-foreground-subtle text-[10px] font-normal">{invoice.currency}</span>
            </TableCell>
            <TableCell>
              <InvoiceStatusPill status={invoice.status} />
            </TableCell>
            <TableCell nowrap className="text-muted-foreground font-mono text-xs">
              <span className="flex items-center gap-1.5">
                <CreditCard aria-hidden className="text-foreground-subtle size-4" />
                {invoice.paymentMethodLabel}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">
              {invoice.paidAt ? formatBillingDateTime(invoice.paidAt) : invoice.status === "open" ? `Due ${formatBillingDate(invoice.dueAt)}` : "—"}
            </TableCell>
            <TableCell align="end">
              <div className="flex items-center justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title={providerAvailable ? "Download invoice PDF" : `Invoice PDF: ${PROVIDER_HINT.toLowerCase()}`}
                  aria-label={`Download ${invoice.number} PDF`}
                  disabled={!providerAvailable}
                  onClick={openPortal}
                >
                  <Download className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title={providerAvailable ? "View payment receipt" : `Receipt: ${PROVIDER_HINT.toLowerCase()}`}
                  aria-label={`View ${invoice.number} receipt`}
                  disabled={!providerAvailable}
                  onClick={openPortal}
                  className="text-muted-foreground hover:text-primary"
                >
                  <ExternalLink className="size-4" />
                </Button>
                <span title={`Reference: ${invoice.reference}`} className="text-primary cursor-help rounded p-1">
                  <BadgeCheck aria-hidden className="size-4" />
                  <span className="sr-only">Reference {invoice.reference}</span>
                </span>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
