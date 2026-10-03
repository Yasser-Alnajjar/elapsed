"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AdminClientActions } from "@/actions/admin-client";
import { BillingToast, useBillingToast } from "@/components/billing/billing-toast";
import {
  billingKpis,
  countByHealth,
  countByStatus,
  countByTier,
  DEFAULT_BILLING_CONTROLS,
  dunningQueue,
  selectBillingTenants,
  type BillingListControls,
} from "@/lib/admin-billing-list";
import { formatMoney } from "@/lib/billing-format";
import { downloadText } from "@/lib/billing-invoices";
import { DataTableCard, DataTablePagination, useClientPagination } from "@/components/shared/data-table";
import { BILLING_COLUMNS, type AdminBillingOverviewData, type BillingColumn } from "@/lib/types/admin-billing";
import { BillingDirectoryTable } from "./BillingDirectoryTable";
import { BillingDirectoryToolbar } from "./BillingDirectoryToolbar";
import { BillingKpiStrip } from "./BillingKpiStrip";
import { BillingOverviewHeader } from "./BillingOverviewHeader";
import { DunningQueuePanel, GatewayStatusPanel, QuotaVelocityPanel } from "./OperationsPanels";
import { tenantsToCsv } from "./tenants-csv";

/**
 * "Financial Telemetry & Tenancy Directory" (Stitch platform-admin billing
 * overview): revenue and risk headlines, the searchable tenant billing table,
 * and the dunning / ingest / payment-provider panels, from the internal
 * billing domain. Filtering, sorting and paging run here over the rows the
 * server sent; overrides happen on a tenant's billing page.
 */
export function BillingOverviewView({ data }: { data: AdminBillingOverviewData }) {
  const router = useRouter();
  const [syncing, startSync] = useTransition();
  const toast = useBillingToast();
  const [controls, setControls] = useState<BillingListControls>(DEFAULT_BILLING_CONTROLS);
  const [columns, setColumns] = useState<Set<BillingColumn>>(() => new Set(BILLING_COLUMNS));

  const { tenants } = data;
  const visible = useMemo(() => selectBillingTenants(tenants, controls), [tenants, controls]);
  const kpis = useMemo(() => billingKpis(tenants), [tenants]);
  const counts = useMemo(
    () => ({ tier: countByTier(tenants), status: countByStatus(tenants), health: countByHealth(tenants) }),
    [tenants],
  );
  const queue = useMemo(() => dunningQueue(tenants), [tenants]);
  const pagination = useClientPagination(visible);

  const { show } = toast;
  const filtered = JSON.stringify(controls) !== JSON.stringify(DEFAULT_BILLING_CONTROLS);

  const changeControls = (next: Partial<BillingListControls>) => {
    setControls((current) => ({ ...current, ...next }));
    pagination.resetPage();
  };

  return (
    <div className="flex flex-col gap-5">
      <BillingOverviewHeader
        providerAvailable={data.providerAvailable}
        openCents={data.totals.openCents}
        currency={data.currency}
        syncing={syncing}
        onSync={() =>
          startSync(async () => {
            const result = await AdminClientActions.reconcileAllBilling().catch(() => null);
            if (!result?.ok) {
              show({ title: "Not reconciled", description: result?.body.error ?? "Could not reach the server.", tone: "error" });
              return;
            }
            show({ title: "Billing reconciled", description: `${result.body.reconciled} live subscription(s) brought up to date.`, tone: "success" });
            router.refresh();
          })
        }
      />

      <BillingKpiStrip kpis={kpis} currency={data.currency} />

      <DataTableCard>
        <BillingDirectoryToolbar
          controls={controls}
          onChange={changeControls}
          counts={counts}
          columns={columns}
          onColumnsChange={setColumns}
          onExport={() => downloadText("tenant-billing.csv", tenantsToCsv(visible))}
          exportDisabled={visible.length === 0}
          onReset={filtered ? () => changeControls(DEFAULT_BILLING_CONTROLS) : undefined}
        />
        <BillingDirectoryTable
          rows={pagination.pageRows}
          columns={columns}
          onReset={filtered ? () => changeControls(DEFAULT_BILLING_CONTROLS) : undefined}
        />
        <DataTablePagination
          {...pagination.props}
          itemLabel="tenants"
          summary={
            <span className="normal-case">
              Active MRR:{" "}
              <span className="text-primary font-semibold tabular-nums">
                {formatMoney(kpis.mrrCents, data.currency)} {data.currency}
              </span>
            </span>
          }
        />
      </DataTableCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <DunningQueuePanel queue={queue} currency={data.currency} />
        <QuotaVelocityPanel totals={data.totals} tenantCount={tenants.length} />
        <GatewayStatusPanel providerAvailable={data.providerAvailable} totals={data.totals} currency={data.currency} />
      </div>

      <BillingToast message={toast.message} onDismiss={toast.dismiss} />
    </div>
  );
}
