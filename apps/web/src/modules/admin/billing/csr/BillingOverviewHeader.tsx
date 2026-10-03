"use client";

import { ReceiptText, RefreshCw } from "lucide-react";
import { MonoLabel, StatusDot } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/billing-format";
import { cn } from "@/lib/utils";

interface BillingOverviewHeaderProps {
  providerAvailable: boolean;
  openCents: number;
  currency: string;
  syncing: boolean;
  onSync: () => void;
}

/** Breadcrumb, title, the payment-provider state, the open balance, and "reconcile all". */
export function BillingOverviewHeader({ providerAvailable, openCents, currency, syncing, onSync }: BillingOverviewHeaderProps) {
  return (
    <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
      <div className="flex min-w-0 flex-col gap-0.5">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5">
          <MonoLabel>Platform administration</MonoLabel>
          <MonoLabel>/</MonoLabel>
          <MonoLabel className="text-primary">Tenant billing &amp; subscriptions</MonoLabel>
        </nav>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">Financial Telemetry &amp; Tenancy Directory</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Global tenancy revenue, entitlement quotas, payment risk, and subscription lifecycle across all customer instances.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-surface-raised border-border flex items-center gap-1.5 rounded border px-2.5 py-1.5">
          <StatusDot tone={providerAvailable ? "success" : "neutral"} pulse={providerAvailable} className="size-2" />
          <MonoLabel>Payment provider:</MonoLabel>
          <span className="text-foreground font-mono text-xs font-bold uppercase">{providerAvailable ? "Connected" : "Not connected"}</span>
        </span>
        <span className="bg-surface-raised border-border flex items-center gap-1.5 rounded border px-2.5 py-1.5">
          <ReceiptText aria-hidden className="text-tertiary size-3.5" />
          <MonoLabel>Open balance:</MonoLabel>
          <span className="text-tertiary font-mono text-xs font-bold tabular-nums">{formatMoney(openCents, currency)}</span>
        </span>
        <Button type="button" variant="tonal" size="compact" onClick={onSync} disabled={syncing} className="font-mono text-[11px]">
          <RefreshCw aria-hidden className={cn("size-4", syncing && "animate-spin")} />
          {syncing ? "Reconciling…" : "Reconcile all"}
        </Button>
      </div>
    </header>
  );
}
