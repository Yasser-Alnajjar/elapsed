import { buildCsv } from "@/lib/csv";
import { formatBillingDate, formatBillingDateTime } from "@/lib/billing-format";
import { INVOICE_STATUS_LABELS, type BillingInvoice, type InvoiceStatus } from "@/lib/types/billing";

/**
 * The invoice ledger's controls (year, status, search) as pure functions, so
 * the view only holds state and the behaviour is unit-tested.
 */

export type InvoiceStatusFilter = "all" | InvoiceStatus;

export const INVOICE_STATUS_FILTERS: InvoiceStatusFilter[] = ["all", "paid", "open", "void"];

export interface InvoiceControls {
  year: number;
  status: InvoiceStatusFilter;
  query: string;
}

export function invoiceYear(invoice: Pick<BillingInvoice, "periodStart">): number {
  return new Date(invoice.periodStart).getUTCFullYear();
}

/** Years to offer, newest first: the current year always, then every year an invoice exists for. */
export function invoiceYears(invoices: BillingInvoice[], currentYear: number): number[] {
  const years = new Set<number>([currentYear, currentYear - 1, currentYear - 2]);
  for (const invoice of invoices) years.add(invoiceYear(invoice));
  return [...years].sort((a, b) => b - a);
}

/** Invoices of `year` per status, for the status select's counts. */
export function countInvoicesByStatus(invoices: BillingInvoice[], year: number): Record<InvoiceStatusFilter, number> {
  const counts: Record<InvoiceStatusFilter, number> = { all: 0, paid: 0, open: 0, failed: 0, refunded: 0, void: 0 };
  for (const invoice of invoices) {
    if (invoiceYear(invoice) !== year) continue;
    counts.all += 1;
    counts[invoice.status] += 1;
  }
  return counts;
}

export function filterInvoices(invoices: BillingInvoice[], controls: InvoiceControls): BillingInvoice[] {
  const query = controls.query.trim().toLowerCase();
  return invoices.filter(
    (invoice) =>
      invoiceYear(invoice) === controls.year &&
      (controls.status === "all" || invoice.status === controls.status) &&
      (query === "" ||
        invoice.number.toLowerCase().includes(query) ||
        invoice.reference.toLowerCase().includes(query) ||
        invoice.description.toLowerCase().includes(query)),
  );
}

export function sumInvoices(invoices: BillingInvoice[]): number {
  return invoices.reduce((sum, invoice) => sum + (invoice.status === "paid" ? invoice.amountCents : 0), 0);
}

export function invoicesToCsv(invoices: BillingInvoice[]): string {
  return buildCsv(
    ["Invoice", "Billing window", "Description", "Amount", "Currency", "Status", "Method", "Paid (UTC)"],
    invoices.map((invoice) => [
      invoice.number,
      `${formatBillingDate(invoice.periodStart)} – ${formatBillingDate(invoice.periodEnd)}`,
      invoice.description,
      (invoice.amountCents / 100).toFixed(2),
      invoice.currency,
      INVOICE_STATUS_LABELS[invoice.status],
      invoice.paymentMethodLabel,
      invoice.paidAt ? formatBillingDateTime(invoice.paidAt) : "",
    ]),
  );
}

/** Saves text as a file from the browser. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
