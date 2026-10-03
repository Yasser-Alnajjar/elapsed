import { ReceiptText } from "lucide-react";
import { AdminPanel, MonoLabel, Tag } from "@/components/admin/admin-ui";
import { InvoiceStatusPill } from "@/components/billing/billing-ui";
import { DataTableCard } from "@/components/shared/data-table/data-table-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBillingDate, formatMoney } from "@/lib/billing-format";
import type { AdminTenantBillingDetail } from "@/lib/types/admin-billing";
import type { BillingInvoice } from "@/lib/types/billing";
import { cn } from "@/lib/utils";


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
          <DataTableCard>
            <Table className="min-w-[460px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead align="end">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="end">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.invoices.map((invoice) => {
                  const overdue = invoice.status === "open" && Date.parse(invoice.dueAt) < now;
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <span className="flex flex-col">
                          <span className="text-foreground font-mono text-xs font-bold">{invoice.number}</span>
                          <span className="text-foreground-subtle font-mono text-[10px]">{invoice.detail}</span>
                        </span>
                      </TableCell>
                      <TableCell nowrap className={cn("font-mono text-[10px]", overdue ? "text-error font-bold" : "text-muted-foreground")}>
                        {invoice.status === "paid" ? `Paid ${formatBillingDate(invoice.paidAt)}` : formatBillingDate(invoice.dueAt)}
                      </TableCell>
                      <TableCell align="end" nowrap className={cn("font-mono text-xs font-bold tabular-nums", overdue ? "text-error" : "text-foreground")}>
                        {formatMoney(invoice.amountCents, invoice.currency)}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusPill status={invoice.status} />
                      </TableCell>
                      <TableCell align="end">
                        {invoice.status === "open" ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onMarkPaid(invoice)} className="text-success">
                              Mark paid
                            </Button>
                            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onVoid(invoice)}>
                              Void
                            </Button>
                            {data.providerAvailable && (
                              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRetry(invoice)} className="text-error">
                                Retry
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-foreground-subtle font-mono text-[10px] uppercase">Settled</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTableCard>
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
