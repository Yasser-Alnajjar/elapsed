"use client";

import { useCallback, useMemo, useState } from "react";
import type { PlanId } from "@sla/db/plans";
import { BillingToast, useBillingToast } from "@/components/billing/billing-toast";
import type { BillingOverviewData, BillingTab } from "@/lib/types/billing";
import { BillingActionsProvider, type BillingActionsValue } from "./billing-actions-context";
import { BillingProfileDialog } from "./BillingProfileDialog";
import { BillingTabs } from "./BillingTabs";
import { ChangePlanDialog } from "./ChangePlanDialog";
import { InvoicesTab } from "./invoices/InvoicesTab";
import { OverviewTab } from "./overview/OverviewTab";
import { PaymentTab } from "./payment/PaymentTab";
import { SeatsDialog } from "./SeatsDialog";
import { useSubscriptionRunner } from "./useSubscriptionRunner";

interface BillingViewProps {
  data: BillingOverviewData;
  tab: BillingTab;
}

/**
 * The organization's billing (Stitch "Customer Billing"): subscription and
 * entitlements, invoice ledger, and payment details, one tab each. Every
 * change goes to `/api/billing/*`, which re-validates it against the current
 * state; on success the page re-reads its server data.
 */
export function BillingView({ data, tab }: BillingViewProps) {
  const toast = useBillingToast();
  const [planDialog, setPlanDialog] = useState<{ open: boolean; initial: PlanId | null; session: number }>({ open: false, initial: null, session: 0 });
  const [seatsOpen, setSeatsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const { show } = toast;
  const notify = useCallback<BillingActionsValue["notify"]>((title, description, tone = "preview") => show({ title, description, tone }), [show]);
  const { run, busy, refreshing } = useSubscriptionRunner(show);

  const actions = useMemo<BillingActionsValue>(
    () => ({
      canManage: data.canManage,
      providerAvailable: data.providerAvailable,
      version: data.subscription?.version ?? null,
      busy,
      run,
      notify,
    }),
    [data.canManage, data.providerAvailable, data.subscription?.version, busy, run, notify],
  );

  const openPlanDialog = (initial: PlanId | null = null) => setPlanDialog((current) => ({ open: true, initial, session: current.session + 1 }));
  const tabs = <BillingTabs active={tab} providerAvailable={data.providerAvailable} />;

  return (
    <BillingActionsProvider value={actions}>
      <div className="flex flex-col gap-5" aria-busy={refreshing}>
        {tab === "overview" && <OverviewTab data={data} tabs={tabs} onChangePlan={openPlanDialog} onManageSeats={() => setSeatsOpen(true)} />}
        {tab === "invoices" && <InvoicesTab data={data} tabs={tabs} onEditProfile={() => setProfileOpen(true)} />}
        {tab === "payment" && <PaymentTab data={data} tabs={tabs} onEditProfile={() => setProfileOpen(true)} />}
      </div>

      <ChangePlanDialog
        // Remount per opening so the selection starts from the plan that opened it.
        key={planDialog.session}
        open={planDialog.open}
        onOpenChange={(open) => setPlanDialog((current) => ({ ...current, open }))}
        data={data}
        initial={planDialog.initial}
      />
      {data.subscription && <SeatsDialog key={`${seatsOpen}`} open={seatsOpen} onOpenChange={setSeatsOpen} seats={data.seats} planName={data.subscription.planName} />}
      <BillingProfileDialog key={`profile-${profileOpen}`} open={profileOpen} onOpenChange={setProfileOpen} profile={data.profile} />

      <BillingToast message={toast.message} onDismiss={toast.dismiss} />
    </BillingActionsProvider>
  );
}
