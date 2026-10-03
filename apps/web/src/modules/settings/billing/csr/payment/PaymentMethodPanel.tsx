"use client";

import { CreditCard, Mail, Plus, RefreshCw } from "lucide-react";
import { BillingCard, BillingFactRow, BillingPill } from "@/components/billing/billing-ui";
import { Button } from "@/components/ui/button";
import type { BillingOverviewData } from "@/lib/types/billing";
import { OWNER_ONLY_HINT, PROVIDER_HINT, useBillingActions } from "../billing-actions-context";
import { useProviderSession } from "../useProviderSession";

/**
 * The default payment source. Payment methods live with a payment provider;
 * without one, invoices are settled directly and this panel says so.
 */
export function PaymentMethodPanel({ data, onEditProfile }: { data: BillingOverviewData; onEditProfile: () => void }) {
  const { canManage, providerAvailable } = useBillingActions();
  const openPaymentForm = useProviderSession("payment_method");
  const method = data.paymentMethod;
  const providerHint = !canManage ? OWNER_ONLY_HINT : providerAvailable ? undefined : PROVIDER_HINT;

  return (
    <BillingCard aria-labelledby="payment-method-title" className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <CreditCard aria-hidden className="text-primary size-5" />
          <h2 id="payment-method-title" className="text-foreground text-lg font-semibold tracking-tight">
            Default payment source
          </h2>
        </span>
        <BillingPill tone={method ? "success" : "primary"}>{method ? "Valid" : "Direct invoice"}</BillingPill>
      </div>

      <div className="grid items-start gap-4 md:grid-cols-2">
        <div className="bg-surface-raised border-border flex min-h-36 flex-col justify-between rounded-xl border p-4">
          {method ? (
            <p className="text-foreground font-mono text-sm tracking-widest">
              {method.brand} •••• {method.last4}
            </p>
          ) : (
            <>
              <p className="text-foreground text-sm font-medium">No payment method on file</p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                {providerAvailable
                  ? "Add a card or bank account so renewals are charged automatically."
                  : "No payment provider is connected, so invoices are issued on 14-day terms and settled directly. Card payments arrive with the provider."}
              </p>
            </>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <dl className="flex flex-col gap-1">
            <BillingFactRow label="Collection">{method ? "Charged automatically" : "Invoice, net 14 days"}</BillingFactRow>
            <BillingFactRow label="Invoices to">{data.profile.billingEmail ?? "Not set"}</BillingFactRow>
            <BillingFactRow label="Extra recipients">{data.profile.ccEmails.length}</BillingFactRow>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!canManage || !providerAvailable} title={providerHint} onClick={openPaymentForm} className="font-mono">
              {method ? <RefreshCw aria-hidden /> : <Plus aria-hidden />}
              {method ? "Update payment method" : "Add payment method"}
            </Button>
            <Button type="button" variant="surface" size="sm" disabled={!canManage} title={canManage ? undefined : OWNER_ONLY_HINT} onClick={onEditProfile} className="font-mono">
              <Mail aria-hidden />
              Change billing email
            </Button>
          </div>
        </div>
      </div>
    </BillingCard>
  );
}
