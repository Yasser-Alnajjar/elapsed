import { ReceiptText } from "lucide-react";
import { AdminPanel, MonoLabel, Tag } from "@/components/admin/admin-ui";
import { InvoiceStatusPill } from "@/components/billing/billing-ui";
import { formatBillingDate, formatMoney } from "@/lib/billing-format";
import type { AdminTenantBillingDetail } from "@/lib/types/admin-billing";
import type { BillingInvoice } from "@/lib/types/billing";
import { cn } from "@/lib/utils";

const HEAD = "text-foreground-subtle px-2.5 py-2 text-left font-mono text-[10px] font-semibold tracking-[0.06em] uppercase";
const ACTION = "rounded px-2 py-1 font-mono text-[10px] font-semibold uppercase transition-colors disabled:pointer-events-none disabled:opacity-40";

interface TenantLedgerCardProps {
  data: AdminTenantBillingDetail;
  busy: boolean;
  onMarkPaid: (invoice: BillingInvoice) => void;
  onVoid: (invoice: BillingInvoice) => void;
  onRetry: (invoice: BillingInvoice) => void;
}

/** "Ledger & Invoices": the tenant's invoices with settle / void / retry actions, and the open balance. */
export function TenantLedgerCard({ data, busy, onMarkPaid, onVoid, onRetry }: TenantLedgerCardProps) {
  const now = Date.parse(data.asOf);
  return (
    <AdminPanel id="overrides-ledger" aria-labelledby="ledger-title" className="flex h-full flex-col justify-between gap-4 p-4">
      <div>
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h2 id="ledger-title" className="text-foreground flex items-center gap-2 text-lg font-bold">
              <ReceiptText aria-hidden className="text-primary size-4.5" />
              Ledger &amp; Invoices
            </h2>
            <MonoLabel>Internal billing ledger</MonoLabel>
          </div>
          <Tag tone="primary">
            {data.invoices.length} invoice{data.invoices.length === 1 ? "" : "s"}
          </Tag>
        </div>
        {data.invoices.length === 0 ? (
          <p className="text-muted-foreground bg-surface-raised rounded p-4 text-sm">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] border-separate border-spacing-y-1 text-sm">
              <thead>
                <tr className="bg-surface-container/60">
                  <th scope="col" className={cn(HEAD, "rounded-l")}>Invoice</th>
                  <th scope="col" className={HEAD}>Due</th>
                  <th scope="col" className={HEAD}>Amount</th>
                  <th scope="col" className={HEAD}>Status</th>
                  <th scope="col" className={cn(HEAD, "rounded-r text-right")}>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice) => {
                  const overdue = invoice.status === "open" && Date.parse(invoice.dueAt) < now;
                  return (
                    <tr key={invoice.id} className="bg-surface-raised/40 hover:bg-surface-hover transition-colors">
                      <td className="rounded-l px-2.5 py-2.5">
                        <span className="flex flex-col">
                          <span className="text-foreground font-mono text-xs font-bold">{invoice.number}</span>
                          <span className="text-foreground-subtle font-mono text-[10px]">{invoice.detail}</span>
                        </span>
                      </td>
                      <td className={cn("px-2.5 py-2.5 font-mono text-[10px] whitespace-nowrap", overdue ? "text-error font-bold" : "text-muted-foreground")}>
                        {invoice.status === "paid" ? `Paid ${formatBillingDate(invoice.paidAt)}` : formatBillingDate(invoice.dueAt)}
                      </td>
                      <td className={cn("px-2.5 py-2.5 font-mono text-xs font-bold tabular-nums", overdue ? "text-error" : "text-foreground")}>
                        {formatMoney(invoice.amountCents, invoice.currency)}
                      </td>
                      <td className="px-2.5 py-2.5">
                        <InvoiceStatusPill status={invoice.status} />
                      </td>
                      <td className="rounded-r px-2.5 py-2.5">
                        {invoice.status === "open" ? (
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" disabled={busy} onClick={() => onMarkPaid(invoice)} className={cn(ACTION, "bg-success/15 text-success hover:bg-success hover:text-background")}>
                              Mark paid
                            </button>
                            <button type="button" disabled={busy} onClick={() => onVoid(invoice)} className={cn(ACTION, "bg-surface-container text-foreground-subtle hover:text-foreground")}>
                              Void
                            </button>
                            {data.providerAvailable && (
                              <button type="button" disabled={busy} onClick={() => onRetry(invoice)} className={cn(ACTION, "bg-error/15 text-error hover:bg-error hover:text-error-foreground")}>
                                Retry
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-foreground-subtle block text-right font-mono text-[10px] uppercase">Settled</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="bg-surface-container rounded-lg p-3">
        <div className="mb-1 flex items-center justify-between font-mono text-[10px]">
          <MonoLabel>Settlement</MonoLabel>
          <span className="text-muted-foreground">{data.providerAvailable ? "Payment provider" : "Direct invoice"}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Open balance:</span>
          <span className={cn("font-mono text-sm font-bold", data.tenant.openCents > 0 ? "text-error" : "text-foreground")}>{formatMoney(data.tenant.openCents)} USD</span>
        </div>
      </div>
    </AdminPanel>
  );
}
