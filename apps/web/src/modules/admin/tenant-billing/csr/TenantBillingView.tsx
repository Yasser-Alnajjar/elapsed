"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AdminClientActions } from "@/actions/admin-client";
import { BillingToast, useBillingToast } from "@/components/billing/billing-toast";
import { downloadText, invoicesToCsv } from "@/lib/billing-invoices";
import type { AdminBillingActionInput } from "@/lib/billing-validation";
import type { AdminTenantBillingDetail, OperatorOverrideAction } from "@/lib/types/admin-billing";
import type { BillingInvoice } from "@/lib/types/billing";
import { BillingCommandBar } from "./BillingCommandBar";
import { DelinquencyBanner } from "./DelinquencyBanner";
import { DunningRunway } from "./DunningRunway";
import { LifecycleStream } from "./LifecycleStream";
import { OperatorOverrideDialog } from "./OperatorOverrideDialog";
import { OverrideSafeguardsPanel } from "./OverrideSafeguardsPanel";
import { PaymentInstrumentCard } from "./PaymentInstrumentCard";
import { SeatsConnectorsCard } from "./SeatsConnectorsCard";
import { SubscriptionPlanCard } from "./SubscriptionPlanCard";
import { TenantBillingHeader } from "./TenantBillingHeader";
import { TenantLedgerCard } from "./TenantLedgerCard";

export interface OverrideRequest {
  action: OperatorOverrideAction;
  invoice?: Pick<BillingInvoice, "id" | "number" | "amountCents" | "currency">;
}

/** What an operator's action returns to the dialog that sent it. */
export interface OverrideResult {
  ok: boolean;
  error?: string;
}

/**
 * One tenant's billing lifecycle (Stitch "Platform Admin Tenant Billing
 * Detail"), from the internal billing domain: any overdue invoice first, then
 * who the tenant is, its plan, seats and settlement, the dunning runway, the
 * lifecycle stream and invoices, and the operator overrides. Every override
 * needs a rationale and is audited with the change, in one transaction.
 */
export function TenantBillingView({ data }: { data: AdminTenantBillingDetail }) {
  const router = useRouter();
  const toast = useBillingToast();
  const [refreshing, startRefresh] = useTransition();
  const [sending, setSending] = useState(false);
  const [override, setOverride] = useState<OverrideRequest | null>(null);
  const { tenant } = data;
  const { show } = toast;

  const act = async (input: AdminBillingActionInput, success: string): Promise<OverrideResult> => {
    setSending(true);
    try {
      const result = await AdminClientActions.billingAction(tenant.id, input);
      if (!result.ok) {
        const error = result.body.error ?? "The override could not be applied.";
        show({ title: "Not applied", description: error, tone: "error" });
        return { ok: false, error };
      }
      show({ title: success, description: "Applied, recorded in billing history and the audit log.", tone: "success" });
      startRefresh(() => router.refresh());
      return { ok: true };
    } catch {
      const error = "Could not reach the server. Check your connection and try again.";
      show({ title: "Not applied", description: error, tone: "error" });
      return { ok: false, error };
    } finally {
      setSending(false);
    }
  };
  const busy = sending || refreshing;
  const providerUnavailable = () =>
    show({ title: "Needs a payment provider", description: "Collecting a charge needs a payment provider, and none is connected.", tone: "preview" });

  return (
    <div className="flex flex-col gap-5" aria-busy={refreshing}>
      <BillingCommandBar tenant={tenant} />

      {data.overdue && (
        <DelinquencyBanner
          overdue={data.overdue}
          asOf={data.asOf}
          connectors={data.connectors}
          providerAvailable={data.providerAvailable}
          busy={busy}
          onRetry={() => act({ action: "retry_charge", invoiceId: data.overdue!.invoiceId }, `Charge retried for ${data.overdue!.invoiceNumber}`)}
          onGrantGrace={() => setOverride({ action: "grant_grace" })}
        />
      )}

      <TenantBillingHeader
        data={data}
        busy={busy}
        onChangePlan={() => setOverride({ action: "change_plan" })}
        onExportLedger={() => downloadText(`${tenant.id}-ledger.csv`, invoicesToCsv(data.invoices))}
        onReconcile={() => act({ action: "reconcile" }, "Billing reconciled")}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SubscriptionPlanCard data={data} onEditTerms={() => setOverride({ action: "change_plan" })} />
        <SeatsConnectorsCard data={data} />
        <PaymentInstrumentCard data={data} onRequestUpdate={providerUnavailable} />
      </div>

      <DunningRunway overdue={data.overdue} asOf={data.asOf} />

      <div className="grid items-start gap-5 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-7">
          <LifecycleStream events={data.timeline} />
        </div>
        <div className="min-w-0 xl:col-span-5">
          <TenantLedgerCard
            data={data}
            busy={busy}
            onMarkPaid={(invoice) => setOverride({ action: "mark_paid", invoice })}
            onVoid={(invoice) => setOverride({ action: "void_invoice", invoice })}
            onRetry={(invoice) => act({ action: "retry_charge", invoiceId: invoice.id }, `Charge retried for ${invoice.number}`)}
          />
        </div>
      </div>

      <OverrideSafeguardsPanel
        notes={data.notes}
        openCents={tenant.openCents}
        busy={busy}
        onUpdateNotes={() => setOverride({ action: "add_note" })}
        onComp={() => setOverride({ action: "comp_open_invoices" })}
      />

      <OperatorOverrideDialog request={override} data={data} busy={busy} onOpenChange={(open) => !open && setOverride(null)} onSubmit={act} />

      <BillingToast message={toast.message} onDismiss={toast.dismiss} />
    </div>
  );
}
