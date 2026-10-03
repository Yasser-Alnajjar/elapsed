"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  countInvoicesByStatus,
  downloadText,
  filterInvoices,
  invoiceYear,
  invoiceYears,
  invoicesToCsv,
  sumInvoices,
  type InvoiceControls,
} from "@/lib/billing-invoices";
import type { BillingOverviewData } from "@/lib/types/billing";
import { useBillingActions } from "../billing-actions-context";
import { useProviderSession } from "../useProviderSession";
import { BillingProfileCards } from "../payment/BillingProfileCards";
import { BillingSecurityBanner } from "../payment/BillingSecurityBanner";
import { DataTableCard, DataTablePagination, useClientPagination } from "@/components/shared/data-table";
import { InvoiceTable } from "./InvoiceTable";
import { InvoiceToolbar } from "./InvoiceToolbar";
import { LedgerHeader } from "./LedgerHeader";

/** "Invoices & History": the settlement ledger by fiscal year, then who and where invoices are billed to. */
export function InvoicesTab({ data, tabs, onEditProfile }: { data: BillingOverviewData; tabs: ReactNode; onEditProfile: () => void }) {
  const { providerAvailable } = useBillingActions();
  const openPortal = useProviderSession("portal");
  const currentYear = new Date(data.asOf).getUTCFullYear();
  const [controls, setControls] = useState<InvoiceControls>({ year: currentYear, status: "all", query: "" });

  const years = useMemo(() => invoiceYears(data.invoices, currentYear), [data.invoices, currentYear]);
  const counts = useMemo(() => countInvoicesByStatus(data.invoices, controls.year), [data.invoices, controls.year]);
  const visible = useMemo(() => filterInvoices(data.invoices, controls), [data.invoices, controls]);
  const annualCents = useMemo(
    () => sumInvoices(data.invoices.filter((invoice) => invoiceYear(invoice) === currentYear)),
    [data.invoices, currentYear],
  );
  const pagination = useClientPagination(visible);
  const filtered = controls.status !== "all" || controls.query !== "";
  const { subscription } = data;

  const unsettled = visible.some((invoice) => invoice.status !== "paid" && invoice.status !== "void");

  const changeControls = (next: Partial<InvoiceControls>) => {
    setControls((current) => ({ ...current, ...next }));
    pagination.resetPage();
  };
  const resetFilters = () => changeControls({ status: "all", query: "" });

  const empty = filtered
    ? {
        title: "No invoices match",
        description: "Nothing fits the current status and search.",
        onReset: resetFilters,
      }
    : data.invoices.length === 0
      ? {
          title: "No invoices yet",
          description: !subscription
            ? "Invoices appear here once a plan is chosen."
            : subscription.status === "trialing"
              ? "The first invoice is issued when the trial ends."
              : "Nothing has been invoiced yet.",
        }
      : { title: `No invoices for ${controls.year}`, description: "Nothing was billed in this fiscal year." };

  return (
    <>
      <LedgerHeader
        organizationName={data.organizationName}
        year={currentYear}
        annualCents={annualCents}
        currency={subscription?.currency ?? "USD"}
        nextBillingAt={data.upcomingInvoice?.nextAttemptAt ?? null}
        autopay={data.paymentMethod?.state === "valid" && subscription?.status === "active"}
      />

      {tabs}

      <DataTableCard>
        <InvoiceToolbar
          controls={controls}
          onChange={changeControls}
          years={years}
          currentYear={currentYear}
          counts={counts}
          exportDisabled={visible.length === 0}
          onExport={() => downloadText(`invoices-${controls.year}.csv`, invoicesToCsv(visible))}
          onTaxSummary={openPortal}
          taxSummaryAvailable={providerAvailable}
          onReset={filtered ? resetFilters : undefined}
        />
        <InvoiceTable invoices={pagination.pageRows} empty={empty} />
        <DataTablePagination
          {...pagination.props}
          itemLabel={visible.length === 1 ? "invoice" : "invoices"}
          summary={
            visible.length > 0 && (
              <span>
                {providerAvailable ? "Provider settled" : "Direct invoicing"} · {unsettled ? "Balance outstanding" : "All balances settled"}
              </span>
            )
          }
        />
      </DataTableCard>

      <BillingProfileCards profile={data.profile} onEdit={onEditProfile} />
      <BillingSecurityBanner providerAvailable={providerAvailable} />
    </>
  );
}
